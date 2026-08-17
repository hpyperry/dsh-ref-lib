/**
 * ref-lib 类型与事件声明。
 *
 * 参考库列表是 **per-session** 数据。**v3（2026-08-17 事故修复）起不再写入
 * `ref-lib/set` 会话事件**：harness 加载器不认仓库白名单外的自定义事件类型
 * （且 `session.append()` 无法写入 `ignorable` 标记），会把整条会话日志拒读。
 * v3 状态存于 dsh home 下 sidecar JSON（见 `service.ts`）。下方的
 * `SessionEventMap` 声明仅保留供**旧日志迁移折叠**（`foldRefLibs` 类型安全地
 * 读取历史 `ref-lib/set` 事件）。无全局配置。
 * @module @hpyperry/dsh-ref-lib/src/spec
 */

import type {} from '@deepseek-ai/dsh-session/types'

/** 一个只读参考库条目。 */
export interface RefLibEntry {
  /** 稳定 id（uuid），与路径解耦（路径可规范化重写）。 */
  readonly id: string
  /** 规范化（realpath）后的目录绝对路径。 */
  readonly path: string
  /** 可选用途说明，注入上下文时展示。 */
  readonly note?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * 参考库完整列表快照（log-only，per-session）：**v1/v2 遗留事件，v3 起不再
     * 写入**——该类型不在 harness 白名单内且无法标记 ignorable，写入会拒读整个
     * 会话日志。仅供迁移折叠（`foldRefLibs`）。
     */
    'ref-lib/set': { libs: readonly RefLibEntry[] }
  }
}
