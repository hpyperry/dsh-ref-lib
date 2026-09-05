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
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError } from '@deepseek-ai/dsh-session-persistence'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
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
    const entry = await service.add(session, libDir)
    expect(service.list(session)).toEqual([entry])
    await service.remove(session, entry.id)
    expect(session.snapshotEvents()).toEqual([]) // v3：插件操作零日志污染（rc.1 起经 snapshotEvents）
    // 模拟真实对话内容（平衡的一轮）
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await first.store.flush(session)
    await first.ctx.fiber.dispose()

    // 冷加载阶段：模拟重启（全新 ctx/store/backend 读同一根）
    const second = await boot(logsRoot)
    const inspection = await second.backend.load(sessionId)
    expect(inspection.events.map((event) => event.type)).toEqual(['turn/start', 'turn/end'])
    expect(inspection.events.filter((event) => event.type === 'ref-lib/set')).toEqual([])
    await second.ctx.fiber.dispose()
  })

  it('陷阱守卫：写白名单外事件（ref-lib/set）→ 冷加载抛 SessionFormatUnsupportedError', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-harness-'))
    const logsRoot = join(tmp, 'logs')
    await mkdir(logsRoot)
    const sessionId = SessionId('session-roundtrip-guard')

    const first = await boot(logsRoot)
    const session = first.store.create(sessionId)
    session.append('turn/start', { turn: 1 })
    // 旧版行为：往会话日志写自定义事件（v1/v2 的 ref-lib/set，无 ignorable 标记）
    session.append('ref-lib/set', { libs: [] })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await first.store.flush(session)
    await first.ctx.fiber.dispose()

    const second = await boot(logsRoot)
    await expect(second.backend.load(sessionId)).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
    await second.ctx.fiber.dispose()
  })
})
