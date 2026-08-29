/**
 * client 端数据纯函数：/api/ref-lib/* 路由响应解析、错误码解析与路径展示。
 * 独立于 React / runtime，便于单元测试。
 *
 * v5：路由错误响应新增 wire code（ref-lib/missing 等），client 据此把
 * node 端的中文错误消息映射为当前语言的本地化文案（优化点 2 的语言适配）。
 * @module @hpyperry/dsh-ref-lib/src/client/data
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RefLibEntry } from '../spec.ts'
import { isRefLibEntry } from '../validate.ts'
import type { RefLibKey } from './locales.ts'

/** 路由错误载荷里的附加字段。 */
export interface RefLibApiErrorDetails {
  /** 出错的目录路径（missing/not-directory/unsafe）。 */
  readonly path?: string
  /** 未找到的条目 id（unknown-id）。 */
  readonly id?: string
  /** 同路径已注册的现有条目（duplicate——用于「保留现有/覆盖」确认）。 */
  readonly entry?: RefLibEntry
}

/** 带 wire code 的 API 错误：code 用于本地化文案映射，message 为原始消息兜底。 */
export class RefLibApiError extends Error {
  /**
   * @param code - wire 错误码（如 ref-lib/missing）。
   * @param message - 服务端原始错误消息。
   * @param details - 附加字段（path/id）。
   */
  constructor(
    readonly code: string,
    message: string,
    readonly details: RefLibApiErrorDetails = {},
  ) {
    super(message)
    this.name = 'RefLibApiError'
  }
}

/**
 * 从失败的 /api/ref-lib/* 响应体解析错误码；无 code 的畸形体返回 null。
 * @param value - 非 2xx 响应体（可为任意 JSON）。
 * @returns 错误码 + 原始消息 + 附加字段；无法解析时为 null。
 */
export function parseApiErrorPayload(value: unknown): {
  code: string
  message: string
  details: RefLibApiErrorDetails
} | null {
  if (typeof value !== 'object' || value === null) return null
  const { error, code, path, id, entry } = value as {
    error?: unknown
    code?: unknown
    path?: unknown
    id?: unknown
    entry?: unknown
  }
  if (typeof code !== 'string' || code === '') return null
  const details: RefLibApiErrorDetails = {
    ...(typeof path === 'string' ? { path } : {}),
    ...(typeof id === 'string' ? { id } : {}),
    ...(isRefLibEntry(entry) ? { entry } : {}),
  }
  return { code, message: typeof error === 'string' ? error : code, details }
}

/**
 * 从 /api/ref-lib/list 路由响应（{ libs: [...] }）解析参考库列表；
 * 缺失/畸形返回空列表。
 * @param value - 路由响应体。
 * @returns 当前参考库列表。
 */
export function parseLibsPayload(value: unknown): RefLibEntry[] {
  if (typeof value !== 'object' || value === null) return []
  const libs = (value as { libs?: unknown }).libs
  if (!Array.isArray(libs)) return []
  return libs.filter(isRefLibEntry)
}

/**
 * 提取目录路径的展示用基名（列表行主行的可读标题）。
 * 兼容 POSIX 与 Windows 分隔符；去掉尾部分隔符后取最后一段；
 * 根路径（/、C:\）原样返回。
 * @param path - 规范化绝对路径。
 * @returns 基名（如 /a/b/core → core）。
 */
export function libBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path
  // Windows 盘符根（C:）不是基名，原样返回带分隔符的根路径（C:\\）。
  if (/^[A-Za-z]:$/.test(trimmed)) return path
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

/** 跨会话导入：源会话概览（GET /api/ref-lib/sessions 响应的会话行）。 */
export interface RefLibSourceSession {
  readonly sessionId: string
  /** 宿主 sessionQuery 读到的标题（`session/title` 事件折叠）；缺省时 UI 回退显示工作区名。 */
  readonly title?: string
  /** 会话工作区目录（header.cwd）；无标题时用于显示"工作区名 · 新会话"。 */
  readonly cwd?: string
  /** 注册工作区 display title（v15 分组键）；缺省 = 未归属工作区（归入「未分组」）。 */
  readonly workspace?: string
  readonly count: number
  readonly available: number
  readonly updatedAt: number
}

/**
 * 从 /api/ref-lib/sessions 路由响应（{ sessions: [...] }）解析源会话清单；
 * 缺失/畸形行被丢弃（会话行缺关键字段即跳过，不整体失败）。
 * @param value - 路由响应体。
 * @returns 源会话清单（按服务端顺序，即最近活跃在前）。
 */
export function parseSessionsPayload(value: unknown): RefLibSourceSession[] {
  if (typeof value !== 'object' || value === null) return []
  const sessions = (value as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) return []
  const out: RefLibSourceSession[] = []
  for (const row of sessions) {
    if (typeof row !== 'object' || row === null) continue
    const { sessionId, title, cwd, workspace, count, available, updatedAt } = row as {
      sessionId?: unknown
      title?: unknown
      cwd?: unknown
      workspace?: unknown
      count?: unknown
      available?: unknown
      updatedAt?: unknown
    }
    if (typeof sessionId !== 'string' || sessionId === '') continue
    if (typeof count !== 'number' || typeof available !== 'number' || typeof updatedAt !== 'number') continue
    out.push({
      sessionId,
      ...(typeof title === 'string' && title !== '' ? { title } : {}),
      ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),
      ...(typeof workspace === 'string' && workspace !== '' ? { workspace } : {}),
      count,
      available,
      updatedAt,
    })
  }
  return out
}

/** 跨会话导入：工作区组概览（v16 懒加载第一级，`groups=1` 响应行；不含标题）。 */
export interface RefLibImportGroup {
  /** 组 wire 键（= 工作区标题或未分组哨兵），按组加载会话时原样回传。 */
  readonly key: string
  /** 注册工作区 display title；缺省 = 未分组兜底组。 */
  readonly workspace?: string
  /** 组内会话数。 */
  readonly count: number
}

/**
 * 从 `/api/ref-lib/sessions?groups=1` 路由响应（{ groups: [...] }）解析工作区组
 * 概览；缺失/畸形行被丢弃（组键或计数缺关键字段即跳过，不整体失败）。
 * @param value - 路由响应体。
 * @returns 组概览（按服务端顺序，即组内最近活跃降序）。
 */
export function parseGroupsPayload(value: unknown): RefLibImportGroup[] {
  if (typeof value !== 'object' || value === null) return []
  const groups = (value as { groups?: unknown }).groups
  if (!Array.isArray(groups)) return []
  const out: RefLibImportGroup[] = []
  for (const row of groups) {
    if (typeof row !== 'object' || row === null) continue
    const { key, workspace, count } = row as { key?: unknown; workspace?: unknown; count?: unknown }
    if (typeof key !== 'string' || key === '') continue
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) continue
    out.push({
      key,
      ...(typeof workspace === 'string' && workspace !== '' ? { workspace } : {}),
      count,
    })
  }
  return out
}

/** 跨会话导入：一条冲突（path 相同）的并排对比信息，含 diff 高亮字段。 */
export interface ImportConflict {  /** 当前会话的条目。 */
  readonly mine: RefLibEntry
  /** 源会话的条目。 */
  readonly incoming: RefLibEntry
  /** note 不同（含一侧无 note）——diff 弹窗高亮。 */
  readonly noteDiffers: boolean
  /** 可用状态不同（含一侧未检测）——diff 弹窗高亮。 */
  readonly statusDiffers: boolean
}

/** classifyImport 的结果：无冲突的源条目 + 冲突配对。 */
export interface ImportClassification {
  /** 源会话中与当前会话无重复（path 不同）的条目——直接可导入。 */
  readonly additions: readonly RefLibEntry[]
  /** path 相同的冲突配对（每条由用户在 diff 弹窗决策保留哪份）。 */
  readonly conflicts: readonly ImportConflict[]
}

/**
 * 分类跨会话导入的源条目（v12）：按**规范化绝对路径**判定重复（条目在 add/导入时
 * 已 realpath 规范化，字符串比较即等价路径比较）。纯函数，便于单元测试。
 * @param mine - 当前会话条目列表。
 * @param incoming - 源会话条目列表（完整）。
 * @returns 无冲突条目与冲突配对。
 */
export function classifyImport(mine: readonly RefLibEntry[], incoming: readonly RefLibEntry[]): ImportClassification {
  const additions: RefLibEntry[] = []
  const conflicts: ImportConflict[] = []
  for (const entry of incoming) {
    const existing = mine.find((candidate) => candidate.path === entry.path)
    if (existing === undefined) {
      additions.push(entry)
      continue
    }
    conflicts.push({
      mine: existing,
      incoming: entry,
      noteDiffers: (existing.note ?? '') !== (entry.note ?? ''),
      statusDiffers: existing.status !== entry.status,
    })
  }
  return { additions, conflicts }
}

/** wire 错误码 → 本地化文案键（未知码回退原始消息）。 */
const ERROR_KEYS: Record<string, RefLibKey> = {
  'ref-lib/missing': 'error.missing',
  'ref-lib/not-directory': 'error.notDirectory',
  'ref-lib/unsafe': 'error.unsafe',
  'ref-lib/unknown-id': 'error.unknownId',
  'ref-lib/unavailable': 'error.unavailable',
}

/** 把未知错误规整为可展示文案。 */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 把 API 错误本地化（v12 起供面板错误槽与导入流程内错误条共用）：
 * 已知 wire code 映射为当前语言文案（带 path/id 参数），其余错误原样展示服务端消息。
 * @param cause - 捕获的错误。
 * @param t - 本地化取词。
 * @returns 展示用文案。
 */
export function formatRefLibError(cause: unknown, t: TranslateNS<'ref-lib'>): string {
  if (cause instanceof RefLibApiError) {
    const key = ERROR_KEYS[cause.code]
    if (key !== undefined) {
      const params =
        cause.details.path !== undefined
          ? { path: cause.details.path }
          : cause.details.id !== undefined
            ? { id: cause.details.id }
            : undefined
      return t(key, params)
    }
  }
  return messageOf(cause)
}
