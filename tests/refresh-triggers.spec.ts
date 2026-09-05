/**
 * 刷新触发信号派生（deriveRefreshTriggers）单测：会话快照节点 → 两个刷新计数。
 *
 * 钉死 RefLibDock 两个交互刷新 effect 的信号语义（设计文档 §14/§16）：
 * - userMessageCount：仅 `kind: 'user'` 计数；steering/context/tool 等其他节点不计；
 * - refLibCommandDone：仅已结算（outcome 非 null）的 `ref-lib` 命令计数；
 *   运行中（outcome null）、其他命令、name 为 null（run 落在窗口外）不计。
 *
 * 这些语义依赖 harness 会话节点折叠行为（rc.7 查证，见
 * src/client/refresh-triggers.ts 头部说明），本测试把该契约固化下来。
 */
import { describe, expect, it } from 'vitest'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { deriveRefreshTriggers } from '../src/client/refresh-triggers.ts'

/** 构造最小会话节点（仅测试派生逻辑所需的字段；kind 为判别键）。 */
function node(kind: string, extra: Record<string, unknown> = {}): ConversationNode {
  return { kind, ...extra } as unknown as ConversationNode
}

/** 运行中的 ref-lib 命令节点（outcome null）。 */
function runningRefLibCommand(): ConversationNode {
  return node('command', { name: 'ref-lib', outcome: null })
}

/** 已结算的 ref-lib 命令节点（成功/失败都算结算）。 */
function settledRefLibCommand(kind: 'success' | 'error' = 'success'): ConversationNode {
  return node('command', { name: 'ref-lib', outcome: { kind } })
}

describe('deriveRefreshTriggers（会话快照 → 刷新计数）', () => {
  it('空列表：两个计数均为 0', () => {
    expect(deriveRefreshTriggers([])).toEqual({ userMessageCount: 0, refLibCommandDone: 0 })
  })

  it('user 节点计数：普通人类消息 +1，多条累加', () => {
    const nodes = [node('user'), node('assistant'), node('user')]
    expect(deriveRefreshTriggers(nodes).userMessageCount).toBe(2)
    expect(deriveRefreshTriggers(nodes).refLibCommandDone).toBe(0)
  })

  it('非 user 节点不计数：steering / context / tool-result / 其他命令 / assistant', () => {
    const nodes = [
      node('steering'),
      node('context'),
      node('tool-result', { callId: 'c1', content: [], isError: false }),
      node('command', { name: 'goal', outcome: { kind: 'success' } }),
      node('assistant', { messageId: 'm1', blocks: [], turn: 1, step: 1 }),
    ]
    const triggers = deriveRefreshTriggers(nodes)
    expect(triggers.userMessageCount).toBe(0)
    expect(triggers.refLibCommandDone).toBe(0)
  })

  it('ref-lib 命令运行中（outcome null）不计数', () => {
    const triggers = deriveRefreshTriggers([runningRefLibCommand()])
    expect(triggers.refLibCommandDone).toBe(0)
  })

  it('ref-lib 命令结算（success）计数 +1', () => {
    const triggers = deriveRefreshTriggers([settledRefLibCommand('success')])
    expect(triggers.refLibCommandDone).toBe(1)
  })

  it('ref-lib 命令结算（error）同样计数（失败也触发刷新）', () => {
    const triggers = deriveRefreshTriggers([settledRefLibCommand('error')])
    expect(triggers.refLibCommandDone).toBe(1)
  })

  it('其他命令（goal/plan）结算不影响 ref-lib 计数', () => {
    const nodes = [
      node('command', { name: 'goal', outcome: { kind: 'success' } }),
      node('command', { name: 'plan', outcome: { kind: 'success' } }),
      settledRefLibCommand(),
    ]
    const triggers = deriveRefreshTriggers(nodes)
    expect(triggers.refLibCommandDone).toBe(1)
  })

  it('name 为 null（command/run 落在窗口外）的 ref-lib 命令不计数', () => {
    const nodes = [node('command', { name: null, outcome: { kind: 'success' } })]
    expect(deriveRefreshTriggers(nodes).refLibCommandDone).toBe(0)
  })

  it('单次遍历同时派生两个计数（混合场景）', () => {
    const nodes = [
      node('user'),                                   // user 1
      runningRefLibCommand(),                          // 运行中：不计
      node('command', { name: 'goal', outcome: { kind: 'success' } }),
      settledRefLibCommand(),                          // ref-lib done 1
      node('user'),                                    // user 2
      node('steering'),                                // 不计
      settledRefLibCommand('error'),                   // ref-lib done 2（失败也计）
    ]
    expect(deriveRefreshTriggers(nodes)).toEqual({ userMessageCount: 2, refLibCommandDone: 2 })
  })

  it('窗口变化（loadOlder 增加旧节点）会增减计数——调用方按 effect 依赖语义处理', () => {
    // 旧 user 节点进入窗口 → 计数增加（触发一次额外静默刷新，RefreshGuard 吸收）。
    const before = deriveRefreshTriggers([node('user')])
    const after = deriveRefreshTriggers([node('user'), node('user', { seq: 0 })])
    expect(before.userMessageCount).toBe(1)
    expect(after.userMessageCount).toBe(2)
  })
})
