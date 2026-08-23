import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { applyProbe, attachSessionMeta, filterAvailable, foldRefLibs, planImport, probeLibs, removeLib, statusChanged, upsertLib } from '../src/logic.ts'
import type { RefLibEntry } from '../src/spec.ts'

const a: RefLibEntry = { id: 'a', path: '/lib/a' }
const b: RefLibEntry = { id: 'b', path: '/lib/b', note: 'note-b' }

/** 构造一个 `ref-lib/set` 事件。 */
function setEvent(libs: readonly RefLibEntry[], seq: number): SessionEvent {
  return { type: 'ref-lib/set', data: { libs }, seq, time: 0 } as SessionEvent
}

describe('foldRefLibs', () => {
  it('无事件返回空列表', () => {
    expect(foldRefLibs([])).toEqual([])
    expect(foldRefLibs([{ type: 'user/message', data: {}, seq: 0, time: 0 }] as unknown as SessionEvent)).toEqual([])
  })

  it('取最后一个 ref-lib/set 的完整快照', () => {
    const events = [
      setEvent([a], 0),
      { type: 'turn/start', data: { turn: 1 }, seq: 1, time: 0 } as unknown as SessionEvent,
      setEvent([a, b], 2),
      setEvent([b], 3),
    ]
    expect(foldRefLibs(events)).toEqual([b])
  })

  it('畸形 ref-lib/set（libs 非数组）被忽略，保留上一个有效快照', () => {
    const events = [
      setEvent([a], 0),
      { type: 'ref-lib/set', data: { libs: 'nope' }, seq: 1, time: 0 } as unknown as SessionEvent,
      { type: 'ref-lib/set', data: undefined, seq: 2, time: 0 } as unknown as SessionEvent,
    ]
    expect(foldRefLibs(events)).toEqual([a])
  })

  it('畸形条目被过滤（宽松校验，不抛错）', () => {
    const events = [
      {
        type: 'ref-lib/set',
        data: { libs: [{ id: 'ok', path: '/x' }, { id: 42 }, 'x', null] },
        seq: 0,
        time: 0,
      } as unknown as SessionEvent,
    ]
    expect(foldRefLibs(events)).toEqual([{ id: 'ok', path: '/x' }])
  })
})

describe('upsertLib', () => {
  it('追加新条目', () => {
    expect(upsertLib([], a)).toEqual([a])
    expect(upsertLib([a], b)).toEqual([a, b])
  })

  it('同 id 幂等', () => {
    expect(upsertLib([a], { ...a, note: 'x' })).toEqual([a])
  })

  it('同 path 幂等', () => {
    expect(upsertLib([a], { id: 'new-id', path: '/lib/a' })).toEqual([a])
  })
})

describe('removeLib', () => {
  it('按 id 移除', () => {
    expect(removeLib([a, b], 'a')).toEqual([b])
  })

  it('未知 id 幂等', () => {
    expect(removeLib([a, b], 'zzz')).toEqual([a, b])
  })
})

describe('filterAvailable', () => {
  it('全可用不变', () => {
    const libs: RefLibEntry[] = [
      { id: '1', path: '/lib/a', status: 'available', checkedAt: 1 },
      { id: '2', path: '/lib/b', status: 'available', checkedAt: 1 },
    ]
    expect(filterAvailable(libs)).toEqual(libs)
  })

  it('过滤 missing / not-directory / 未检测条目', () => {
    const ok: RefLibEntry = { id: '1', path: '/lib/a', status: 'available', checkedAt: 1 }
    const libs: RefLibEntry[] = [
      ok,
      { id: '2', path: '/lib/deleted', status: 'missing', checkedAt: 1 },
      { id: '3', path: '/lib/replaced', status: 'not-directory', checkedAt: 1 },
      { id: '4', path: '/lib/unprobed' },
    ]
    expect(filterAvailable(libs)).toEqual([ok])
  })

  it('全失效返回空', () => {
    const libs: RefLibEntry[] = [
      { id: '1', path: '/lib/a', status: 'missing', checkedAt: 1 },
      { id: '2', path: '/lib/b' },
    ]
    expect(filterAvailable(libs)).toEqual([])
  })
})

describe('statusChanged', () => {
  it('从未检测（status 缺省）→ 需要落盘', () => {
    expect(statusChanged({ id: '1', path: '/lib/a' }, 'available')).toBe(true)
    expect(statusChanged({ id: '1', path: '/lib/a' }, 'missing')).toBe(true)
  })

  it('探测结果与当前一致 → 不写盘', () => {
    expect(statusChanged({ id: '1', path: '/lib/a', status: 'available' }, 'available')).toBe(false)
    expect(statusChanged({ id: '1', path: '/lib/a', status: 'missing' }, 'missing')).toBe(false)
    expect(statusChanged({ id: '1', path: '/lib/a', status: 'not-directory' }, 'not-directory')).toBe(false)
  })

  it('探测结果变化 → 需要写盘', () => {
    expect(statusChanged({ id: '1', path: '/lib/a', status: 'available' }, 'missing')).toBe(true)
    expect(statusChanged({ id: '1', path: '/lib/a', status: 'missing' }, 'available')).toBe(true)
    expect(statusChanged({ id: '1', path: '/lib/a', status: 'available' }, 'not-directory')).toBe(true)
  })
})

describe('planImport（v12 跨会话导入规划）', () => {
  const mine: RefLibEntry[] = [
    { id: 'm1', path: '/lib/shared', note: '我的 note' },
    { id: 'm2', path: '/lib/only-mine' },
  ]
  const incoming: RefLibEntry[] = [
    { id: 'i1', path: '/lib/shared', note: '导入的 note' },
    { id: 'i2', path: '/lib/only-import' },
    { id: 'i3', path: '/lib/only-import-2' },
  ]

  it('无冲突条目全部进入 additions（note 保持源值）', () => {
    const plan = planImport([], incoming, () => 'mine')
    expect(plan.additions).toEqual([
      { path: '/lib/shared', note: '导入的 note' },
      { path: '/lib/only-import' },
      { path: '/lib/only-import-2' },
    ])
    expect(plan.replacements).toEqual([])
  })

  it('冲突条目按决策：保留我的 → 跳过；使用导入的 → replacements（含无 note 清除语义）', () => {
    const plan = planImport(mine, incoming, (mineEntry) => (mineEntry.id === 'm1' ? 'import' : 'mine'))
    expect(plan.additions).toEqual([{ path: '/lib/only-import' }, { path: '/lib/only-import-2' }])
    expect(plan.replacements).toEqual([{ existingId: 'm1', note: '导入的 note' }])
  })

  it('决策使用导入的且导入侧无 note → replacement 不带 note（服务端清除现有 note）', () => {
    const noNote = [{ id: 'i9', path: '/lib/shared' }]
    const plan = planImport(mine, noNote, () => 'import')
    expect(plan.replacements).toEqual([{ existingId: 'm1' }])
  })

  it('决策保留我的 → 冲突条目两边都不产出', () => {
    const plan = planImport(mine, incoming, () => 'mine')
    expect(plan.additions).toEqual([{ path: '/lib/only-import' }, { path: '/lib/only-import-2' }])
    expect(plan.replacements).toEqual([])
  })

  it('空输入幂等', () => {
    expect(planImport([], [], () => 'mine')).toEqual({ additions: [], replacements: [] })
    expect(planImport(mine, [], () => 'mine')).toEqual({ additions: [], replacements: [] })
  })
})

describe('attachSessionMeta（v12 标题与工作区补全）', () => {
  const sources = [
    { sessionId: 's1', count: 2, available: 1, updatedAt: 100 },
    { sessionId: 's2', count: 1, available: 1, updatedAt: 200 },
  ]

  it('fulfilled 且带标题 → 补全 title；带 cwd → 补全 cwd', () => {
    const result = attachSessionMeta(sources, [
      { status: 'fulfilled', value: { title: { title: '会话 A' }, session: { cwd: '/w/a' } } },
      { status: 'fulfilled', value: { title: { title: '会话 B' } } },
    ])
    expect(result[0]).toMatchObject({ sessionId: 's1', title: '会话 A', cwd: '/w/a' })
    expect(result[1]).toMatchObject({ sessionId: 's2', title: '会话 B' })
  })

  it('rejected / 无标题 / 空标题 → 保持无 title（cwd 仍补全）', () => {
    const result = attachSessionMeta(sources, [
      { status: 'rejected' },
      { status: 'fulfilled', value: { session: { cwd: '/w/b' } } },
    ])
    expect(result[0]?.title).toBeUndefined()
    expect(result[0]?.cwd).toBeUndefined()
    expect(result[1]?.title).toBeUndefined()
    expect(result[1]?.cwd).toBe('/w/b')
  })

  it('观测数量不足/多余都容忍', () => {
    const short = attachSessionMeta(sources, [{ status: 'fulfilled', value: { title: { title: 'A' } } }])
    expect(short[0]?.title).toBe('A')
    expect(short[1]?.title).toBeUndefined()
    const long = attachSessionMeta(sources, [
      { status: 'fulfilled', value: { title: { title: 'A' } } },
      { status: 'fulfilled', value: { title: { title: 'B' } } },
      { status: 'fulfilled', value: { title: { title: 'C' } } },
    ])
    expect(long).toHaveLength(2)
  })
})

describe('probeLibs / applyProbe（v12.1 源读取实时探测）', () => {
  const probe = (path: string): 'available' | 'missing' | 'not-directory' =>
    path === '/lib/ok' ? 'available' : 'missing'

  it('状态未变（或从未检测）时返回原引用', () => {
    const entry: RefLibEntry = { id: 'a', path: '/lib/ok', status: 'available', checkedAt: 1 }
    expect(applyProbe(entry, probe, 2)).toBe(entry)
    const unprobed: RefLibEntry = { id: 'b', path: '/lib/ok' }
    const probed = applyProbe(unprobed, probe, 2)
    expect(probed).toMatchObject({ id: 'b', path: '/lib/ok', status: 'available', checkedAt: 2 })
  })

  it('状态变化时返回新对象并更新 status/checkedAt', () => {
    const entry: RefLibEntry = { id: 'a', path: '/lib/gone', status: 'available', checkedAt: 1 }
    const probed = applyProbe(entry, probe, 5)
    expect(probed).not.toBe(entry)
    expect(probed).toMatchObject({ id: 'a', path: '/lib/gone', status: 'missing', checkedAt: 5 })
  })

  it('probeLibs 批量探测并报告是否有变化', () => {
    const libs: RefLibEntry[] = [
      { id: 'a', path: '/lib/ok', status: 'available', checkedAt: 1 },
      { id: 'b', path: '/lib/gone', status: 'available', checkedAt: 1 },
    ]
    const { next, changed } = probeLibs(libs, probe, 9)
    expect(changed).toBe(true)
    expect(next[0]).toBe(libs[0])
    expect(next[1]).toMatchObject({ id: 'b', path: '/lib/gone', status: 'missing', checkedAt: 9 })
    // 无变化
    const stableInput: RefLibEntry[] = [{ id: 'a', path: '/lib/ok', status: 'available', checkedAt: 1 }]
    const stable = probeLibs(stableInput, probe, 9)
    expect(stable.changed).toBe(false)
    expect(stable.next[0]).toBe(stableInput[0])
  })
})
