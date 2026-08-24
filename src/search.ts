/**
 * 检索执行（v15）：库内受限 grep + snippet 构建。自实现（node fs 遍历 + 行匹配），
 * 不依赖 rg 二进制与 shell——库目录路径围栏由调用方（工具层）保证：本模块只接收
 * 已校验的库根目录，不接收自由路径。
 *
 * 成本控制（全部为硬上限，不靠模型自觉）：
 * - `maxResults`：总命中上限（默认 10）；
 * - `maxFiles`：扫描文件数上限（防海量小文件目录）；
 * - `maxDepth`：目录深度上限；
 * - `maxFileSize`：单文件字节上限（大文件跳过）；
 * - `timeoutMs`：软超时（每 N 个文件检查一次时钟）。
 * @module @hpyperry/dsh-ref-lib/src/search
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** 一条检索命中。 */
export interface SearchHit {
  /** 相对库根目录的路径（POSIX 分隔符，展示用）。 */
  readonly path: string
  /** 行号（1 起）。 */
  readonly lineNumber: number
  /** 匹配行全文（原始）。 */
  readonly line: string
  /** 构建好的片段（截断 + 匹配窗口居中）。 */
  readonly snippet: string
}

/** 检索成本控制选项。 */
export interface SearchOptions {
  readonly maxResults?: number
  readonly maxFiles?: number
  readonly maxDepth?: number
  readonly maxFileSize?: number
  readonly timeoutMs?: number
  /** 跳过目录名（相对路径段精确匹配）。 */
  readonly ignoreDirs?: readonly string[]
  readonly caseSensitive?: boolean
}

/** 默认检索上限（防止任何一次查询失控）。 */
export const SEARCH_LIMITS = {
  maxResults: 10,
  maxFiles: 2_000,
  maxDepth: 12,
  maxFileSize: 512 * 1024,
  timeoutMs: 5_000,
} as const

/** 默认跳过的目录（VCS / 依赖 / 构建产物 / 包管理器存储——避免海量文件耗尽遍历预算）。 */
export const DEFAULT_IGNORE_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.pnpm-store',
  '.cache',
  'coverage',
] as const

/** 片段窗口（字符）：匹配位置前后各留窗口/2。 */
export const SNIPPET_WINDOW = 240

/** 每个文件的最大命中数（防止单文件霸屏；排序后再按 maxResults 截断）。 */
export const MAX_HITS_PER_FILE = 3

/** 收集缓冲倍数：排序前先收集 maxResults×4（下限 40），排序后截断——让高质量命中有机会入选。 */
export function collectCap(maxResults: number): number {
  return Math.max(maxResults * 4, 40)
}

/**
 * 把 query 拆为检索 token（纯函数）：按空白拆分、过滤空串。
 * 多 token 采用 **OR 匹配**（任一词命中即命中）——中文整句 query 里的英文
 * 标识符（如 "ref-lib"）仍能命中代码库，避免整串字面匹配必然失败。
 * @param query - 原始查询词。
 * @returns token 列表（空 query 返回空数组）。
 */
export function tokenizeQuery(query: string): string[] {
  return query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
}

/**
 * 行级匹配（纯函数）：query 空串匹配一切；否则按空白拆分后**任一词命中**即命中
 * （OR 语义）。大小写不敏感默认开启。
 * @param line - 原始行。
 * @param query - 查询词（可含空白分隔的多个词）。
 * @param caseSensitive - 是否大小写敏感（默认否）。
 * @returns 是否命中。
 */
export function matchesLine(line: string, query: string, caseSensitive = false): boolean {
  if (query === '') return true
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) return true
  const target = caseSensitive ? line : line.toLowerCase()
  for (const token of tokens) {
    const term = caseSensitive ? token : token.toLowerCase()
    if (target.includes(term)) return true
  }
  return false
}

/**
 * 构建片段（纯函数）：截断到窗口，匹配位置尽量居中。
 * @param line - 原始行。
 * @param query - 查询词（用于定位居中窗口）。
 * @returns 截断后的片段（超长时带省略号）。
 */
export function buildSnippet(line: string, query: string): string {
  if (line.length <= SNIPPET_WINDOW) return line
  let center = 0
  // 用 query 中第一个在行内命中的 token 定位居中窗口（整句 query 可能不在行内）。
  for (const token of tokenizeQuery(query)) {
    const index = line.toLowerCase().indexOf(token.toLowerCase())
    if (index >= 0) {
      center = index + Math.floor(token.length / 2)
      break
    }
  }
  const start = Math.max(0, center - Math.floor(SNIPPET_WINDOW / 2))
  const end = Math.min(line.length, start + SNIPPET_WINDOW)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < line.length ? '…' : ''
  return `${prefix}${line.slice(start, end)}${suffix}`
}

/** 文本文件探测（纯函数）：含 NUL 字节视为二进制（跳过）。 */
export function isLikelyText(content: string): boolean {
  return !content.includes('\0')
}

/**
 * 注释行判定（纯函数）：行首 trim 后以常见注释符开头视为注释（# // /* * <!--）。
 * 排序时注释命中降权——代码/文档正文通常比配置注释更有信息量。
 * @param line - 原始行。
 * @returns 是否为注释行。
 */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  return (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('<!--')
  )
}

/**
 * 命中质量排序（纯函数）：非注释行优先，其次行长度升序（定义/声明通常短而精确），
 * 保持稳定序（同分按原顺序）。排序后再由调用方截断 maxResults。
 * @param hits - 收集的命中（可能超 maxResults）。
 * @returns 排序后的新数组。
 */
export function rankHits(hits: readonly SearchHit[]): SearchHit[] {
  return [...hits].sort((a, b) => {
    const aComment = isCommentLine(a.line) ? 1 : 0
    const bComment = isCommentLine(b.line) ? 1 : 0
    if (aComment !== bComment) return aComment - bComment
    return a.line.length - b.line.length
  })
}

/**
 * 目录内受限检索：递归遍历（深度受限、忽略目录、文件大小受限），逐行匹配。
 * 遍历策略（2026-08-24 实测修复）：
 * - **文件优先**：先处理本目录文件，再递归子目录——根目录高价值文件（README/
 *   配置）先被扫描，避免深/大目录（如 .pnpm-store）耗尽 maxFiles 预算；
 * - **每文件上限** `MAX_HITS_PER_FILE`（防单文件霸屏）；
 * - **收集缓冲 + 质量排序**：先收集至 `collectCap`，`rankHits` 排序后截断
 *   `maxResults`——注释降权、行长升序，让高质量命中优先入选。
 * @param root - 库根目录（**必须已校验为库路径**，路径围栏由调用方保证）。
 * @param query - 查询词。
 * @param options - 成本上限（缺省取 SEARCH_LIMITS）。
 * @returns 排序截断后的命中列表。
 */
export async function searchDirectory(
  root: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const limits = {
    maxResults: options.maxResults ?? SEARCH_LIMITS.maxResults,
    maxFiles: options.maxFiles ?? SEARCH_LIMITS.maxFiles,
    maxDepth: options.maxDepth ?? SEARCH_LIMITS.maxDepth,
    maxFileSize: options.maxFileSize ?? SEARCH_LIMITS.maxFileSize,
    timeoutMs: options.timeoutMs ?? SEARCH_LIMITS.timeoutMs,
    caseSensitive: options.caseSensitive ?? false,
    ignoreDirs: [...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])],
  }
  const hits: SearchHit[] = []
  const collectTarget = collectCap(limits.maxResults)
  const deadline = Date.now() + limits.timeoutMs
  let filesScanned = 0
  let timedOut = false

  /** 扫描单个文件：逐行匹配，per-file cap（MAX_HITS_PER_FILE）。 */
  async function scanFile(file: string): Promise<void> {
    if (filesScanned >= limits.maxFiles) return
    filesScanned += 1
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      return
    }
    if (size > limits.maxFileSize) return
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      return
    }
    if (!isLikelyText(content)) return
    const lines = content.split('\n')
    let fileHits = 0
    for (let index = 0; index < lines.length; index += 1) {
      if (hits.length >= collectTarget || fileHits >= MAX_HITS_PER_FILE || timedOut) return
      const line = lines[index]!
      if (!matchesLine(line, query, limits.caseSensitive)) continue
      hits.push({
        path: relative(root, file).split(sep).join('/'),
        lineNumber: index + 1,
        line,
        snippet: buildSnippet(line, query),
      })
      fileHits += 1
    }
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (hits.length >= collectTarget || timedOut) return
    if (depth > limits.maxDepth) return
    if (filesScanned >= limits.maxFiles) return
    if (Date.now() > deadline) {
      timedOut = true
      return
    }
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return // 不可读目录（权限/已删除）跳过
    }
    const subdirs: { name: string }[] = []
    // 阶段 1：本目录文件（优先——高价值根文件先于深目录）
    for (const dirent of dirents) {
      if (hits.length >= collectTarget || timedOut) return
      if (dirent.isDirectory()) {
        if (!limits.ignoreDirs.includes(dirent.name)) subdirs.push(dirent)
        continue
      }
      if (!dirent.isFile()) continue
      await scanFile(join(dir, dirent.name))
    }
    // 阶段 2：递归子目录
    for (const dirent of subdirs) {
      if (hits.length >= collectTarget || timedOut) return
      await walk(join(dir, dirent.name), depth + 1)
    }
  }

  try {
    const rootStat = await stat(root)
    if (rootStat.isDirectory()) {
      await walk(root, 0)
    } else if (rootStat.isFile()) {
      await scanFile(root)
    }
  } catch {
    return [] // 根不可读：空结果
  }
  // 质量排序后截断（注释降权 + 行长升序）
  return rankHits(hits).slice(0, limits.maxResults)
}
