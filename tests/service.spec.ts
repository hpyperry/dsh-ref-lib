import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RefLibPathError, RefLibService, RefLibUnknownError } from '../src/service.ts'
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
    // 迁移结果已落盘
    expect(await readSidecar(tmp, session.id)).toEqual([{ id: 'old-1', path: '/old/lib' }])
  })

  it('继承：子会话无自身状态时继承父会话列表', async () => {
    const dir = join(tmp, 'lib-parent')
    await mkdir(dir)
    const service = new RefLibService(new Context(), { root: tmp })
    const parent = fakeSession()
    await service.add(parent, dir)
    const child = fakeSession({ parentSession: parent.id })
    expect(service.list(child).map((entry) => entry.path)).toEqual([dir])
    // 子会话自身尚未落盘（无独立状态）
    await expect(readFile(sidecarPath(tmp, child.id), 'utf8')).rejects.toThrow()
  })
})
