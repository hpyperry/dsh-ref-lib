/**
 * 跨 node/client 共享的**零依赖**校验与消毒纯函数。
 *
 * node half（service/logic/render）与 client half（client/data.ts）分属两个构建
 * 产物，无法共享带 node 依赖的模块；本模块只依赖类型（spec.ts，type-only 导入
 * 在打包时被擦除），两半均可直接引用——消除 `isRefLibEntry` 在 logic.ts 与
 * client/data.ts 中的逐字重复，控制字符集合也在此统一维护。
 * @module @hpyperry/dsh-ref-lib/src/validate
 */

import type { RefLibEntry } from './spec.ts'

/**
 * 不可见控制字符集合（提示词注入卫生）：
 * C0（\u0000-\u001f）、DEL（\u007f）、C1（\u0080-\u009f）、行/段分隔符
 * （\u2028/\u2029——旧实现遗漏，同样能破坏注入格式）。
 * 用于 add 拒绝（service.ts）与渲染层兜底消毒（render.ts）。
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

/** 文本是否含不可见控制字符。 */
export function hasControlCharacters(text: string): boolean {
  return CONTROL_CHARACTERS.test(text)
}

/** 把全部不可见控制字符替换为 U+FFFD（路径/备注最终会进入系统提示词，兜底消毒）。 */
export function sanitizeControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS_GLOBAL, '\uFFFD')
}

/** 校验一个未知对象是否为合法条目（宽松：仅要求 id/path 字符串、note 可选字符串）。 */
export function isRefLibEntry(value: unknown): value is RefLibEntry {
  if (typeof value !== 'object' || value === null) return false
  const { id, path, note } = value as { id?: unknown; path?: unknown; note?: unknown }
  if (typeof id !== 'string' || typeof path !== 'string') return false
  return note === undefined || typeof note === 'string'
}
