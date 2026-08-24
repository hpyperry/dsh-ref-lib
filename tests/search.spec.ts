/**
 * 检索执行测试（v15）：matchesLine / buildSnippet / isLikelyText 纯函数 +
 * searchDirectory 临时目录集成（深度/忽略目录/上限/超时边界）。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSnippet,
  isCommentLine,
  isLikelyText,
  matchesLine,
  rankHits,
  searchDirectory,
  SEARCH_LIMITS,
} from '../src/search.ts'

let tmp: string | undefined

afterEach(async () => {
  if (tmp !== undefined) await rm(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('matchesLine（行匹配纯函数）', () => {
  it('大小写不敏感默认命中', () => {
    expect(matchesLine('Hello World', 'hello')).toBe(true)
    expect(matchesLine('Hello World', 'WORLD')).toBe(true)
  })

  it('大小写敏感模式', () => {
    expect(matchesLine('Hello', 'hello', true)).toBe(false)
    expect(matchesLine('hello', 'hello', true)).toBe(true)
  })

  it('空 query 匹配一切', () => {
    expect(matchesLine('anything', '')).toBe(true)
  })

  it('多词 OR 匹配：任一词命中即命中（中文整句中的英文标识符仍有效）', () => {
    expect(matchesLine('export function refLibPlugin()', 'refLibPlugin 插件 参考库')).toBe(true)
    expect(matchesLine('const needle = 1', 'foo needle bar')).toBe(true)
    expect(matchesLine('abcdef', 'xyz 中文词')).toBe(false)
  })

  it('大小写敏感的多词匹配', () => {
    expect(matchesLine('Needle here', 'needle xyz', true)).toBe(false)
    expect(matchesLine('Needle here', 'Needle xyz', true)).toBe(true)
  })

  it('无命中返回 false', () => {
    expect(matchesLine('abc', 'xyz')).toBe(false)
  })
})

describe('buildSnippet（片段截断纯函数）', () => {
  it('短行原样返回', () => {
    expect(buildSnippet('short line', 'short')).toBe('short line')
  })

  it('超长行截断到窗口并带省略号', () => {
    const line = `${'a'.repeat(500)}needle${'b'.repeat(500)}`
    const snippet = buildSnippet(line, 'needle')
    expect(snippet.length).toBeLessThanOrEqual(242)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('匹配位置居中保留', () => {
    const line = `${'a'.repeat(500)}NEEDLE${'b'.repeat(500)}`
    const snippet = buildSnippet(line, 'NEEDLE')
    expect(snippet).toContain('NEEDLE')
  })
})

describe('isLikelyText（二进制探测）', () => {
  it('含 NUL 视为二进制', () => {
    expect(isLikelyText('a\u0000b')).toBe(false)
    expect(isLikelyText('plain text')).toBe(true)
  })
})

describe('isCommentLine / rankHits（命中质量排序）', () => {
  it('常见注释符识别', () => {
    expect(isCommentLine('# ref-lib 约定')).toBe(true)
    expect(isCommentLine('// TODO')).toBe(true)
    expect(isCommentLine('/* block */')).toBe(true)
    expect(isCommentLine(' * doc line')).toBe(true)
    expect(isCommentLine('<!-- html comment -->')).toBe(true)
    expect(isCommentLine('const x = 1')).toBe(false)
    expect(isCommentLine('   ')).toBe(false)
  })

  it('排序：非注释优先，行长升序，稳定序', () => {
    const hits = [
      { path: 'a', lineNumber: 1, line: '# comment long line', snippet: '' },
      { path: 'b', lineNumber: 1, line: 'def short()', snippet: '' },
      { path: 'c', lineNumber: 1, line: 'const medium = 1;', snippet: '' },
    ]
    const ranked = rankHits(hits)
    expect(ranked.map((h) => h.path)).toEqual(['b', 'c', 'a'])
  })
})

describe('searchDirectory（目录检索集成）', () => {
  async function boot(): Promise<string> {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-search-'))
    await mkdir(join(tmp, 'src'))
    await mkdir(join(tmp, 'node_modules'))
    await mkdir(join(tmp, 'src', 'deep'))
    await writeFile(join(tmp, 'README.md'), '# Project\n\nHas needle here\n')
    await writeFile(join(tmp, 'src', 'main.ts'), 'export function needle(): void {}\n')
    await writeFile(join(tmp, 'src', 'deep', 'nested.ts'), 'const other = 1\nneedle in deep\n')
    await writeFile(join(tmp, 'node_modules', 'skip.ts'), 'needle should be ignored\n')
    return tmp
  }

  it('命中文件内容并返回相对路径与行号', async () => {
    const root = await boot()
    const hits = await searchDirectory(root, 'needle')
    const paths = hits.map((hit) => `${hit.path}:${hit.lineNumber}`).sort()
    expect(paths).toContain('README.md:3')
    expect(paths).toContain('src/main.ts:1')
    expect(paths).toContain('src/deep/nested.ts:2')
    // node_modules 被忽略
    expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false)
  })

  it('maxResults 封顶', async () => {
    const root = await boot()
    const hits = await searchDirectory(root, 'needle', { maxResults: 2 })
    expect(hits.length).toBe(2)
  })

  it('maxDepth 限制深度', async () => {
    const root = await boot()
    const hits = await searchDirectory(root, 'needle', { maxDepth: 1 })
    expect(hits.some((hit) => hit.path.startsWith('src/deep/'))).toBe(false)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('大小写敏感选项', async () => {
    const root = await boot()
    const hits = await searchDirectory(root, 'NEEDLE', { caseSensitive: true })
    expect(hits.length).toBe(0)
  })

  it('空 query 命中全部文本行（上限内）', async () => {
    const root = await boot()
    const hits = await searchDirectory(root, '')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(SEARCH_LIMITS.maxResults)
  })

  it('根不可读/不存在返回空列表', async () => {
    const hits = await searchDirectory(join(tmp ?? '', 'nonexistent'), 'x')
    expect(hits).toEqual([])
  })

  it('超大文件跳过（maxFileSize）', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-search-'))
    await writeFile(join(tmp, 'big.txt'), 'needle ' + 'x'.repeat(4096))
    const hits = await searchDirectory(tmp, 'needle', { maxFileSize: 64 })
    expect(hits).toEqual([])
  })

  it('忽略 .pnpm-store 等大目录（文件优先遍历不被海量文件耗尽）', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-search-'))
    // 海量文件的 .pnpm-store（应被忽略）+ 根目录真实匹配文件
    await mkdir(join(tmp, '.pnpm-store', 'files'), { recursive: true })
    for (let i = 0; i < 50; i += 1) await writeFile(join(tmp, '.pnpm-store', 'files', `f${i}.js`), 'needle here\n')
    await writeFile(join(tmp, 'README.md'), '# Project\n\nneedle in README\n')
    const hits = await searchDirectory(tmp, 'needle')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.path.startsWith('.pnpm-store') === false)).toBe(true)
    expect(hits.some((hit) => hit.path === 'README.md')).toBe(true)
  })

  it('每文件命中上限（MAX_HITS_PER_FILE）防单文件霸屏', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-search-'))
    const many = Array.from({ length: 50 }, (_, i) => `needle line ${i}`).join('\n')
    await writeFile(join(tmp, 'big.txt'), many)
    await writeFile(join(tmp, 'other.txt'), 'needle one\n')
    const hits = await searchDirectory(tmp, 'needle', { maxResults: 10 })
    // big.txt 最多贡献 3 条；other.txt 贡献 1 条
    const bigCount = hits.filter((h) => h.path === 'big.txt').length
    expect(bigCount).toBeLessThanOrEqual(3)
    expect(hits.some((h) => h.path === 'other.txt')).toBe(true)
  })
})
