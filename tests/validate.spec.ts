/** 共享校验/消毒纯函数（src/validate.ts）单测。 */
import { describe, expect, it } from 'vitest'
import { hasControlCharacters, isRefLibEntry, sanitizeControlCharacters } from '../src/validate.ts'

describe('isRefLibEntry', () => {
  it('合法条目通过（note 可省略或为字符串）', () => {
    expect(isRefLibEntry({ id: '1', path: '/lib/a' })).toBe(true)
    expect(isRefLibEntry({ id: '1', path: '/lib/a', note: 'core' })).toBe(true)
  })

  it('非对象/缺字段/字段类型错误一律拒绝', () => {
    expect(isRefLibEntry(undefined)).toBe(false)
    expect(isRefLibEntry(null)).toBe(false)
    expect(isRefLibEntry('x')).toBe(false)
    expect(isRefLibEntry({})).toBe(false)
    expect(isRefLibEntry({ id: 42, path: '/x' })).toBe(false)
    expect(isRefLibEntry({ id: '1', path: '/x', note: 7 })).toBe(false)
    expect(isRefLibEntry({ id: '1' })).toBe(false)
  })
})

describe('控制字符检测/消毒（提示词注入卫生）', () => {
  it('C0/DEL/C1/行分隔符均判定为含控制字符', () => {
    expect(hasControlCharacters('a\nb')).toBe(true)
    expect(hasControlCharacters('a\u007fb')).toBe(true)
    expect(hasControlCharacters('a\u0085b')).toBe(true) // C1 NEL
    expect(hasControlCharacters('a\u2028b')).toBe(true) // 行分隔符
    expect(hasControlCharacters('a\u2029b')).toBe(true) // 段分隔符
    expect(hasControlCharacters('/lib/core')).toBe(false)
  })

  it('消毒全部控制字符为 U+FFFD（含多处混合）', () => {
    expect(sanitizeControlCharacters('/lib/a\nb\u2028c\u0007d\u0085e')).toBe('/lib/a\uFFFDb\uFFFDc\uFFFDd\uFFFDe')
  })

  it('无控制字符时原样返回', () => {
    expect(sanitizeControlCharacters('/lib/core')).toBe('/lib/core')
  })
})
