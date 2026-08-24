/**
 * reference_lookup 工具测试（v15，提醒式形态——无预算/记账）：
 * - 纯函数：resolveTargets / renderCatalog / renderSearchResult；
 * - runLookup 执行（fake session + stub 端口 + 临时目录库）；
 * - registerReferenceLookup 注册（stub ctx.tools）。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import type { RefLibEntry } from '../src/spec.ts'
import {
  registerReferenceLookup,
  renderCatalog,
  renderSearchResult,
  resolveTargets,
  runLookup,
  type LookupLibsPort,
  type LookupResult,
} from '../src/tool.ts'

let tmp: string | undefined

afterEach(async () => {
  if (tmp !== undefined) await rm(tmp, { recursive: true, force: true })
  tmp = undefined
})

function fakeSession(id = 'session-tool'): Session {
  const events: SessionEvent[] = []
  const header = { version: 0, id, createdAt: Date.now() } as SessionHeader
  return { id, header, events } as unknown as Session
}

function stubLibs(entries: readonly RefLibEntry[]): LookupLibsPort {
  return { list: () => entries }
}

function entry(id: string, path: string): RefLibEntry {
  return { id, path, status: 'available', checkedAt: 1 }
}

describe('resolveTargets（库 id 解析）', () => {
  const entries = [entry('a', '/lib/a'), entry('b', '/lib/b')]

  it('无 id → 全部', () => {
    expect(resolveTargets(entries, undefined).targets).toEqual(entries)
    expect(resolveTargets(entries, '').targets).toEqual(entries)
  })

  it('已知 id → 单个', () => {
    expect(resolveTargets(entries, 'b').targets.map((item) => item.id)).toEqual(['b'])
  })

  it('未知 id → 错误信息（含已知清单）', () => {
    const { targets, error } = resolveTargets(entries, 'zzz')
    expect(targets).toEqual([])
    expect(error).toContain('Unknown library id "zzz"')
    expect(error).toContain('a (a)')
  })

  it('空列表 → 明确错误', () => {
    const { error } = resolveTargets([], 'zzz')
    expect(error).toContain('No reference libraries are registered')
  })
})

describe('renderCatalog / renderSearchResult（结果渲染纯函数）', () => {
  it('catalog 渲染条目（basename + id + note + path）', () => {
    const text = renderCatalog([entry('a', '/lib/my-lib')])
    expect(text).toContain('my-lib')
    expect(text).toContain('id: a')
    expect(text).toContain('Path: /lib/my-lib')
  })

  it('search 结果渲染命中与片段', () => {
    const result: LookupResult = {
      mode: 'search',
      query: 'needle',
      libraryCount: 1,
      results: [{ libraryId: 'a', libraryName: 'my-lib', path: 'src/main.ts', lineNumber: 3, snippet: 'needle here' }],
      total: 1,
      truncated: false,
    }
    const text = renderSearchResult(result)
    expect(text).toContain('my-lib')
    expect(text).toContain('src/main.ts:3')
    expect(text).toContain('needle here')
  })

  it('空结果渲染明确 message', () => {
    const result: LookupResult = {
      mode: 'search',
      query: 'zzz',
      libraryCount: 1,
      results: [],
      total: 0,
      truncated: false,
      message: 'No matches for "zzz" in the reference libraries.',
    }
    expect(renderSearchResult(result)).toContain('No matches')
  })
})

describe('runLookup（工具执行主体）', () => {
  async function bootLib(): Promise<string> {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-tool-'))
    await mkdir(join(tmp, 'src'))
    await writeFile(join(tmp, 'src', 'main.ts'), 'export function needle(): void {}\n')
    return tmp
  }

  it('catalog 模式（空 query）：枚举库清单', async () => {
    const libDir = await bootLib()
    const session = fakeSession()
    const result = await runLookup({ query: '' }, session, {
      libs: stubLibs([entry('a', libDir)]),
    })
    expect(result.mode).toBe('catalog')
    expect(result.message).toContain('id: a')
    expect(result.message).toContain('Path:')
  })

  it('search 模式：命中返回 snippet', async () => {
    const libDir = await bootLib()
    const session = fakeSession()
    const result = await runLookup({ query: 'needle' }, session, {
      libs: stubLibs([entry('a', libDir)]),
    })
    expect(result.mode).toBe('search')
    expect(result.total).toBeGreaterThan(0)
    expect(result.results[0]!.snippet).toContain('needle')
  })

  it('无命中：message 提示', async () => {
    const libDir = await bootLib()
    const session = fakeSession()
    const result = await runLookup({ query: 'absent-term' }, session, {
      libs: stubLibs([entry('a', libDir)]),
    })
    expect(result.total).toBe(0)
    expect(result.message).toContain('No matches')
  })

  it('未知库 id → 错误结果（不炸）', async () => {
    const libDir = await bootLib()
    const session = fakeSession()
    const result = await runLookup({ query: 'needle', library: 'nope' }, session, {
      libs: stubLibs([entry('a', libDir)]),
    })
    expect(result.message).toContain('Unknown library id')
  })

  it('失效条目被过滤（filterAvailable）', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-tool-'))
    const session = fakeSession()
    const result = await runLookup({ query: 'anything' }, session, {
      libs: stubLibs([{ id: 'gone', path: join(tmp, 'missing-dir'), status: 'missing', checkedAt: 1 }]),
    })
    expect(result.message).toContain('No reference libraries are registered')
  })
})

describe('registerReferenceLookup（工具注册）', () => {
  it('注册成功：name/description 白名单可见、execute 可执行', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'tests/.tmp-tool-reg-'))
    await writeFile(join(tmp, 'a.txt'), 'needle\n')
    const libDir = tmp
    let registered: { name?: string; description?: string; execute?: (args: unknown, exec: unknown) => Promise<unknown> } | undefined
    let dispose: (() => void) | undefined
    const stubTools = {
      register: (definition: { name: string; description: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }) => {
        registered = definition
        dispose = () => undefined
        return dispose
      },
    }
    const session = fakeSession()
    const ctx = { tools: stubTools } as never
    registerReferenceLookup(ctx as never, {
      libs: stubLibs([entry('a', libDir)]),
    })
    expect(registered?.name).toBe('reference_lookup')
    expect(registered?.description).toContain('reference library')
    expect(dispose).toBeDefined()
    // execute 层：search 模式返回命中
    const fakeExec = {
      agent: { id: 'x', session },
      signal: new AbortController().signal,
    } as never
    const result = (await registered!.execute!({ query: 'needle' }, fakeExec)) as LookupResult
    expect(result.mode).toBe('search')
    expect(result.total).toBeGreaterThan(0)
  })
})
