// L0：纯函数（无 IO、不碰宿主）
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
    // v16 面板：静态副标题 + 红绿灯计数（可用/失效各带 {count}）
    expect(zh['panel.subtitle']).toContain('参考')
    expect(en['panel.subtitle']).toContain('reference')
    expect(zh['panel.available']).toContain('{count}')
    expect(en['panel.available']).toContain('{count}')
    expect(zh['panel.unavailable']).toContain('{count}')
    expect(en['panel.unavailable']).toContain('{count}')
    // v23 非 live 态：说清"去哪个实例操作"，并露出「重试」
    expect(zh['error.sessionNotLive']).toContain('另一个 dsh 实例')
    expect(en['error.sessionNotLive']).toContain('another dsh instance')
    expect(zh['error.retry']).toBe('重试')
    expect(en['error.retry']).toBe('Retry')
  })
})
