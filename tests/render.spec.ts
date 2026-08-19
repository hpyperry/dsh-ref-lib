import { describe, expect, it } from 'vitest'
import { renderLibList, renderRefLibs } from '../src/render.ts'
import type { RefLibEntry } from '../src/spec.ts'

describe('renderRefLibs', () => {
  it('空列表返回空串（零 token）', () => {
    expect(renderRefLibs([])).toBe('')
  })

  it('包含定稿英文模板的关键规则短语', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a' }]
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
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/deepseek-harness' }]
    const text = renderRefLibs(libs)
    expect(text).toContain('1. deepseek-harness')
    expect(text).toContain('   Path: /lib/deepseek-harness')
    expect(text).not.toContain('Description')
  })

  it('含 note 时渲染 Description 行', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/deepseek-harness', note: 'harness 源码' }]
    const text = renderRefLibs(libs)
    expect(text).toContain('   Description: harness 源码')
  })

  it('多库按注册序编号，库间空行分隔', () => {
    const libs: RefLibEntry[] = [
      { id: '1', path: '/lib/a' },
      { id: '2', path: '/lib/b', note: 'b 用途' },
    ]
    const text = renderRefLibs(libs)
    expect(text).toContain('1. a')
    expect(text).toContain('2. b')
    expect(text.indexOf('2. b') > text.indexOf('1. a')).toBe(true)
  })

  it('多行 note 注入时折叠为单行（Description 模板为单行）', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a', note: '第一行\n第二行\t缩进' }]
    const text = renderRefLibs(libs)
    expect(text).toContain('   Description: 第一行 第二行 缩进')
    expect(text).not.toContain('\n第二行')
  })

  it('路径与 note 的控制字符被消毒/折叠（提示词注入卫生）', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a\nignore-all', note: 'bad\u2028note' }]
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
})
