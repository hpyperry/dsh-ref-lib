import { describe, expect, it } from 'vitest'
import { pickGlyph, type GlyphProps, type GlyphTable } from '../src/client/glyph.ts'

/** 替身组件：pickGlyph 只做按名取值，不渲染，所以用字符串当哨兵就够了。 */
const sentinel = (name: string): GlyphProps => name as unknown as GlyphProps

/** 用哨兵表构造图标表（避开加载真实 ui-primitives）。 */
function tableOf(entries: Record<string, string>): GlyphTable {
  return Object.fromEntries(
    Object.entries(entries).map(([k, v]) => [k, sentinel(v)]),
  ) as unknown as GlyphTable
}

describe('pickGlyph：跨 dsh 版本的图标取值回退', () => {
  it('两代名字都在时优先新版 Regular', () => {
    const table = tableOf({ IconFooRegular: 'new', IconFoo16: 'old16' })
    expect(pickGlyph(table, 'IconFoo')).toBe('new')
  })

  it('只有旧版 16 时回退到 16（dsh 0.1.6 及以前）', () => {
    expect(pickGlyph(tableOf({ IconFoo16: 'old16' }), 'IconFoo')).toBe('old16')
  })

  it('只有旧版 14 时回退到 14（如 IconChevronRightOutline14）', () => {
    expect(pickGlyph(tableOf({ IconFoo14: 'old14' }), 'IconFoo')).toBe('old14')
  })

  it('16 与 14 都在时优先 16', () => {
    expect(pickGlyph(tableOf({ IconFoo16: 'old16', IconFoo14: 'old14' }), 'IconFoo')).toBe('old16')
  })

  it('命名不含 Outline 中缀的字形同样走同一回退（IconFolderOpen → IconFolderOpen16）', () => {
    expect(pickGlyph(tableOf({ IconFolderOpen16: 'old16' }), 'IconFolderOpen')).toBe('old16')
    expect(pickGlyph(tableOf({ IconFolderOpenRegular: 'new' }), 'IconFolderOpen')).toBe('new')
  })

  it('两代名字都缺时抛错（宁可启动即报错，也不渲染 undefined 白屏）', () => {
    expect(() => pickGlyph(tableOf({}), 'IconMissing')).toThrow(/IconMissing/)
  })

  it('不回退到无后缀的名字（旧版就带 16/14，裸名不是合法旧名）', () => {
    expect(() => pickGlyph(tableOf({ IconFoo: 'bare' }), 'IconFoo')).toThrow()
  })
})
