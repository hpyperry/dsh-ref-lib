/** ref-lib 本地化字典：zh/en 键集对等 + 关键文案抽查。 */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('ref-lib locale dictionaries', () => {
  it('zh 与 en 键集完全一致（双向）', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('覆盖入口、面板、添加表单与错误映射的完整文案面', () => {
    expect(zh['dock.label']).toBe('参考库')
    expect(en['dock.label']).toBe('Reference Library')
    expect(zh['error.missing']).toContain('{path}')
    expect(en['error.missing']).toContain('{path}')
    expect(zh['panel.description']).toContain('{count}')
    expect(en['panel.description']).toContain('{count}')
  })
})
