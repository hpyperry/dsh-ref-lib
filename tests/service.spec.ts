import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  extractReadmeTitle,
  NOTE_MAX_LENGTH,
  RefLibDuplicateError,
  RefLibNoteError,
  RefLibPathError,
  RefLibService,
  RefLibUnavailableError,
  RefLibUnknownError,
} from '../src/service.ts'
import type { RefLibEntry } from '../src/spec.ts'

let counter = 0

/** fake session：内存事件流 + id/header（与真实 Session 的 events/header 同形）。 */
function fakeSession(options: { parentSession?: string; events?: readonly SessionEvent[] } = {}): Session {
  const id = `session-test-${++counter}`
  const events: SessionEvent[] = options.events === undefined ? [] : [...options.events]
  const header = {
    version: 0,
    id,
    createdAt: Date.now(),
    ...(options.parentSession === undefined ? {} : { parentSession: options.parentSession }),
  } as SessionHeader
  return { id, header, events } as unknown as Session
}

/** sidecar 文件路径（与服务端同方案：id 编码为路径段 + .json）。 */
function sidecarPath(root: string, sessionId: string): string {
  return join(root, `${sessionId}.json`)
}

/** 读 sidecar 文件内容。 */
async function readSidecar(root: string, sessionId: string): Promise<RefLibEntry[]> {
  const value = JSON.parse(await readFile(sidecarPath(root, sessionId), 'utf8')) as { libs: RefLibEntry[] }
  return value.libs
}

describe('RefLibService v3（per-session sidecar）', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('add 校验真实目录并写入 sidecar 文件', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    expect(entry.path).toBe(dir)
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(service.list(session)).toEqual([entry])
    // sidecar 文件已落盘
    expect(await readSidecar(tmp, session.id)).toEqual([entry])
  })

  it('add 路径不存在抛 RefLibPathError', async () => {
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(service.add(session, join(tmp, 'nope'))).rejects.toBeInstanceOf(RefLibPathError)
  })

  it('add 指向普通文件抛 not-directory', async () => {
    const file = join(tmp, 'file.txt')
    await writeFile(file, 'x')
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(service.add(session, file)).rejects.toMatchObject({ reason: 'not-directory' })
  })

  it('add 拒绝含控制字符的路径（防止上下文注入）', async () => {
    const dir = join(tmp, 'lib\ninject')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(service.add(session, dir)).rejects.toMatchObject({ reason: 'unsafe' })
    expect(service.list(session)).toEqual([])
  })

  it('add 拒绝含 U+2028 行分隔符的路径（扩展控制字符集）', async () => {
    const dir = join(tmp, 'lib\u2028inject')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(service.add(session, dir)).rejects.toMatchObject({ reason: 'unsafe' })
  })

  it('add 同路径幂等返回既有条目', async () => {
    const dir = join(tmp, 'lib-b')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const first = await service.add(session, dir)
    const second = await service.add(session, dir)
    expect(second).toEqual(first)
    expect(service.list(session)).toHaveLength(1)
    expect(await readSidecar(tmp, session.id)).toHaveLength(1)
  })

  it('remove 移除条目且不删除磁盘目录', async () => {
    const dir = join(tmp, 'lib-c')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    await service.remove(session, entry.id)
    expect(service.list(session)).toHaveLength(0)
    expect(await readSidecar(tmp, session.id)).toEqual([])
    expect(await readdir(tmp)).toContain('lib-c')
  })

  it('remove 未知 id 抛 RefLibUnknownError', async () => {
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(service.remove(session, 'unknown')).rejects.toBeInstanceOf(RefLibUnknownError)
  })

  it('会话隔离：A 会话的库不出现在 B 会话', async () => {
    const dirA = join(tmp, 'lib-a')
    const dirB = join(tmp, 'lib-b')
    await mkdir(dirA)
    await mkdir(dirB)
    const service = new RefLibService(new Context(), { root: tmp })
    const a = fakeSession()
    const b = fakeSession()
    await service.add(a, dirA)
    await service.add(b, dirB)
    expect(service.list(a).map((entry) => entry.path)).toEqual([dirA])
    expect(service.list(b).map((entry) => entry.path)).toEqual([dirB])
  })

  it('新服务实例（模拟重启）从 sidecar 恢复列表', async () => {
    const dir = join(tmp, 'lib-d')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await service.add(session, dir)
    // 新实例：内存缓存为空，应从文件恢复
    const restarted = new RefLibService(new Context(), { root: tmp })
    expect(restarted.list(session).map((entry) => entry.path)).toEqual([dir])
  })

  it('迁移：旧日志中的 ref-lib/set 事件折叠一次并落盘 sidecar', async () => {
    const legacy: SessionEvent[] = [
      { type: 'ref-lib/set', seq: 0, time: 1, data: { libs: [{ id: 'old-1', path: '/old/lib' }] } } as SessionEvent,
    ]
    const session = fakeSession({ events: legacy })
    const service = new RefLibService(new Context(), { root: tmp })
    expect(service.list(session).map((entry) => entry.path)).toEqual(['/old/lib'])
    // 迁移结果已落盘：迁移条目无 status，首访探测（路径不存在 → missing）并升版写回 v3。
    const stored = await readSidecar(tmp, session.id)
    expect(stored).toEqual([{ id: 'old-1', path: '/old/lib', status: 'missing', checkedAt: expect.any(Number) }])
    expect(JSON.parse(await readFile(sidecarPath(tmp, session.id), 'utf8'))).toMatchObject({ version: 3 })
  })

  it('惰性兜底：legacy 子会话首次读取时复制父列表并落盘（重新铸造 id）', async () => {
    const dir = join(tmp, 'lib-parent')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const parent = fakeSession()
    const entry = await service.add(parent, dir)
    const child = fakeSession({ parentSession: parent.id })
    const childLibs = service.list(child)
    expect(childLibs.map((item) => item.path)).toEqual([dir])
    // 副本 id 已重新铸造（不共享父会话身份），已落盘自身 sidecar，再次读取 id 稳定。
    expect(childLibs[0]!.id).not.toBe(entry.id)
    const stored = await readSidecar(tmp, child.id)
    expect(stored[0]!.id).toBe(childLibs[0]!.id)
    expect(service.list(child).map((item) => item.path)).toEqual([dir])
  })

  describe('fork 继承物化（session/created 钩子）', () => {
    /** 真实 Context + 服务（构造时注册 session/created 钩子）。 */
    function bootService() {
      const ctx = new Context()
      const service = new RefLibService(ctx, { root: tmp })
      const emitCreated = (session: Session) => ctx.emit('session/created', session)
      return { service, emitCreated }
    }

    it('fork 触发即物化：子会话继承父列表并落盘自身 sidecar（条目 id 重新铸造）', async () => {
      const dir = join(tmp, 'lib-fork-materialize')
      await mkdir(dir)
      const { service, emitCreated } = bootService()
      const parent = fakeSession()
      const entry = await service.add(parent, dir)
      const child = fakeSession({ parentSession: parent.id })
      emitCreated(child)
      // 子会话已落盘自身 sidecar；条目路径一致但 id 已重新铸造（独立身份）。
      const stored = await readSidecar(tmp, child.id)
      expect(stored.map((item) => item.path)).toEqual([dir])
      expect(stored[0]!.id).not.toBe(entry.id)
      expect(service.list(child).map((item) => item.path)).toEqual([dir])
    })

    it('fork 链 A→B→C：逐级物化后继承链完整（不再依赖中间会话是否落盘）', async () => {
      const dir = join(tmp, 'lib-fork-chain')
      await mkdir(dir)
      const { service, emitCreated } = bootService()
      const a = fakeSession()
      await service.add(a, dir)
      const b = fakeSession({ parentSession: a.id })
      emitCreated(b)
      const c = fakeSession({ parentSession: b.id })
      emitCreated(c)
      expect(service.list(b).map((item) => item.path)).toEqual([dir])
      expect(service.list(c).map((item) => item.path)).toEqual([dir])
    })

    it('已有自身状态的会话不被物化覆盖（父会话后续变化不回流）', async () => {
      const dirA = join(tmp, 'lib-fork-own-a')
      const dirB = join(tmp, 'lib-fork-own-b')
      const dirC = join(tmp, 'lib-fork-own-c')
      await mkdir(dirA)
      await mkdir(dirB)
      await mkdir(dirC)
      const { service, emitCreated } = bootService()
      const parent = fakeSession()
      const entryA = await service.add(parent, dirA)
      const child = fakeSession({ parentSession: parent.id })
      // 子会话先有自身状态：add 时惰性继承父列表后并入自身条目，自身 sidecar 落盘。
      await service.add(child, dirB)
      const ownPaths = service.list(child).map((item) => item.path)
      expect(ownPaths).toEqual([dirA, dirB])
      // 父会话随后变化（移除 dirA、新增 dirC）→ 重复公告/重放物化不得覆盖子会话。
      await service.remove(parent, entryA.id)
      await service.add(parent, dirC)
      emitCreated(child)
      expect(service.list(child).map((item) => item.path)).toEqual(ownPaths)
    })

    it('父无库时子会话不落盘（保持惰性继承路径）', async () => {
      const { service, emitCreated } = bootService()
      const parent = fakeSession()
      const child = fakeSession({ parentSession: parent.id })
      emitCreated(child)
      await expect(readFile(sidecarPath(tmp, child.id), 'utf8')).rejects.toThrow()
      expect(service.list(child)).toEqual([])
    })

    it('无 parentSession 的普通创建不触发物化', async () => {
      const { emitCreated } = bootService()
      const session = fakeSession()
      emitCreated(session)
      await expect(readFile(sidecarPath(tmp, session.id), 'utf8')).rejects.toThrow()
    })
  })

  it('add 带 note 时写入 sidecar 并返回', async () => {
    const dir = join(tmp, 'lib-note')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir, '核心源码库')
    expect(entry.note).toBe('核心源码库')
    expect(await readSidecar(tmp, session.id)).toEqual([entry])
  })

  it('add 未带 note 时自动提取 README 首标题作为默认 note', async () => {
    const dir = join(tmp, 'lib-readme')
    await mkdir(dir)
    await writeFile(join(dir, 'README.md'), '# My Awesome Library\n\n说明文字')
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    expect(entry.note).toBe('My Awesome Library')
  })

  it('add 无 README 或无标题时 note 为空', async () => {
    const dir = join(tmp, 'lib-noreadme')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    expect(entry.note).toBeUndefined()
  })

  it('add 同路径带不同 note 时抛 RefLibDuplicateError（v12：不再静默覆盖；改用途走 setNote）', async () => {
    const dir = join(tmp, 'lib-update')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const first = await service.add(session, dir, '旧用途')
    const error = await service.add(session, dir, '新用途').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RefLibDuplicateError)
    expect((error as RefLibDuplicateError).entry).toEqual(first)
    // 显式改用途入口：setNote
    const updated = await service.setNote(session, first.id, '新用途')
    expect(updated.id).toBe(first.id)
    expect(updated.note).toBe('新用途')
    expect(service.list(session)).toHaveLength(1)
    expect(await readSidecar(tmp, session.id)).toEqual([{ ...first, note: '新用途' }])
  })

  it('add 同路径不带 note 时保持幂等不覆盖既有 note', async () => {
    const dir = join(tmp, 'lib-idempotent')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const first = await service.add(session, dir, '保留用途')
    const second = await service.add(session, dir)
    expect(second).toEqual(first)
  })

  it('add 拒绝含不允许控制字符的 note（U+2028 行分隔符，防止上下文注入）', async () => {
    const dir = join(tmp, 'lib-noteunsafe')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(service.add(session, dir, 'bad\u2028note')).rejects.toBeInstanceOf(RefLibNoteError)
    expect(service.list(session)).toEqual([])
  })

  it('note 超长时截断到 NOTE_MAX_LENGTH', async () => {
    const dir = join(tmp, 'lib-longnote')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const long = 'x'.repeat(NOTE_MAX_LENGTH + 50)
    const entry = await service.add(session, dir, long)
    expect(entry.note).toBe('x'.repeat(NOTE_MAX_LENGTH))
  })

  it('note 支持多行（换行存储保留，供展示/详情；注入时折叠）', async () => {
    const dir = join(tmp, 'lib-multiline')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir, '第一行\n第二行')
    expect(entry.note).toBe('第一行\n第二行')
    expect(await readSidecar(tmp, session.id)).toEqual([entry])
  })

  it('note 统一 \r\n 与 \r 为 \n', async () => {
    const dir = join(tmp, 'lib-crlf')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir, 'a\r\nb\rc')
    expect(entry.note).toBe('a\nb\nc')
  })

  it('setNote 更新条目用途说明并落盘', async () => {
    const dir = join(tmp, 'lib-setnote')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    const updated = await service.setNote(session, entry.id, '新用途')
    expect(updated.note).toBe('新用途')
    expect(updated.id).toBe(entry.id)
    expect(await readSidecar(tmp, session.id)).toEqual([{ ...entry, note: '新用途' }])
  })

  it('setNote 空串清除用途说明', async () => {
    const dir = join(tmp, 'lib-clearnote')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir, '将被清除')
    const cleared = await service.setNote(session, entry.id, '')
    expect(cleared.note).toBeUndefined()
    // 条目保留可用性字段（status/checkedAt 不被 setNote 清除）
    expect(await readSidecar(tmp, session.id)).toEqual([
      { id: entry.id, path: entry.path, status: 'available', checkedAt: expect.any(Number) },
    ])
  })

  it('setNote 未知 id 抛 RefLibUnknownError', async () => {
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(service.setNote(session, 'nope', 'x')).rejects.toBeInstanceOf(RefLibUnknownError)
  })

  it('setNote 拒绝不允许的控制字符（U+2028 行分隔符）', async () => {
    const dir = join(tmp, 'lib-noteline')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    await expect(service.setNote(session, entry.id, 'bad\u2028note')).rejects.toBeInstanceOf(RefLibNoteError)
  })
})

describe('可用性探测（v9：每次读取实时探测，状态变化写回）', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('add 新条目初始 status = available 并落盘', async () => {
    const dir = join(tmp, 'lib-ok')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    expect(entry.status).toBe('available')
    expect(entry.checkedAt).toEqual(expect.any(Number))
    expect(await readSidecar(tmp, session.id)).toEqual([entry])
  })

  it('删除目录后，下一次 list 即 missing 并写回', async () => {
    const dir = join(tmp, 'lib-del')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    // 删除目录
    await rm(dir, { recursive: true })
    const listed = service.list(session)
    expect(listed).toEqual([
      { ...entry, status: 'missing', checkedAt: expect.any(Number) },
    ])
    // 变化已落盘
    expect(await readSidecar(tmp, session.id)).toEqual([
      { id: entry.id, path: entry.path, status: 'missing', checkedAt: expect.any(Number) },
    ])
  })

  it('恢复目录后，下一次 list 重新 available', async () => {
    const dir = join(tmp, 'lib-restore')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await service.add(session, dir)
    await rm(dir, { recursive: true })
    expect(service.list(session)[0]!.status).toBe('missing')
    // 恢复目录
    await mkdir(dir)
    expect(service.list(session)[0]!.status).toBe('available')
  })

  it('目录被替换为文件 → not-directory', async () => {
    const dir = join(tmp, 'lib-file')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir)
    await rm(dir, { recursive: true })
    await writeFile(dir, 'now a file')
    expect(service.list(session)).toEqual([
      { ...entry, status: 'not-directory', checkedAt: expect.any(Number) },
    ])
  })

  it('状态未变化时 list 不写盘（sidecar 内容逐字节不变）', async () => {
    const dir = join(tmp, 'lib-stable')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await service.add(session, dir)
    const file = sidecarPath(tmp, session.id)
    const before = await readFile(file, 'utf8')
    // 多次 list（目录未变）：探测一致 → 不触发写回
    service.list(session)
    service.list(session)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('v2 sidecar（条目无 status）首访探测并升版写回 v3', async () => {
    const dir = join(tmp, 'lib-v2')
    await mkdir(dir)
    const session = fakeSession()
    // 手写 v2 sidecar：条目无 status/checkedAt
    await writeFile(
      sidecarPath(tmp, session.id),
      JSON.stringify({ version: 2, libs: [{ id: 'old', path: dir }] }),
    )
    const service = new RefLibService(new Context(), { root: tmp })
    expect(service.list(session)).toEqual([
      { id: 'old', path: dir, status: 'available', checkedAt: expect.any(Number) },
    ])
    // 已升版写回 v3
    expect(JSON.parse(await readFile(sidecarPath(tmp, session.id), 'utf8'))).toMatchObject({ version: 3 })
  })

  it('v2 sidecar 指向已删除目录 → 首访探测 missing 并写回', async () => {
    const session = fakeSession()
    await writeFile(
      sidecarPath(tmp, session.id),
      JSON.stringify({ version: 2, libs: [{ id: 'old', path: '/no/such/dir' }] }),
    )
    const service = new RefLibService(new Context(), { root: tmp })
    expect(service.list(session)).toEqual([
      { id: 'old', path: '/no/such/dir', status: 'missing', checkedAt: expect.any(Number) },
    ])
  })

  it('失效条目 setNote 拒绝（仅允许移除）', async () => {
    const dir = join(tmp, 'lib-dead')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir, '原用途')
    await rm(dir, { recursive: true })
    // 删除后条目变为 missing
    expect(service.list(session)[0]!.status).toBe('missing')
    // 更新用途被拒绝
    await expect(service.setNote(session, entry.id, '新用途')).rejects.toBeInstanceOf(RefLibUnavailableError)
    // 移除仍允许
    await expect(service.remove(session, entry.id)).resolves.toBeUndefined()
    expect(service.list(session)).toEqual([])
  })

  it('可用条目 setNote 正常更新', async () => {
    const dir = join(tmp, 'lib-alive')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const entry = await service.add(session, dir, '旧用途')
    const updated = await service.setNote(session, entry.id, '新用途')
    expect(updated.note).toBe('新用途')
  })
})

describe('extractReadmeTitle', () => {
  it('提取首个 Markdown 标题', () => {
    expect(extractReadmeTitle('# Hello\n\nbody')).toBe('Hello')
    expect(extractReadmeTitle('body\n\n## Sub')).toBeUndefined()
    // 只认 H1（`# `）；`## ` 是子标题不匹配，首个命中的是后续 H1
    expect(extractReadmeTitle('## 子标题\n# 主标题')).toBe('主标题')
    expect(extractReadmeTitle('')).toBeUndefined()
  })

  it('超长标题截断到 NOTE_MAX_LENGTH', () => {
    const long = 't'.repeat(NOTE_MAX_LENGTH + 10)
    expect(extractReadmeTitle(`# ${long}`)).toBe('t'.repeat(NOTE_MAX_LENGTH))
  })
})

describe('RefLibService v12（跨会话导入）', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('importEntries：新增条目重新铸造 id、note 保持源值、一次写盘', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    await writeFile(join(dir, 'README.md'), '# 自动标题（不应被采用）\n')
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const result = await service.importEntries(session, {
      additions: [{ path: dir, note: '源会话的 note' }],
      replacements: [],
    })
    expect(result.added).toHaveLength(1)
    const entry = result.added[0]!
    // 快照语义：note 用源值（不提取 README 标题）；id 为重新铸造的 UUID。
    expect(entry.note).toBe('源会话的 note')
    expect(entry.path).toBe(dir)
    expect(entry.status).toBe('available')
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    const stored = await readSidecar(tmp, session.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toEqual(entry)
  })

  it('importEntries：新增条目路径当前不可用 → RefLibPathError', async () => {
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(
      service.importEntries(session, { additions: [{ path: join(tmp, 'missing') }], replacements: [] }),
    ).rejects.toBeInstanceOf(RefLibPathError)
  })

  it('importEntries：replacements 以导入侧 note 更新现有条目（保留现有 id），undefined 清除 note', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const original = await service.add(session, dir, '原始 note')
    // 替换 note
    const withNote = await service.importEntries(session, {
      additions: [],
      replacements: [{ existingId: original.id, note: '导入的 note' }],
    })
    expect(withNote.replaced[0]).toMatchObject({ id: original.id, path: dir, note: '导入的 note' })
    // 清除 note（导入侧无 note）
    const cleared = await service.importEntries(session, {
      additions: [],
      replacements: [{ existingId: original.id }],
    })
    expect(cleared.replaced[0]?.note).toBeUndefined()
    const stored = await readSidecar(tmp, session.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.id).toBe(original.id)
    expect(stored[0]?.note).toBeUndefined()
  })

  it('importEntries：replacements 未知 id → RefLibUnknownError；additions 与现有重复 → 幂等跳过', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await expect(
      service.importEntries(session, { additions: [], replacements: [{ existingId: 'nope' }] }),
    ).rejects.toBeInstanceOf(RefLibUnknownError)
    await service.add(session, dir)
    const dup = await service.importEntries(session, { additions: [{ path: dir }], replacements: [] })
    expect(dup.added).toHaveLength(0)
  })

  it('listSessions：只列有参考库的其他会话，排除当前，按 mtime 倒序', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const sessionA = fakeSession()
    const sessionB = fakeSession()
    const current = fakeSession()
    await service.add(sessionA, dir)
    await service.add(sessionB, dir)
    await service.add(current, dir)
    const sources = await service.listSessions(current.id)
    expect(sources.map((s) => s.sessionId).sort()).toEqual([sessionA.id, sessionB.id].sort())
    for (const source of sources) {
      expect(source.count).toBe(1)
      expect(source.available).toBe(1)
      expect(source.updatedAt).toBeGreaterThan(0)
    }
    // 无 sidecar 的会话（从未配置过）不出现
    const none = await service.listSessions(fakeSession().id)
    expect(none).toHaveLength(3)
  })

  it('listSessions：无 sessionQuery 服务时无标题（回退显示 id），标题异常不阻断', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const sessionA = fakeSession()
    await service.add(sessionA, dir)
    const sources = await service.listSessions()
    expect(sources).toHaveLength(1)
    expect(sources[0]?.title).toBeUndefined()
  })
})

describe('RefLibService v12（只读源读取）', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('readSessionLibs：无 sidecar 返回空列表；有 sidecar 原样返回（不探测不写盘）', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    expect(service.readSessionLibs(session.id)).toEqual([])
    await service.add(session, dir)
    const libs = service.readSessionLibs(session.id)
    expect(libs).toHaveLength(1)
    expect(libs[0]?.path).toBe(dir)
    // 非 live 会话（未挂载）同样可读——模拟：直接写 sidecar 文件。
    const other = fakeSession()
    await service.add(other, dir)
    const cold = service.readSessionLibs(other.id)
    expect(cold).toHaveLength(1)
  })
})

describe('RefLibService v12（add 重复不再静默覆盖）', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('同路径再次 add（无显式 note）→ 幂等返回现有条目，不覆盖 note', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    await writeFile(join(dir, 'README.md'), '# README 标题\n')
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const first = await service.add(session, dir, '手动 note')
    // 再次 add 不带 note：自动提取 README 标题，但**不覆盖**现有手动 note。
    const again = await service.add(session, dir)
    expect(again).toEqual(first)
    expect(again.note).toBe('手动 note')
    const stored = await readSidecar(tmp, session.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.note).toBe('手动 note')
  })

  it('同路径 add 且显式 note 相同 → 幂等返回', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await service.add(session, dir, 'same')
    const again = await service.add(session, dir, 'same')
    expect(again.note).toBe('same')
  })

  it('同路径 add 且显式 note 不同 → 抛 RefLibDuplicateError（携带现有条目）', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    const first = await service.add(session, dir, '原始 note')
    const error = await service.add(session, dir, '新 note').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RefLibDuplicateError)
    expect((error as RefLibDuplicateError).entry).toEqual(first)
    // 抛错后不落盘（现有条目未被修改）
    const stored = await readSidecar(tmp, session.id)
    expect(stored[0]?.note).toBe('原始 note')
  })
})

describe('RefLibService v12.1（源读取实时探测、不写盘）', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('readSessionLibs 实时探测：目录删除后返回 missing（且不写回源 sidecar）', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const session = fakeSession()
    await service.add(session, dir)
    // 模拟"从未打开过该会话"：目录被外部删除后，sidecar 仍记录 available。
    await rm(dir, { recursive: true, force: true })
    const libs = service.readSessionLibs(session.id)
    expect(libs).toHaveLength(1)
    expect(libs[0]?.status).toBe('missing')
    // 不写回：sidecar 文件仍保持旧值（跨会话导入是只读参照）。
    const stored = await readSidecar(tmp, session.id)
    expect(stored[0]?.status).toBe('available')
  })

  it('listSessions 的 available 计数用实时探测结果', async () => {
    const dir = join(tmp, 'lib-a')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const sessionA = fakeSession()
    const sessionB = fakeSession()
    await service.add(sessionA, dir)
    await service.add(sessionB, dir)
    await rm(dir, { recursive: true, force: true })
    const sources = await service.listSessions()
    expect(sources).toHaveLength(2)
    for (const source of sources) expect(source.available).toBe(0)
  })
})
