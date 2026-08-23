/**
 * 参考库列表折叠与变换的纯函数：不依赖 session / 文件系统，便于单元测试。
 * @module @hpyperry/dsh-ref-lib/src/logic
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import type { RefLibAvailability, RefLibEntry } from './spec.ts'
import { isRefLibEntry } from './validate.ts'

/**
 * 从 session 事件流折叠出参考库列表（取最后一个合法 `ref-lib/set` 的完整快照；
 * 无事件时为初始空列表）。v3 起仅用于迁移旧日志中已存在的 `ref-lib/set` 事件。
 * 防御性校验：旧日志/手改数据可能畸形（libs 非数组、条目缺字段），畸形事件被
 * 忽略并保留上一个有效快照——`list()` 的冷读路径会在 systemPrompt context 回调
 * 中被调用（无 try/catch），不能在这里抛错。
 * @param events - session 事件流（可能含历史 `ref-lib/set`）。
 * @returns 当前参考库列表。
 */
export function foldRefLibs(events: readonly SessionEvent[]): RefLibEntry[] {
  let libs: RefLibEntry[] = []
  for (const event of events) {
    if (event.type !== 'ref-lib/set') continue
    const data = (event.data as { libs?: unknown } | undefined)?.libs
    if (Array.isArray(data)) libs = data.filter(isRefLibEntry)
  }
  return libs
}

/**
 * 追加一个新条目。已存在同 id 或同 path（规范化后）的条目时不重复添加，
 * 返回原列表不变（幂等）。
 * @param list - 现有列表。
 * @param entry - 待追加条目。
 * @returns 追加后的新列表。
 */
export function upsertLib(list: readonly RefLibEntry[], entry: RefLibEntry): RefLibEntry[] {
  if (list.some((existing) => existing.id === entry.id || existing.path === entry.path)) {
    return [...list]
  }
  return [...list, entry]
}

/**
 * 按 id 移除条目；未知 id 幂等返回原列表。
 * @param list - 现有列表。
 * @param id - 待移除条目 id。
 * @returns 移除后的新列表。
 */
export function removeLib(list: readonly RefLibEntry[], id: string): RefLibEntry[] {
  return list.filter((entry) => entry.id !== id)
}

/**
 * 注入过滤：仅保留可用条目。失效（missing/not-directory）与未检测（status 缺省）
 * 条目一律不注入——注入的是"可用参考"，失效目录读了也白读，且避免误导模型访问
 * 不存在的路径。调用方（service.list）保证 status 在返回前已实时探测。
 * @param libs - 全部条目（含失效）。
 * @returns 仅 `status === 'available'` 的条目。
 */
export function filterAvailable(libs: readonly RefLibEntry[]): RefLibEntry[] {
  return libs.filter((entry) => entry.status === 'available')
}

/**
 * 探测结果是否与条目当前 status 不同（决定是否写盘）。
 * @param entry - 条目（可能无检测记录）。
 * @param probe - 最新探测结果。
 * @returns true 表示需要把探测结果落盘：条目从未检测（status 缺省），或结果已变化。
 */
export function statusChanged(entry: RefLibEntry, probe: RefLibAvailability): boolean {
  return entry.status === undefined || entry.status !== probe
}

/** 跨会话导入：一条「新增」请求（路径在源会话已规范化，note 保持源值、快照语义）。 */
export interface ImportAddRequest {
  readonly path: string
  readonly note?: string
}

/** 跨会话导入：一条「替换」请求（冲突且用户选择使用导入版本；路径已存在，仅采纳导入的 note）。 */
export interface ImportReplaceRequest {
  /** 现有条目 id（替换目标）。 */
  readonly existingId: string
  /** 导入侧 note（undefined 表示清除现有 note）。 */
  readonly note?: string
}

/** 跨会话导入的规划结果：新增条目 + 替换条目。 */
export interface ImportPlan {
  readonly additions: readonly ImportAddRequest[]
  readonly replacements: readonly ImportReplaceRequest[]
}

/**
 * 规划跨会话导入（v12）：把「当前列表 + 源会话条目 + 冲突决策」映射为最终写入动作。
 * 语义与 v10 fork 继承一致——导入即快照：新条目重新铸造 id（由 service 执行），
 * 冲突条目按用户逐条决策（保留我的 = 跳过；使用导入的 = 以导入侧 note 替换现有）。
 * 纯函数：不触碰文件系统/session，便于单元测试。
 * @param mine - 当前会话条目列表。
 * @param incoming - 源会话条目列表（全部，含无冲突与冲突）。
 * @param resolveConflict - 对每条重复（path 相同）的冲突返回用户决策；
 *   `'mine'` 保留现有条目，`'import'` 用导入条目替换。
 * @returns 新增与替换请求；无冲突且未决策的条目一律视为新增。
 */
export function planImport(
  mine: readonly RefLibEntry[],
  incoming: readonly RefLibEntry[],
  resolveConflict: (mineEntry: RefLibEntry, incomingEntry: RefLibEntry) => 'mine' | 'import',
): ImportPlan {
  const additions: ImportAddRequest[] = []
  const replacements: ImportReplaceRequest[] = []
  for (const entry of incoming) {
    const existing = mine.find((candidate) => candidate.path === entry.path)
    if (existing === undefined) {
      additions.push({ path: entry.path, ...(entry.note === undefined ? {} : { note: entry.note }) })
      continue
    }
    if (resolveConflict(existing, entry) === 'import') {
      replacements.push({ existingId: existing.id, ...(entry.note === undefined ? {} : { note: entry.note }) })
    }
  }
  return { additions, replacements }
}

/** 跨会话导入：源会话概览（sidecar 枚举 + 宿主 sessionQuery 标题补全后的行）。 */
export interface RefLibSourceSessionRow {
  /** 源会话 id。 */
  readonly sessionId: string
  /** 宿主 sessionQuery 读到的标题（`session/title` 事件折叠）；缺省时 UI 回退显示 id。 */
  readonly title?: string
  /** 会话工作区目录（header.cwd，宿主 sessionQuery 观测）；缺省时 UI 无工作区回退。 */
  readonly cwd?: string
  /** 条目数。 */
  readonly count: number
  /** 可用条目数。 */
  readonly available: number
  /** sidecar mtime（epoch ms）。 */
  readonly updatedAt: number
}

/**
 * 把宿主 `sessionQuery.readTitleSnapshots` 的结果合并进源会话清单（v12 标题补全，
 * 与宿主 `@session` 引用同源——`session/title` 事件折叠，冷会话同样可读）。
 * 同时补全会话工作区 cwd（无标题会话的 UI 显示回退"工作区名 · 新会话"）。
 * 纯函数：观测缺省/失败/字段缺失时该会话保持原值（UI 逐级回退）。
 * @param sources - sidecar 枚举的源会话清单。
 * @param observations - 按源清单 id 顺序对应的观测结果（数量不足/多余都容忍）。
 * @returns 补全标题与工作区后的清单（id 顺序与入参一致）。
 */
export function attachSessionMeta(
  sources: readonly RefLibSourceSessionRow[],
  observations: readonly SessionTitleObservationResult[],
): RefLibSourceSessionRow[] {
  return sources.map((source, index) => {
    const observation = observations[index]
    if (observation?.status !== 'fulfilled') return source
    // 官方类型下 value.session（SessionHeader）必填；optional chain 防御运行时异常观测。
    const title = observation.value.title?.title
    const cwd = observation.value.session?.cwd
    const next = { ...source }
    if (title !== undefined && title !== '') next.title = title
    if (cwd !== undefined && cwd !== '') next.cwd = cwd
    return next
  })
}

/**
 * 对一条目应用探测结果（v12.1 源读取实时探测）：状态未变（或从未检测）时返回
 * **原引用**，变化时返回带新 status/checkedAt 的新对象。纯函数（探测函数注入，
 * logic 层不触碰文件系统）。
 * @param entry - 条目。
 * @param probe - 探测函数（路径 → 可用性）。
 * @param now - 探测时间（epoch ms）。
 * @returns 探测后的条目（无变化时引用不变）。
 */
export function applyProbe(
  entry: RefLibEntry,
  probe: (path: string) => RefLibAvailability,
  now: number,
): RefLibEntry {
  const result = probe(entry.path)
  if (!statusChanged(entry, result)) return entry
  return { ...entry, status: result, checkedAt: now }
}

/**
 * 批量探测条目（v12.1）：逐条 applyProbe，返回探测后的列表与是否有变化。
 * @param libs - 条目列表。
 * @param probe - 探测函数（路径 → 可用性）。
 * @param now - 探测时间（epoch ms）。
 * @returns 探测后列表（无变化时引用不变）+ 是否有条目状态变化。
 */
export function probeLibs(
  libs: readonly RefLibEntry[],
  probe: (path: string) => RefLibAvailability,
  now: number,
): { next: readonly RefLibEntry[]; changed: boolean } {
  let changed = false
  const next = libs.map((entry) => {
    const probed = applyProbe(entry, probe, now)
    if (probed !== entry) changed = true
    return probed
  })
  return { next, changed }
}
