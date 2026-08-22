/**
 * 会话快照 → UI 刷新触发信号的纯函数派生（v9 交互驱动同步的信号源）。
 *
 * 交互驱动刷新依赖两个「从会话快照节点派生」的信号（RefLibDock 内两个 effect 的
 * 依赖项）：
 * - `userMessageCount`：`kind: 'user'` 节点计数——普通人类消息落盘后 +1，
 *   驱动「发消息即刷新」；
 * - `refLibCommandDone`：`kind: 'command'` 且 `name === 'ref-lib'` 且已结算
 *   （`outcome !== null`）的节点计数——`/ref-lib` 命令完成后 +1，驱动「命令执行
 *   即刷新」。
 *
 * 派生依据已在 deepseek-harness @ dsh-v0.1.0-rc.7 源码逐条查证（设计文档 §16）：
 * - dock 槽位 owner 的 `session` 是响应式会话快照：ConversationRoot 经
 *   `useSession(s => s)` 订阅会话 store，每次发布都重渲染 dock（
 *   `ui-conversation/src/client/skeleton/ConversationRoot.tsx`）；
 * - `user/message`（`source.kind === 'user'` 且未被收件箱认领）折叠为
 *   `kind: 'user'` 节点；goal 轮次等插件注入为 `kind: 'context'`（source 非 user），
 *   steer 消息为 `kind: 'steering'`——后两者不增本计数
 *   （`ui-conversation/src/client/conversation-nodes/message.ts`）；
 * - 宿主命令执行器对每个匹配命令 append log-only `command/run` → `command/done`
 *   对（运行中 `outcome` 为 null，结算后置值）；命令名是 typed name（无别名机制、
 *   重名注册 fail loud），故 `name === 'ref-lib'` 过滤精确
 *   （`interaction/commands/src/index.ts` + `conversation-nodes/command.ts`）。
 *
 * 已知信号盲区（设计取舍，见设计文档 §14/§16）：
 * - steer 打断消息永不产生 `'user'` 节点 → 不触发发消息刷新（无状态变更，可接受）；
 * - 忙碌期排队消息的 `user/message` 在 step 领取时才落盘 → 计数延迟至消息进入步骤；
 * - `command/run` 落在窗口外（压缩/截断）时节点 `name` 为 null → 不增
 *   `refLibCommandDone`（罕见边界）；
 * - 窗口长度变化（loadOlder/压缩/补拉）会增减计数 → 额外静默刷新（RefreshGuard 吸收）。
 *
 * 单次遍历同时派生两个计数（避免每次渲染两趟全量 filter）。
 * @module @hpyperry/dsh-ref-lib/src/client/refresh-triggers
 */

import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

/** 一次快照派生的刷新触发计数（RefLibDock 两个 effect 的依赖值）。 */
export interface RefreshTriggerCounts {
  /** `kind: 'user'` 节点数（普通人类消息；steer/context 不计）。 */
  readonly userMessageCount: number
  /** 已结算（outcome 非 null）的 `ref-lib` 命令节点数；运行中不计。 */
  readonly refLibCommandDone: number
}

/**
 * 从会话快照节点列表派生刷新触发计数。
 * @param nodes - `session.nodes`（窗口内全部会话节点，结构子集即可）。
 * @returns 两个计数；空列表返回 `{ userMessageCount: 0, refLibCommandDone: 0 }`。
 */
export function deriveRefreshTriggers(nodes: readonly ConversationNode[]): RefreshTriggerCounts {
  let userMessageCount = 0
  let refLibCommandDone = 0
  for (const node of nodes) {
    if (node.kind === 'user') {
      userMessageCount += 1
    } else if (node.kind === 'command' && node.name === 'ref-lib' && node.outcome !== null) {
      refLibCommandDone += 1
    }
  }
  return { userMessageCount, refLibCommandDone }
}
