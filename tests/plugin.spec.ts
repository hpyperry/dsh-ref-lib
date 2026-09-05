import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import RefLibPlugin from '../src/index.ts'

let counter = 0

/** fake session（装配测试只验证服务注册，不操作数据；rc.1 起读事件走 snapshotEvents）。 */
function fakeSession(): Session {
  const id = `session-test-${++counter}`
  const events: SessionEvent[] = []
  const header = { version: 0, id, createdAt: Date.now() } as SessionHeader
  return { id, header, snapshotEvents: () => events } as unknown as Session
}

/** 装配测试：模拟 loader 装载插件（await ctx.plugin 装配 Service 类）。 */
describe('RefLibPlugin 装配', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-plugin-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('装载后 ctx.refLibs 可用，per-session 列表初始为空', async () => {
    const ctx = new Context()
    await ctx.plugin(RefLibPlugin, { root: tmp })
    expect(ctx.refLibs).toBeDefined()
    expect(ctx.refLibs.list(fakeSession())).toEqual([])
  })

  it('重复装载同一插件抛错（name 冲突防护）', async () => {
    const ctx = new Context()
    await ctx.plugin(RefLibPlugin, { root: tmp })
    await expect(ctx.plugin(RefLibPlugin, { root: tmp })).rejects.toThrow()
  })
})
