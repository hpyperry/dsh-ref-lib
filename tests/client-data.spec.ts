/** client 端数据纯函数（/api/ref-lib 路由响应解析）单测。 */
import { describe, expect, it } from 'vitest'
import { libBasename, parseApiErrorPayload, parseLibsPayload } from '../src/client/data.ts'

describe('parseLibsPayload', () => {
  it('缺失/畸形返回空列表', () => {
    expect(parseLibsPayload(undefined)).toEqual([])
    expect(parseLibsPayload({})).toEqual([])
    expect(parseLibsPayload({ libs: 'nope' })).toEqual([])
  })

  it('解析路由响应中的 libs', () => {
    expect(parseLibsPayload({ libs: [{ id: '1', path: '/lib/a', note: 'core' }] })).toEqual([
      { id: '1', path: '/lib/a', note: 'core' },
    ])
  })

  it('跳过畸形条目', () => {
    expect(parseLibsPayload({ libs: [{ id: '1', path: '/lib/a' }, { id: 42 }, 'x'] })).toEqual([
      { id: '1', path: '/lib/a' },
    ])
  })
})

describe('parseApiErrorPayload（v5 wire code）', () => {
  it('解析带 code/path 的错误体', () => {
    expect(parseApiErrorPayload({ error: '参考库路径不存在：/nope', code: 'ref-lib/missing', path: '/nope' })).toEqual({
      code: 'ref-lib/missing',
      message: '参考库路径不存在：/nope',
      details: { path: '/nope' },
    })
  })

  it('解析带 code/id 的错误体', () => {
    expect(parseApiErrorPayload({ error: '未找到参考库条目：x', code: 'ref-lib/unknown-id', id: 'x' })).toEqual({
      code: 'ref-lib/unknown-id',
      message: '未找到参考库条目：x',
      details: { id: 'x' },
    })
  })

  it('无 code 的畸形体返回 null', () => {
    expect(parseApiErrorPayload(undefined)).toBeNull()
    expect(parseApiErrorPayload({})).toBeNull()
    expect(parseApiErrorPayload({ error: 'boom' })).toBeNull()
    expect(parseApiErrorPayload('x')).toBeNull()
  })

  it('code 存在但 error 缺失时以 code 兜底消息', () => {
    expect(parseApiErrorPayload({ code: 'ref-lib/unsafe' })?.message).toBe('ref-lib/unsafe')
  })
})

describe('libBasename（列表行展示标题）', () => {
  it('POSIX 路径取基名', () => {
    expect(libBasename('/a/b/core')).toBe('core')
    expect(libBasename('/a/b/core/')).toBe('core')
    expect(libBasename('core')).toBe('core')
  })

  it('Windows 路径取基名', () => {
    expect(libBasename('C:\\Users\\me\\core')).toBe('core')
    expect(libBasename('C:\\core\\')).toBe('core')
  })

  it('根路径原样返回', () => {
    expect(libBasename('/')).toBe('/')
    expect(libBasename('C:\\')).toBe('C:\\')
  })
})
