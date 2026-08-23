/** client 端数据纯函数（/api/ref-lib 路由响应解析）单测。 */
import { describe, expect, it } from 'vitest'
import { classifyImport, libBasename, parseApiErrorPayload, parseLibsPayload, parseSessionsPayload } from '../src/client/data.ts'

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

describe('parseSessionsPayload（v12 来源会话清单）', () => {
  it('缺失/畸形返回空列表', () => {
    expect(parseSessionsPayload(undefined)).toEqual([])
    expect(parseSessionsPayload({})).toEqual([])
    expect(parseSessionsPayload({ sessions: 'nope' })).toEqual([])
  })

  it('解析会话行', () => {
    expect(
      parseSessionsPayload({
        sessions: [{ sessionId: 's1', count: 3, available: 2, updatedAt: 1000 }],
      }),
    ).toEqual([{ sessionId: 's1', count: 3, available: 2, updatedAt: 1000 }])
  })

  it('跳过缺关键字段的畸形行', () => {
    expect(
      parseSessionsPayload({
        sessions: [
          { sessionId: 's1', count: 1, available: 1, updatedAt: 1 },
          { sessionId: '', count: 1, available: 1, updatedAt: 1 },
          { sessionId: 's2', count: 'x', available: 1, updatedAt: 1 },
          { count: 1, available: 1, updatedAt: 1 },
        ],
      }),
    ).toEqual([{ sessionId: 's1', count: 1, available: 1, updatedAt: 1 }])
  })
})

describe('classifyImport（v12 冲突分类）', () => {
  const mine = [
    { id: 'm1', path: '/lib/shared', note: '我的' },
    { id: 'm2', path: '/lib/only-mine' },
  ]
  const incoming = [
    { id: 'i1', path: '/lib/shared', note: '导入的' },
    { id: 'i2', path: '/lib/only-import' },
  ]

  it('path 相同 → 冲突配对；path 不同 → additions', () => {
    const result = classifyImport(mine, incoming)
    expect(result.additions).toEqual([{ id: 'i2', path: '/lib/only-import' }])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.mine).toEqual({ id: 'm1', path: '/lib/shared', note: '我的' })
    expect(result.conflicts[0]?.incoming).toEqual({ id: 'i1', path: '/lib/shared', note: '导入的' })
  })

  it('note 不同 → noteDiffers；状态不同 → statusDiffers', () => {
    const withStatus = classifyImport(
      [{ id: 'm1', path: '/lib/a', status: 'missing', checkedAt: 1 }],
      [{ id: 'i1', path: '/lib/a', status: 'available', checkedAt: 2, note: 'x' }],
    )
    expect(withStatus.conflicts[0]).toMatchObject({ noteDiffers: true, statusDiffers: true })
    const sameNote = classifyImport(
      [{ id: 'm1', path: '/lib/a', note: 'x' }],
      [{ id: 'i1', path: '/lib/a', note: 'x' }],
    )
    expect(sameNote.conflicts[0]).toMatchObject({ noteDiffers: false, statusDiffers: false })
  })

  it('一侧无 note 视为 note 不同', () => {
    const result = classifyImport([{ id: 'm1', path: '/lib/a' }], [{ id: 'i1', path: '/lib/a', note: '有' }])
    expect(result.conflicts[0]?.noteDiffers).toBe(true)
  })

  it('空输入幂等', () => {
    expect(classifyImport([], [])).toEqual({ additions: [], conflicts: [] })
  })
})

describe('parseSessionsPayload（v12 标题字段）', () => {
  it('解析带标题的会话行', () => {
    expect(
      parseSessionsPayload({
        sessions: [{ sessionId: 's1', title: '会话 A', count: 2, available: 1, updatedAt: 100 }],
      }),
    ).toEqual([{ sessionId: 's1', title: '会话 A', count: 2, available: 1, updatedAt: 100 }])
  })

  it('空标题省略 title 字段', () => {
    expect(
      parseSessionsPayload({
        sessions: [{ sessionId: 's1', title: '', count: 1, available: 1, updatedAt: 1 }],
      }),
    ).toEqual([{ sessionId: 's1', count: 1, available: 1, updatedAt: 1 }])
  })
})
