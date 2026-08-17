/**
 * client 端数据纯函数：/api/ref-lib/* 路由响应解析、错误码解析与路径展示。
 * 独立于 React / runtime，便于单元测试。
 *
 * v5：路由错误响应新增 wire code（ref-lib/missing 等），client 据此把
 * node 端的中文错误消息映射为当前语言的本地化文案（优化点 2 的语言适配）。
 * @module @hpyperry/dsh-ref-lib/src/client/data
 */

import type { RefLibEntry } from '../spec.ts'
import { isRefLibEntry } from '../validate.ts'

/** 路由错误载荷里的附加字段。 */
export interface RefLibApiErrorDetails {
  /** 出错的目录路径（missing/not-directory/unsafe）。 */
  readonly path?: string
  /** 未找到的条目 id（unknown-id）。 */
  readonly id?: string
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
  const { error, code, path, id } = value as {
    error?: unknown
    code?: unknown
    path?: unknown
    id?: unknown
  }
  if (typeof code !== 'string' || code === '') return null
  const details: RefLibApiErrorDetails = {
    ...(typeof path === 'string' ? { path } : {}),
    ...(typeof id === 'string' ? { id } : {}),
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
