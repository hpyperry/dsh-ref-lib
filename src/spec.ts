/**
 * ref-lib 类型声明。
 *
 * 参考库列表是 **per-session** 数据。**v3（2026-08-17 事故修复）起不再向会话日志写入
 * 自定义事件**：harness 的会话加载器只认仓库白名单 `KNOWN_SESSION_EVENT_TYPES` 内的
 * 事件类型，白名单外的必须带 `ignorable: true` 信封标记，而 `session.append()` 没有写入
 * 该标记的途径——写进去会让**整条会话日志被拒读**。v3 起状态存 dsh home 下 sidecar JSON
 * （见 `service.ts`）。
 *
 * v1/v2 用过的 `ref-lib/set` 事件类型**既不声明也不读取**：含它的旧日志在
 * ≥0.1.3-alpha.2 宿主上读取阶段就被整体拒读（v0→v1 迁移边拒绝未知事件类型，
 * 补 ignorable 标记也没用），折叠迁移无从触达，相关内容已删除。
 * 本文件只声明运行时数据模型，无全局配置。
 * @module @hpyperry/dsh-ref-lib/src/spec
 */

/** 目录在文件系统上的可用性（最近一次检测快照）。 */
export type RefLibAvailability = 'available' | 'missing' | 'not-directory'

/** 一个只读参考库条目。 */
export interface RefLibEntry {
  /** 稳定 id（uuid），与路径解耦（路径可规范化重写）。 */
  readonly id: string
  /** 规范化（realpath）后的目录绝对路径。 */
  readonly path: string
  /** 可选用途说明，注入上下文时展示。 */
  readonly note?: string
  /**
   * 最近一次可用性检测结果；无检测记录（v2 旧 sidecar / 旧日志迁移条目）时缺省，
   * 首次读取即探测。`missing` = 目录被删/不可达；`not-directory` = 路径被替换为文件。
   */
  readonly status?: RefLibAvailability
  /** 最近一次检测的 epoch ms；缺省视为"从未检测"（立即探测）。 */
  readonly checkedAt?: number
}
