/**
 * reference_lookup 工具（v15，提醒式形态）：只读参考库的按需定位入口。
 *
 * - 参数 schema 只收 **库 id + query**（无自由路径）——路径围栏天然成立；
 * - 空 query = catalog 模式（枚举库清单）；非空 query = search 模式（库内受限
 *   检索，返回命中行片段）；
 * - **无预算、无记账**（2026-08-24 收敛：覆盖检查/逃逸已移除）——模型自主选择
 *   用工具、直接读文件或自己 grep；
 * - 结果经 `output.render` 渲染为 model-facing 文本（schema 白名单只进
 *   name/description/parameters，执行细节绝不泄漏给模型）；canonical 值必须为
 *   纯 lossless JSON（禁 undefined 键）。
 * @module @hpyperry/dsh-ref-lib/src/tool
 */

import { basename } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { RefLibEntry } from './spec.ts'
import { filterAvailable } from './logic.ts'
import { SEARCH_LIMITS, searchDirectory } from './search.ts'
import { sanitizeControlCharacters } from './validate.ts'

/** 工具对 refLibs 的依赖面。 */
export interface LookupLibsPort {
  /** 当前会话全部条目（已探测可用性）。 */
  list(session: Session): readonly RefLibEntry[]
}

/** 一次检索命中的规范化结果。 */
export interface LookupHit {
  /** 库 id。 */
  readonly libraryId: string
  /** 库根 basename（展示）。 */
  readonly libraryName: string
  /** 相对库根的路径。 */
  readonly path: string
  readonly lineNumber: number
  readonly snippet: string
}

/** reference_lookup 的 canonical 值（可变数组形态以兼容 defineTool schema 推断）。 */
export interface LookupResult {
  readonly mode: 'catalog' | 'search'
  readonly query: string
  /** 目标库数（search 模式；catalog 为挂载可用库数）。 */
  readonly libraryCount: number
  readonly results: LookupHit[]
  readonly total: number
  readonly truncated: boolean
  /** 空结果/预算超限时的说明文本（模型可直接读）。 */
  readonly message?: string
}

/** 工具描述（模型可见——识别"何时该用"全依赖它，措辞按 2026-08-24 讨论定稿）。 */
export const REFERENCE_LOOKUP_DESCRIPTION =
  'Locate content inside the read-only reference libraries registered for this session (local directories: ' +
  'project source, docs, API specs, internal standards). Use it when you need specific details — exact ' +
  'signatures, code locations, file contents — from a reference library. Pass a query with English ' +
  'identifiers/technical terms (matching is literal; full sentences will not match source code), and ' +
  'optionally a library id to limit the search. Omit the query to list the registered libraries (catalog). ' +
  'You may also read library files directly. Reference libraries are strictly read-only.'

/** 工具参数 schema（JSON 值 DSL）。query 可选——省略即 catalog 模式。 */
export const LOOKUP_PARAMETERS = {
  query: { type: 'string', description: 'Search terms (identifiers, function names, topic keywords). Omit or empty to list the registered libraries.' },
  library: { type: 'string', description: 'Optional library id (from the injected library list or catalog) to search a single library. Omit to search all registered libraries.' },
  maxResults: { type: 'integer', description: `Optional per-library result cap (default ${SEARCH_LIMITS.maxResults}).` },
} as const

/**
 * 解析目标库（纯函数）：全部可用条目按 id 过滤；未知 id 返回错误信息。
 * @param entries - 可用条目。
 * @param libraryId - 可选库 id。
 * @returns 目标条目 + 可选错误（未知 id）。
 */
export function resolveTargets(
  entries: readonly RefLibEntry[],
  libraryId: string | undefined,
): { targets: readonly RefLibEntry[]; error?: string } {
  if (libraryId === undefined || libraryId === '') {
    if (entries.length === 0) {
      return { targets: [], error: 'No reference libraries are registered for this session.' }
    }
    return { targets: entries }
  }
  const target = entries.find((entry) => entry.id === libraryId)
  if (target === undefined) {
    const known = entries.map((entry) => `${entry.id} (${basename(entry.path)})`).join(', ')
    return {
      targets: [],
      error:
        entries.length === 0
          ? 'No reference libraries are registered for this session.'
          : `Unknown library id "${libraryId}". Known libraries: ${known}. Use /ref-lib list or query without library to see the catalog.`,
    }
  }
  return { targets: [target] }
}

/** 渲染 catalog 文本（纯函数）。 */
export function renderCatalog(entries: readonly RefLibEntry[]): string {
  if (entries.length === 0) return 'No reference libraries are registered for this session.'
  return entries
    .map((entry, index) => {
      const note = entry.note === undefined || entry.note === '' ? '' : ` — ${sanitizeControlCharacters(entry.note)}`
      return `${index + 1}. ${sanitizeControlCharacters(basename(entry.path))} (id: ${entry.id})${note}\n   Path: ${sanitizeControlCharacters(entry.path)}`
    })
    .join('\n')
}

/** 渲染检索结果文本（纯函数）。 */
export function renderSearchResult(result: LookupResult): string {
  if (result.results.length === 0) {
    return result.message ?? `No matches for "${result.query}" in the reference libraries.`
  }
  const lines: string[] = [`Matches for "${result.query}" in reference libraries (${result.total}):`]
  for (const hit of result.results) {
    lines.push(`- [${hit.libraryName}] ${hit.path}:${hit.lineNumber}`)
    lines.push(`  ${hit.snippet}`)
  }
  if (result.truncated) lines.push(`(truncated; refine the query or narrow by library)`)
  return lines.join('\n')
}

/**
 * 注册 reference_lookup 工具。
 * @param ctx - tools 注入后的上下文。
 * @param deps - refLibs 端口。
 * @returns disposer（卸载时撤销注册）。
 */
export function registerReferenceLookup(ctx: Context, deps: { libs: LookupLibsPort }): () => void {
  const tool = defineTool({
    name: 'reference_lookup',
    description: REFERENCE_LOOKUP_DESCRIPTION,
    parameters: LOOKUP_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['catalog', 'search'] },
          query: { type: 'string' },
          libraryCount: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                libraryId: { type: 'string' },
                libraryName: { type: 'string' },
                path: { type: 'string' },
                lineNumber: { type: 'integer' },
                snippet: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          total: { type: 'integer' },
          truncated: { type: 'boolean' },
          message: { type: 'string' },
        },
        additionalProperties: false,
      },
      render(args, value) {
        const result = value as unknown as LookupResult
        const text = result.mode === 'catalog' ? renderCatalogText(result) : renderSearchResult(result)
        return [{ type: 'text', text }]
      },
    },
    timeoutMs: SEARCH_LIMITS.timeoutMs + 1_000,
    isConcurrencySafe: () => false, // 检索有 IO，串行执行避免竞态
    async execute(args, exec): Promise<LookupResult> {
      const session = exec.agent?.session
      if (session === undefined) {
        return {
          mode: 'search',
          query: args.query ?? '',
          libraryCount: 0,
          results: [],
          total: 0,
          truncated: false,
          message: 'reference_lookup requires a calling agent session.',
        }
      }
      return runLookup(args, session, deps)
    },
  })
  return ctx.tools.register(tool)
}

/** catalog 结果渲染（内部）。 */
function renderCatalogText(result: LookupResult): string {
  const text = result.message ?? ''
  // catalog 渲染需要条目级信息（note/path）：canonical 里用 message 承载，保持 schema 简单。
  return text === '' ? `Registered reference libraries (${result.libraryCount}): see /ref-lib list.` : text
}

/** 工具执行主体（独立函数便于单测）。 */
export async function runLookup(
  args: { query?: string; library?: string; maxResults?: number },
  session: Session,
  deps: { libs: LookupLibsPort },
): Promise<LookupResult> {
  const entries = filterAvailable(deps.libs.list(session))
  const { targets, error } = resolveTargets(entries, args.library)
  const query = (args.query ?? '').trim()
  // catalog 模式：空 query 枚举库清单（不计入查证动作）。
  if (query === '') {
    return {
      mode: 'catalog',
      query: '',
      libraryCount: entries.length,
      results: [],
      total: 0,
      truncated: false,
      message: renderCatalog(entries)
    }
  }
  if (error !== undefined) {
    return {
      mode: 'search',
      query,
      libraryCount: 0,
      results: [],
      total: 0,
      truncated: false,
      message: error
    }
  }
  // search 模式：逐库受限检索（库数量少，串行即可；每库独立上限，总量封顶）。
  const perLibraryCap = Math.max(1, Math.min(args.maxResults ?? SEARCH_LIMITS.maxResults, SEARCH_LIMITS.maxResults))
  const hits: LookupHit[] = []
  for (const target of targets) {
    const found = await searchDirectory(target.path, query, { maxResults: perLibraryCap })
    for (const hit of found) {
      hits.push({
        libraryId: target.id,
        libraryName: basename(target.path),
        path: hit.path,
        lineNumber: hit.lineNumber,
        snippet: hit.snippet,
      })
    }
    if (hits.length >= SEARCH_LIMITS.maxResults * targets.length) break
  }
  const total = hits.length
  const truncated = total > 0 && total >= perLibraryCap
  // message 仅在空结果时存在——undefined 键绝不进入 canonical 值（lossless-JSON 序列化红线）。
  const noMatchMessage =
    total === 0
      ? `No matches for "${query}" in the reference libraries (searched ${targets.length} ${targets.length === 1 ? 'library' : 'libraries'}). ` +
        `Matching is literal: try English identifiers and technical terms (class/function/file names, API names) as query terms, ` +
        `or omit the query to list the libraries (catalog) and see what they contain. You may also proceed to web search or ask the user.`
      : undefined
  return {
    mode: 'search',
    query,
    libraryCount: targets.length,
    results: hits,
    total,
    truncated,
    ...(noMatchMessage === undefined ? {} : { message: noMatchMessage })
  }
}
