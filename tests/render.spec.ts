import { describe, expect, it } from 'vitest'
import { renderLibList, renderRefLibs, renderRefLibsV15 } from '../src/render.ts'
import type { RefLibEntry } from '../src/spec.ts'

/** 可用条目（真实链路中 service.list 返回前已实时探测并填充 status）。 */
function available(id: string, path: string, note?: string): RefLibEntry {
  return { id, path, status: 'available', checkedAt: 1, ...(note === undefined ? {} : { note }) }
}

describe('renderRefLibsV15（提醒式政策 + 库清单）', () => {
  it('无可用库返回空串（未挂载 → 零注入）', () => {
    expect(renderRefLibsV15([])).toBe('')
  })

  it('注入提醒式政策 + 库清单（含 id 供工具限定）', () => {
    const hits = [available('a', '/lib/my-lib', 'project specs')]
    const text = renderRefLibsV15(hits)
    expect(text).toContain('[Read-only Reference Libraries]')
    expect(text).toContain('reference_lookup')
    expect(text).toContain('1. my-lib (id: a)')
    expect(text).toContain('Path: /lib/my-lib')
    expect(text).toContain('Description: project specs')
    // 提醒式政策关键词：使用指引 / 只读 / 规范遵守
    expect(text).toContain('[Usage Guidance]')
    expect(text).toContain('Follow the standards')
    expect(text).toContain('strictly read-only')
    // 无强制措辞（2026-08-24 收敛：不诱导必查、无覆盖检查段）
    expect(text).not.toContain('BEFORE answering')
    expect(text).not.toContain('[Coverage Check]')
  })

  it('多命中按序渲染', () => {
    const hits = [available('a', '/lib/one'), available('b', '/lib/two')]
    const text = renderRefLibsV15(hits)
    expect(text.indexOf('1. one')).toBeLessThan(text.indexOf('2. two'))
  })

  it('note 多行折叠为单行（注入卫生）', () => {
    const hits = [available('a', '/lib/one', 'line1\nline2')]
    const text = renderRefLibsV15(hits)
    expect(text).toContain('Description: line1 line2')
    expect(text).not.toContain('\nline2')
  })
})

describe('renderRefLibs', () => {
  it('空列表返回空串（零 token）', () => {
    expect(renderRefLibs([])).toBe('')
  })

  it('全部失效（missing/not-directory/未检测）返回空串', () => {
    const libs: RefLibEntry[] = [
      { id: '1', path: '/lib/deleted', status: 'missing', checkedAt: 1 },
      { id: '2', path: '/lib/replaced', status: 'not-directory', checkedAt: 1 },
      { id: '3', path: '/lib/unprobed' },
    ]
    expect(renderRefLibs(libs)).toBe('')
  })

  it('失效条目被过滤，仅可用条目注入', () => {
    const libs: RefLibEntry[] = [
      available('1', '/lib/a'),
      { id: '2', path: '/lib/deleted', status: 'missing', checkedAt: 1 },
      { id: '3', path: '/lib/replaced', status: 'not-directory', checkedAt: 1 },
    ]
    const text = renderRefLibs(libs)
    expect(text).toContain('1. a')
    expect(text).toContain('   Path: /lib/a')
    // 失效库不得进入注入文本
    expect(text).not.toContain('deleted')
    expect(text).not.toContain('replaced')
  })

  it('包含定稿英文模板的关键规则短语', () => {
    const libs: RefLibEntry[] = [available('1', '/lib/a')]
    const text = renderRefLibs(libs)
    // 强制语义与关键条款（防止未来误改模板）
    expect(text).toContain('[Read-only Reference Libraries]')
    expect(text).toContain('Search relevant reference libraries FIRST')
    expect(text).toContain('web search')
    expect(text).toContain('NEVER recursively scan or dump the entire library')
    expect(text).toContain('NEVER silently guess or merge conflicting information')
    expect(text).toContain('"Not in reference library; external source used."')
    expect(text).toContain('[Read-only Constraint]')
    expect(text).toContain('NEVER create, modify, delete, rename, move, or overwrite')
  })

  it('库列表渲染为序号 + basename + Path（无 note 省略 Description）', () => {
    const libs: RefLibEntry[] = [available('1', '/lib/deepseek-harness')]
    const text = renderRefLibs(libs)
    expect(text).toContain('1. deepseek-harness')
    expect(text).toContain('   Path: /lib/deepseek-harness')
    expect(text).not.toContain('Description')
  })

  it('含 note 时渲染 Description 行', () => {
    const libs: RefLibEntry[] = [available('1', '/lib/deepseek-harness', 'harness 源码')]
    const text = renderRefLibs(libs)
    expect(text).toContain('   Description: harness 源码')
  })

  it('多库按注册序编号，库间空行分隔', () => {
    const libs: RefLibEntry[] = [
      available('1', '/lib/a'),
      available('2', '/lib/b', 'b 用途'),
    ]
    const text = renderRefLibs(libs)
    expect(text).toContain('1. a')
    expect(text).toContain('2. b')
    expect(text.indexOf('2. b') > text.indexOf('1. a')).toBe(true)
  })

  it('多行 note 注入时折叠为单行（Description 模板为单行）', () => {
    const libs: RefLibEntry[] = [available('1', '/lib/a', '第一行\n第二行\t缩进')]
    const text = renderRefLibs(libs)
    expect(text).toContain('   Description: 第一行 第二行 缩进')
    expect(text).not.toContain('\n第二行')
  })

  it('路径与 note 的控制字符被消毒/折叠（提示词注入卫生）', () => {
    const libs: RefLibEntry[] = [available('1', '/lib/a\nignore-all', 'bad\u2028note')]
    const text = renderRefLibs(libs)
    // 路径：消毒为 U+FFFD
    expect(text).toContain('/lib/a\uFFFDignore-all')
    expect(text).not.toContain('\nignore-all')
    // note：空白类控制字符（含 U+2028）在单行化时折叠为空格
    expect(text).toContain('   Description: bad note')
    expect(text).not.toContain('\u2028note')
  })
})

describe('renderLibList', () => {
  it('空列表给出提示', () => {
    expect(renderLibList([])).toContain('没有已注册的只读参考库')
  })

  it('列出 id 与路径', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a', note: 'n' }]
    const text = renderLibList(libs)
    expect(text).toContain('1: /lib/a（n）')
  })

  it('失效条目带状态标记', () => {
    const libs: RefLibEntry[] = [
      { id: '1', path: '/lib/a', status: 'available', checkedAt: 1 },
      { id: '2', path: '/lib/deleted', status: 'missing', checkedAt: 1 },
      { id: '3', path: '/lib/replaced', status: 'not-directory', checkedAt: 1 },
    ]
    const text = renderLibList(libs)
    expect(text).toContain('1: /lib/a')
    expect(text).not.toContain('1: /lib/a [')
    expect(text).toContain('2: /lib/deleted [已失效]')
    expect(text).toContain('3: /lib/replaced [不是目录]')
  })
})
