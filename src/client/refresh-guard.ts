/**
 * 并发读守卫（竞态控制核心）：只接受"最后发起"的请求结果。
 *
 * RefLibDock 有多个并发"拉取列表"来源——挂载预载、打开面板、30s 轮询、操作后的
 * 刷新——网络返回顺序不保证，旧快照可能覆盖新快照。守卫用递增编号标记每次发起：
 * 返回时只有仍持有**最新编号**的请求结果才被应用，其余一律丢弃。
 *
 * 为什么"最后发起"就代表最新：`list` 返回的是请求发起时刻的服务端快照，发起越晚
 * 快照越新，所以只信最后发起者 ≈ 只信最新快照。操作后的刷新总是最后发起（操作
 * 完成后才发起），天然胜出；响应乱序时旧号被丢弃，最终一致。
 *
 * 纯 TS、零依赖、零 DOM——node 环境可直接单元测试（tests/refresh-guard.spec.ts）。
 * @module @hpyperry/dsh-ref-lib/src/client/refresh-guard
 */
export class RefreshGuard {
  private seq = 0

  /** 发起一次请求，返回本次请求的编号。 */
  begin(): number {
    this.seq += 1
    return this.seq
  }

  /**
   * 该编号是否仍是最新发起者。
   * @param mine - 发起时 {@link begin} 返回的编号。
   * @returns true 表示应应用该请求的结果；false 表示期间又有新请求发起，结果已过期。
   */
  isLatest(mine: number): boolean {
    return mine === this.seq
  }

  /**
   * 作废所有 in-flight 请求的结果（会话切换 / 组件卸载时调用）：seq 递增后，
   * 任何旧编号的 {@link isLatest} 都返回 false。
   */
  invalidate(): void {
    this.seq += 1
  }
}
