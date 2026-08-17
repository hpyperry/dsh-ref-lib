/**
 * systemPrompt 注入文本的纯渲染函数。
 * @module @hpyperry/dsh-ref-lib/src/render
 */

import type { RefLibEntry } from './spec.ts'
import { sanitizeControlCharacters } from './validate.ts'

/**
 * 渲染参考库清单与只读约束声明。空列表返回空串（不占用模型上下文 token）。
 * @param libs - 已注册的只读参考库。
 * @returns 注入到系统提示的文本；无库时为空串。
 */
export function renderRefLibs(libs: readonly RefLibEntry[]): string {
  if (libs.length === 0) return ''
  const lines = libs.map((entry) => {
    const note = entry.note === undefined || entry.note === '' ? '' : `（${sanitizeControlCharacters(entry.note)}）`
    return `- ${sanitizeControlCharacters(entry.path)}${note}`
  })
  return [
    '只读参考库：以下目录作为可参考库按需使用——不要主动遍历或全量读取，仅当任务需要时才读取具体文件（大文件先读其索引/README）。',
    '查询优先级：当需要查证信息、规范或依据时，优先在上述参考库目录内检索（先读其索引/README，再按需读取具体文件），确认参考库未覆盖或不足以回答后，才改用其他途径（如网络搜索等）。',
    '只读约束：禁止创建、修改或删除其中任何文件；如需改动，先把文件复制到当前工作区。',
    ...lines,
  ].join('\n')
}

/**
 * 渲染 `/ref-lib list` 的人类可读输出。
 * @param libs - 已注册的只读参考库。
 * @returns 列表文本；无库时提示为空。
 */
export function renderLibList(libs: readonly RefLibEntry[]): string {
  if (libs.length === 0) return '当前没有已注册的只读参考库。使用 /ref-lib add <path> 添加。'
  return libs
    .map((entry) => {
      const note = entry.note === undefined || entry.note === '' ? '' : `（${sanitizeControlCharacters(entry.note)}）`
      return `- ${entry.id}: ${sanitizeControlCharacters(entry.path)}${note}`
    })
    .join('\n')
}
