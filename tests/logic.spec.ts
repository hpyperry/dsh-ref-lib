import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { filterAvailable, foldRefLibs, removeLib, statusChanged, upsertLib } from '../src/logic.ts'
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
