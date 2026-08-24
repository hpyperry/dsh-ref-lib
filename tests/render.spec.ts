import { describe, expect, it } from 'vitest'
import { renderLibList, renderRefLibsV15 } from '../src/render.ts'
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
