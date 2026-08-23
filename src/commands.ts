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
  | { readonly kind: 'import'; readonly source: string; readonly paths: readonly string[] }

/** 解析失败的结果（含给用户看的错误文案）。 */
export interface RefLibCommandError {
  readonly kind: 'error'
  readonly text: string
}

/** 解析结果：子命令或错误。 */
export type RefLibCommandResult = RefLibCommand | RefLibCommandError

/** 用法提示，供 help 与错误文案复用。 */
export const REF_LIB_USAGE = '用法：/ref-lib add <path> [--note <用途>] | /ref-lib list | /ref-lib remove <id> | /ref-lib import [会话] [路径...]'

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
    case 'import': {
      // `import [会话] [路径...]`：首个空白前为会话查询（id 或标题片段），其余为路径。
      // 无参数 = 列出所有有参考库的会话清单（id 可发现）。
      if (rest === '') return { kind: 'import', source: '', paths: [] }
      const sourceAt = rest.search(/\s/)
      const source = sourceAt === -1 ? rest : rest.slice(0, sourceAt)
      const paths = sourceAt === -1 ? [] : rest.slice(sourceAt).trim().split(/\s+/).filter(Boolean)
      return { kind: 'import', source, paths }
    }
    default:
      return { kind: 'error', text: `未知子命令 "${verb}"。${REF_LIB_USAGE}` }
  }
}


/** 源会话概览行（listSessions 结果的命令层视角：id/title/count）。 */
export interface SourceSessionLike {
  readonly sessionId: string
  readonly title?: string
  readonly count: number
}

/**
 * 解析 import 的会话查询（v13.1）：**id 精确匹配优先**；否则按标题包含匹配
 * （不区分大小写）。返回所有匹配（调用方据数量分支：0 报错 / 1 直接 / 多列候选）。
 * @param sources - 有参考库的源会话清单。
 * @param query - 用户输入的查询（id 或标题片段）。
 * @returns 匹配的会话（按输入顺序）。
 */
export function resolveSourceSessions(
  sources: readonly SourceSessionLike[],
  query: string,
): SourceSessionLike[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return []
  const byId = sources.filter((source) => source.sessionId === query.trim())
  if (byId.length > 0) return byId
  return sources.filter((source) => source.title?.toLocaleLowerCase().includes(needle) === true)
}
