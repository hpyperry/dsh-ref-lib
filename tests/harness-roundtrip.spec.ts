// L2：harness 边界回归（事故防线）
/**
 * harness 边界回归测试（2026-08-17 事故防线）。
 *
 * 用**真实**会话持久化栈（`SessionStore` + `JsonlSessionPersistence` +
 * `PersistenceCoordinator`，即 GUI 同款）在临时根上跑完整回路：
 * 写会话 → flush 落盘 → 全新 ctx/store/backend 冷加载。
 *
 * - **v3 保证**：add/remove/list 不写任何会话事件；插件使用后日志冷加载成功、
 *   事件往返一致、不含 `ref-lib/set`；
 * - **陷阱守卫**：往会话写白名单外事件（旧版 `ref-lib/set`）→ 冷加载必须抛
 *   `SessionFormatUnsupportedError`——即本次事故的精确复现，防止插件回退到
 *   "把状态写进会话日志"的旧设计。
 *
 * **v18 依赖契约变更**：`dsh-session-persistence-jsonl` 自 **0.1.3-alpha.1** 起把后端
 * 契约改为「**默认导出** + `open(id, access) → SessionHandle`（`read()` 取事件）」，
 * 取代 0.1.2-rc.1 及以前的「具名导出 + `load(id) → SessionInspection`」。本轨
 * （devDeps pin `0.1.5-rc.2`）按新契约书写；旧写法在 0.1.5 上会先报
 * `JsonlSessionPersistence is not a constructor`、改对导出后报 `backend.load is not a function`。
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { RefLibService } from '../src/service.ts'

let tmp: string | undefined

afterEach(async () => {
  if (tmp !== undefined) await rm(tmp, { recursive: true, force: true })
  tmp = undefined
})

/** 启动一套独立会话栈（ctx + SessionStore + JSONL 持久化后端，临时根）。 */
async function boot(root: string): Promise<{ ctx: Context; store: SessionStore; backend: JsonlSessionPersistence }> {
  const ctx = new Context()
  const store = new SessionStore(ctx)
  const backend = new JsonlSessionPersistence(ctx, { root })
  return { ctx, store, backend }
}

/**
 * v18 契约：**必须有活跃写句柄才会落盘**。
 *
 * 0.1.3-alpha.1 起持久化后端按「写所有权」工作——`SessionStore.flush()` 只派发
 * `session/flush` 事件，真正写盘的是持有写句柄的那条路径（生产环境由 agent-loop
 * 在 `create`/`resume` 时经 `persistence.create(header)` / `open(id,'write')` 取得）。
 * 所以冷读回归必须先取写句柄，否则 `store.flush()` 虽然没有监听者参与（返回
 * `false`）、磁盘上什么都没有，冷读只会报 `SessionPersistenceNotFoundError`。
 * @param stack - boot() 返回的会话栈。
 * @param session - 由该栈的 store 创建的会话。
 * @returns 写句柄；调用方负责 `close()`（close 会排空并落盘）。
 */
async function claimWrite(
  stack: { backend: JsonlSessionPersistence },
  session: { header: SessionHeader },
): Promise<SessionHandle> {
  return await stack.backend.create(session.header)
}

describe('harness 边界回归（会话日志可加载性）', () => {
  it('v3：插件 add/remove 后会话日志可冷加载，且不含 ref-lib/set', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-harness-'))
    const logsRoot = join(tmp, 'logs') // 持久化后端根（模拟 ~/.dsh/sessions）
    const sidecarRoot = join(tmp, 'sidecar') // 插件 sidecar 根（生产为 ~/.dsh/plugin-data/ref-lib）
    await mkdir(logsRoot)
    const libDir = join(tmp, 'lib-a')
    await mkdir(libDir)
    const sessionId = SessionId('session-roundtrip-v3')

    // 写阶段：真实会话 + 插件操作（v3 不产生任何会话事件）
    const first = await boot(logsRoot)
    const service = new RefLibService(first.ctx, { root: sidecarRoot })
    const session = first.store.create(sessionId)
    const writer = await claimWrite(first, session)
    const entry = await service.add(session, libDir)
    expect(service.list(session)).toEqual([entry])
    await service.remove(session, entry.id)
    expect(session.snapshotEvents()).toEqual([]) // v3：插件操作零日志污染（rc.1 起经 snapshotEvents）
    // 模拟真实对话内容（平衡的一轮）
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // flush 必须真有监听者参与（否则说明持久化链路没接上，冷读会误报 not found）
    expect(await first.store.flush(session)).toBe(true)
    await writer.close()
    await first.ctx.fiber.dispose()

    // 冷加载阶段：模拟重启（全新 ctx/store/backend 读同一根）。
    // v18：只读打开 → `read()` 取事件（0.1.3-alpha.1 起的 SessionHandle 契约）。
    const second = await boot(logsRoot)
    const handle = await second.backend.open(sessionId, 'read')
    const { events } = await handle.read()
    expect(events.map((event) => event.type)).toEqual(['turn/start', 'turn/end'])
    expect(events.filter((event) => (event.type as string) === 'ref-lib/set')).toEqual([])
    await handle.close()
    await second.ctx.fiber.dispose()
  })

  it('陷阱守卫：写白名单外事件（ref-lib/set）→ 冷加载抛 SessionFormatUnsupportedError', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-harness-'))
    const logsRoot = join(tmp, 'logs')
    await mkdir(logsRoot)
    const sessionId = SessionId('session-roundtrip-guard')

    const first = await boot(logsRoot)
    const session = first.store.create(sessionId)
    const writer = await claimWrite(first, session)
    session.append('turn/start', { turn: 1 })
    // 旧版行为：往会话日志写自定义事件（v1/v2 的 ref-lib/set，无 ignorable 标记）。
    // 该类型已不在官方 SessionEventMap 内（本插件不再声明它），这里刻意绕过类型检查。
    ;(session.append as unknown as (type: string, data: unknown) => void)('ref-lib/set', { libs: [] })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(await first.store.flush(session)).toBe(true)
    await writer.close()
    await first.ctx.fiber.dispose()

    const second = await boot(logsRoot)
    // v18：拒读可能发生在 open（读取即校验）或 read（惰性解码），两处都夹住。
    await expect((async () => {
      const handle = await second.backend.open(sessionId, 'read')
      await handle.read()
    })()).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
    await second.ctx.fiber.dispose()
  })
})
