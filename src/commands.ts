/**
 * `/ref-lib` 命令参数解析的纯函数。
 * @module @hpyperry/dsh-ref-lib/src/commands
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** `/ref-lib` 支持的子命令。 */
export type RefLibCommand =
  | { readonly kind: 'list' }
  | { readonly kind: 'add'; readonly path: string; readonly note?: string }
  | { readonly kind: 'remove'; readonly id: string }

/** 解析失败的结果（含给用户看的错误文案）。 */
export interface RefLibCommandError {
  readonly kind: 'error'
  readonly text: string
}

/** 解析结果：子命令或错误。 */
export type RefLibCommandResult = RefLibCommand | RefLibCommandError

/** 用法提示，供 help 与错误文案复用。 */
export const REF_LIB_USAGE = '用法：/ref-lib add <path> [--note <用途>] | /ref-lib list | /ref-lib remove <id>'

/**
 * 把用户输入的路径解析为绝对路径：展开 `~`/`~/`，相对路径基于给定基准目录
 * （当前会话工作区）解析。
 * @param input - 用户输入的路径（可含空格）。
 * @param base - 相对路径的解析基准（会话工作区绝对路径）。
 * @returns 绝对路径。
 */
export function resolveRefLibPath(input: string, base: string): string {
  const trimmed = input.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
  return resolve(base, trimmed)
}

/**
 * 解析 `command/run` 事件携带的 rawInput（命令名后的原文，含前导分隔空白）。
 * @param rawInput - 命令名后的原文。
 * @returns 解析出的子命令；无法解析时为错误结果。
 */
export function parseRefLibCommand(rawInput: string): RefLibCommandResult {
  const trimmed = rawInput.trim()
  if (trimmed === '') return { kind: 'error', text: REF_LIB_USAGE }
  const spaceAt = trimmed.search(/\s/)
  const verb = spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)
  const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt).trim()
  switch (verb) {
    case 'list':
      return rest === '' ? { kind: 'list' } : { kind: 'error', text: `list 不接受参数。${REF_LIB_USAGE}` }
    case 'add': {
      if (rest === '') return { kind: 'error', text: `add 需要目录路径。${REF_LIB_USAGE}` }
      // `--note <note>` 分隔：之前为路径（可含空格），之后到行尾为用途说明
      // （`--note` 可位于行尾——此时 note 为空，视为未提供）。
      const noteAt = rest.search(/\s--note(?:\s|$)/)
      if (noteAt === -1) return { kind: 'add', path: rest }
      const path = rest.slice(0, noteAt).trim()
      const note = rest.slice(noteAt).replace(/^\s*--note\s*/, '').trim()
      if (path === '') return { kind: 'error', text: `add 需要目录路径。${REF_LIB_USAGE}` }
      return note === '' ? { kind: 'add', path } : { kind: 'add', path, note }
    }
    case 'remove':
      return rest === ''
        ? { kind: 'error', text: `remove 需要条目 id。${REF_LIB_USAGE}` }
        : { kind: 'remove', id: rest }
    default:
      return { kind: 'error', text: `未知子命令 "${verb}"。${REF_LIB_USAGE}` }
  }
}
