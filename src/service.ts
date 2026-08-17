/**
 * `ctx.refLibs` 服务：per-session 只读参考库的校验与持久化。
 *
 * v3（2026-08-17 事故修复）：**不再向会话日志写入自定义事件**。harness 的会话
 * 加载器只认仓库内生成的白名单 `KNOWN_SESSION_EVENT_TYPES` 里的事件类型，白名单
 * 外的必须带 `ignorable: true` 信封标记才允许跳过，而 `session.append()` 不提供
 * 写入该标记的途径——旧版把状态写成 `ref-lib/set` 事件，会导致任何包含该事件的
 * 会话日志被整体拒读（连写它的 harness 自己也读不回，SessionFormatUnsupportedError）。
 * v3 起 per-session 列表存为 dsh home 下的 sidecar JSON
 * （`<dshHome>/plugin-data/ref-lib/<sessionId>.json`）；旧日志中的 `ref-lib/set`
 * 事件仅在冷读时折叠迁移一次，会话隔离与 fork 继承语义保持不变。
 * @module @hpyperry/dsh-ref-lib/src/service
 */

import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import { foldRefLibs, removeLib, upsertLib } from './logic.ts'
import type { RefLibEntry } from './spec.ts'
import { hasControlCharacters, isRefLibEntry } from './validate.ts'

/** sidecar 文件内容版本（v3 文件 = `{ version: 2, libs }`）。 */
const SIDECAR_VERSION = 2

/**
 * 内存缓存会话数上限：超出后按插入序淘汰最旧会话（下次访问从 sidecar 重读，
 * 语义不变，只是多一次文件读）。防止长驻进程在大量会话上无限累积内存。
 */
const CACHE_MAX_SESSIONS = 512

/** add 请求指向的路径不存在或不是目录（或含控制字符）。 */
export class RefLibPathError extends Error {
  /**
   * @param path - 请求路径。
   * @param reason - 具体原因（不存在 / 不是目录 / 含控制字符）。
   */
  constructor(
    readonly path: string,
    readonly reason: 'missing' | 'not-directory' | 'unsafe',
  ) {
    super(
      reason === 'missing'
        ? `参考库路径不存在：${path}`
        : reason === 'not-directory'
          ? `参考库路径不是目录：${path}`
          : `参考库路径包含控制字符，已拒绝（防止破坏上下文注入）：${JSON.stringify(path)}`,
    )
    this.name = 'RefLibPathError'
  }
}

/** 请求的条目 id 未注册。 */
export class RefLibUnknownError extends Error {
  /**
   * @param id - 未注册的条目 id。
   */
  constructor(readonly id: string) {
    super(`未找到参考库条目：${id}（先用 /ref-lib list 查看本会话已注册条目）`)
    this.name = 'RefLibUnknownError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    refLibs: RefLibService
  }
}

/** RefLibService 构造配置。 */
export interface RefLibServiceConfig {
  /**
   * 存储根目录；默认 `<dshHome>/plugin-data/ref-lib`（测试可注入临时目录）。
   */
  readonly root?: string
}

/** 把 session id 编码为安全路径段（同 harness encodeSegment 方案：安全字符原样，其余 ~XXXX）。 */
function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty session id')
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/**
 * 只读参考库注册表（**per-session**）：列表存为 dsh home 下 sidecar JSON
 * （`<dshHome>/plugin-data/ref-lib/<sessionId>.json`），会话隔离、随重启持久。
 * 路径在 add 时做 realpath 规范化并校验为存在的目录。
 */
export class RefLibService extends Service {
  private readonly root: string
  private readonly cache = new Map<string, readonly RefLibEntry[]>()

  /**
   * @param ctx - 宿主上下文。
   * @param config - 可选存储根目录覆盖（测试用）。
   */
  constructor(ctx: Context, config: RefLibServiceConfig = {}) {
    super(ctx, 'refLibs')
    this.root = config.root ?? join(dshHomePath('plugin-data', 'ref-lib'))
  }

  /** 当前会话的参考库列表（内存缓存 → sidecar 文件 → 旧日志迁移 → 父会话继承）。 */
  list(session: Session): readonly RefLibEntry[] {
    const cached = this.cache.get(session.id)
    if (cached !== undefined) return cached
    const libs = this.loadFromStorage(session)
    this.cacheSet(session.id, libs)
    return libs
  }

  /**
   * 为当前会话注册一个只读参考库：realpath 规范化并校验为存在的目录；
   * 同路径已注册时幂等返回现有条目。
   * @param session - 目标会话。
   * @param path - 目录路径（相对路径按宿主 cwd 解析）。
   * @returns 新增（或已存在）的条目。
   * @throws {RefLibPathError} 路径不存在或不是目录。
   */
  async add(session: Session, path: string): Promise<RefLibEntry> {
    const canonical = await realpath(path).catch(() => {
      throw new RefLibPathError(path, 'missing')
    })
    // 控制字符路径会破坏 systemPrompt 注入格式（提示词注入卫生）：POSIX 允许
    // 目录名含换行等，端点可到达时拒绝，渲染层另有兜底消毒（render.ts）。
    if (hasControlCharacters(canonical)) throw new RefLibPathError(canonical, 'unsafe')
    const info = await stat(canonical).catch(() => {
      throw new RefLibPathError(path, 'missing')
    })
    if (!info.isDirectory()) throw new RefLibPathError(path, 'not-directory')
    const current = this.list(session)
    const existing = current.find((entry) => entry.path === canonical)
    if (existing !== undefined) return existing
    const entry: RefLibEntry = { id: randomUUID(), path: canonical }
    const next = upsertLib(current, entry)
    this.persistSync(session.id, next)
    this.cacheSet(session.id, next)
    return entry
  }

  /**
   * 从当前会话移除一个参考库条目（不删除磁盘目录）。
   * @param session - 目标会话。
   * @param id - 条目 id。
   * @throws {RefLibUnknownError} id 未注册。
   */
  async remove(session: Session, id: string): Promise<void> {
    const current = this.list(session)
    if (!current.some((entry) => entry.id === id)) throw new RefLibUnknownError(id)
    const next = removeLib(current, id)
    this.persistSync(session.id, next)
    this.cacheSet(session.id, next)
  }

  /** 冷读：sidecar 文件 → 旧日志事件迁移 → 父会话继承 → 空列表。 */
  private loadFromStorage(session: Session): readonly RefLibEntry[] {
    const file = this.pathOf(session.id)
    if (existsSync(file)) {
      const stored = this.readSidecar(file)
      if (stored !== undefined) return stored
    }
    // v1/v2 遗留：从会话日志的 `ref-lib/set` 事件折叠（取最后一个完整快照）。
    // 一次性落盘，保证迁移结果对父会话继承可见。
    const fromEvents = foldRefLibs(session.events)
    if (fromEvents.length > 0) {
      this.persistSync(session.id, fromEvents)
      return fromEvents
    }
    // fork 继承：子会话无自身状态时继承父会话的列表（与旧事件 seed 行为一致）。
    const parentId = session.header.parentSession
    if (parentId !== undefined) {
      const parentFile = this.pathOf(parentId)
      if (existsSync(parentFile)) {
        const inherited = this.readSidecar(parentFile)
        if (inherited !== undefined) return inherited
      }
    }
    return []
  }

  private pathOf(sessionId: string): string {
    // `.json` 后缀：避免与持久化后端的会话目录命名（`<root>/<sessionId>/`）撞名
    return join(this.root, encodeSegment(sessionId) + '.json')
  }

  /** 读取并校验一个 sidecar 文件；缺失/畸形返回 undefined（不覆盖文件，待下次写入）。 */
  private readSidecar(file: string): readonly RefLibEntry[] | undefined {
    try {
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof value !== 'object' || value === null) return undefined
      const { libs } = value as { libs?: unknown }
      if (!Array.isArray(libs)) return undefined
      return libs.filter(isRefLibEntry)
    } catch (error) {
      this.ctx.logger.warn(`ref-lib: 无法读取 sidecar ${file}：${String(error)}（按空列表处理）`)
      return undefined
    }
  }

  /** 原子写入 sidecar（tmp + rename），并同步内存缓存。 */
  private persistSync(sessionId: string, libs: readonly RefLibEntry[]): void {
    const file = this.pathOf(sessionId)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: SIDECAR_VERSION, libs }))
    renameSync(tmp, file)
  }

  /** 写缓存并执行容量淘汰（Map 按插入序，淘汰最旧会话）。 */
  private cacheSet(sessionId: string, libs: readonly RefLibEntry[]): void {
    this.cache.set(sessionId, libs)
    if (this.cache.size > CACHE_MAX_SESSIONS) {
      const oldest = this.cache.keys().next()
      if (!oldest.done) this.cache.delete(oldest.value)
    }
  }
}
