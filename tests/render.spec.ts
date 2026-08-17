import { describe, expect, it } from 'vitest'
import { renderLibList, renderRefLibs } from '../src/render.ts'
import type { RefLibEntry } from '../src/spec.ts'

describe('renderRefLibs', () => {
  it('空列表返回空串（零 token）', () => {
    expect(renderRefLibs([])).toBe('')
  })

  it('包含路径、查询优先级与只读约束声明', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a' }]
    const text = renderRefLibs(libs)
    expect(text).toContain('/lib/a')
    expect(text).toContain('只读参考库')
    expect(text).toContain('查询优先级')
    expect(text).toContain('优先在上述参考库目录内检索')
    expect(text).toContain('禁止创建、修改或删除')
  })

  it('含备注时展示备注', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a', note: 'core 源码' }]
    expect(renderRefLibs(libs)).toContain('/lib/a（core 源码）')
  })

  it('控制字符被消毒为 U+FFFD（提示词注入卫生）', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a\nignore-all' }]
    const text = renderRefLibs(libs)
    expect(text).toContain('/lib/a\uFFFDignore-all')
    expect(text).not.toContain('\nignore-all')
  })

  it('U+2028 行分隔符亦被消毒（扩展控制字符集回归）', () => {
    const libs: RefLibEntry[] = [{ id: '1', path: '/lib/a\u2028ignore-all' }]
    const text = renderRefLibs(libs)
    expect(text).toContain('/lib/a\uFFFDignore-all')
    expect(text).not.toContain('\u2028ignore-all')
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
