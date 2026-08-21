/**
 * 竞态守卫（RefreshGuard）单测：并发读的乱序/覆盖防护。
 *
 * 覆盖 RefLibDock 竞态分析（设计文档 §15）中的核心场景：
 * - 响应乱序（先发后至）：旧号丢弃，只接受最后发起者
 * - 并发发起（轮询 vs 操作后刷新）：后发起者胜出
 * - invalidate（会话切换/卸载）：作废所有 in-flight
 */
import { describe, expect, it } from 'vitest'
import { RefreshGuard } from '../src/client/refresh-guard.ts'

describe('RefreshGuard（并发读守卫）', () => {
  it('顺序发起：最新编号被接受', () => {
    const guard = new RefreshGuard()
    const mine = guard.begin()
    expect(guard.isLatest(mine)).toBe(true)
  })

  it('后发起使前一个请求作废（只接受最后发起者）', () => {
    const guard = new RefreshGuard()
    const first = guard.begin()
    const second = guard.begin()
    expect(guard.isLatest(first)).toBe(false)
    expect(guard.isLatest(second)).toBe(true)
  })

  it('模拟响应乱序：先发起的请求后返回 → 旧快照被丢弃，新快照被接受', () => {
    const guard = new RefreshGuard()
    // 场景：轮询先发起（旧数据），操作后刷新后发起（新数据）
    const poll = guard.begin()       // t0 轮询发起（服务端快照 = 添加前）
    const afterOp = guard.begin()    // t1 操作完成后的刷新发起（快照 = 添加后）
    // 乱序返回：轮询（旧）后返回
    expect(guard.isLatest(poll)).toBe(false)       // 丢弃旧快照
    expect(guard.isLatest(afterOp)).toBe(true)     // 接受新快照
  })

  it('模拟操作中轮询：轮询请求在操作写盘前发出、操作后返回 → 仍被丢弃', () => {
    const guard = new RefreshGuard()
    const poll = guard.begin()       // 轮询在 add 写盘前发出（快照不含新库）
    // add 写盘完成 → 操作后刷新发起（这是"最后发起"，必然胜出）
    const afterAdd = guard.begin()
    // 轮询返回（哪怕在 add 之后到达）
    expect(guard.isLatest(poll)).toBe(false)
    expect(guard.isLatest(afterAdd)).toBe(true)
  })

  it('invalidate 作废所有 in-flight（会话切换/卸载）', () => {
    const guard = new RefreshGuard()
    const mine = guard.begin()
    guard.invalidate()
    expect(guard.isLatest(mine)).toBe(false)
    // 作废后新发起恢复正常
    const next = guard.begin()
    expect(guard.isLatest(next)).toBe(true)
  })

  it('多次并发发起：仅最后一个接受，其余全部丢弃', () => {
    const guard = new RefreshGuard()
    const ids = Array.from({ length: 5 }, () => guard.begin())
    expect(guard.isLatest(ids[0]!)).toBe(false)
    expect(guard.isLatest(ids[1]!)).toBe(false)
    expect(guard.isLatest(ids[2]!)).toBe(false)
    expect(guard.isLatest(ids[3]!)).toBe(false)
    expect(guard.isLatest(ids[4]!)).toBe(true)
  })

  it('编号单调递增，互不冲突', () => {
    const guard = new RefreshGuard()
    expect(guard.begin()).toBe(1)
    expect(guard.begin()).toBe(2)
    expect(guard.begin()).toBe(3)
  })
})
