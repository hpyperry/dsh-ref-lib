/**
 * 参考库列表折叠与变换的纯函数：不依赖 session / 文件系统，便于单元测试。
 * @module @hpyperry/dsh-ref-lib/src/logic
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
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
