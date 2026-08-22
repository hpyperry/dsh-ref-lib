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
 * 事件仅在冷读时折叠迁移一次。
 *
 * **fork 继承（2026-08-23 加固）**：dsh 的「分支会话」在宿主创建**新会话**
 * （`SessionStore.fork()` 铸造新 id，header 携带 `parentSession`）。本服务在
 * `session/created`（`{ global: true }`，与 core/tools 的 seed 钩子同款）时
 * **物化继承**——子会话无自身 sidecar 则把父会话的有效列表复制到子会话自身文件
 * 并**重新铸造条目 id**（fork 副本拥有独立身份；单次写盘）。这修复了纯惰性继承
 * 的链式断口（fork 的分支的分支依赖中间会话是否落盘）并把继承时机从「首次读取」
 * 提前到「fork 时刻」（确定性快照）。复制用「读父列表 + 写子文件」而非逐条 add()：
 * add() 会重复校验路径并重读 README 提取 note（IO 且可能改变 note），复制等价且
 * 更省。UI 无需新通道：fork 后打开子会话，dock 挂载的现有 load()（GET /list）
 * 一次刷新即可读到继承结果（2026-08-23 简化：不新增 webServer 接口）。
 * 惰性 parentSession 继承路径（loadFromStorage 末段）保留并以同语义（重新铸造
 * id + 落盘）服务旧版本创建的 legacy 子会话。
 * @module @hpyperry/dsh-ref-lib/src/service
 */

import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import { foldRefLibs, removeLib, statusChanged, upsertLib } from './logic.ts'
import type { RefLibAvailability, RefLibEntry } from './spec.ts'
import { hasControlCharacters, isRefLibEntry } from './validate.ts'

/** sidecar 文件内容版本（v3 文件 = `{ version: 3, libs }`，条目带 status/checkedAt）。 */
const SIDECAR_VERSION = 3

/**
 * 探测目录可用性（同步 statSync）。库数量少、本地磁盘、单次亚毫秒级；同步形态
 * 保持 `list()` 与 systemPrompt 注入回调（`text()` 为同步函数）不变。
 * @param path - 目录绝对路径。
 * @returns 存在且是目录 → available；存在但不是目录 → not-directory；
 * stat 失败（不存在/权限不可达）→ missing。
 */
export function probeAvailability(path: string): RefLibAvailability {
  try {
    const info = statSync(path)
    return info.isDirectory() ? 'available' : 'not-directory'
  } catch {
    return 'missing'
  }
}

/**
 * 内存缓存会话数上限：超出后按插入序淘汰最旧会话（下次访问从 sidecar 重读，
 * 语义不变，只是多一次文件读）。防止长驻进程在大量会话上无限累积内存。
 */
const CACHE_MAX_SESSIONS = 512

/** 用途说明（note）最大长度；超出截断，防止注入文本膨胀。 */
export const NOTE_MAX_LENGTH = 120

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

/** note 含控制字符（提示词注入卫生；渲染层另有兜底消毒）。 */
export class RefLibNoteError extends Error {
  constructor() {
    super('用途说明（note）包含控制字符，已拒绝（防止破坏上下文注入）')
    this.name = 'RefLibNoteError'
  }
}

/** 条目目录不可用（missing / not-directory）：仅允许移除，其他变更（如更新 note）拒绝。 */
export class RefLibUnavailableError extends Error {
  /**
   * @param path - 失效条目的目录路径。
   */
  constructor(readonly path: string) {
    super(`参考库目录不可用（仅允许移除）：${path}`)
    this.name = 'RefLibUnavailableError'
  }
}

/** 从 README 文本提取首个 Markdown 标题（去 `#`、trim、限长）；无标题返回 undefined。 */
export function extractReadmeTitle(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const match = /^#\s+(.+)$/.exec(line.trim())
    if (match !== null) {
      const title = match[1]!.trim()
      return title.length > NOTE_MAX_LENGTH ? title.slice(0, NOTE_MAX_LENGTH) : title
    }
  }
  return undefined
}

/** 读取目录 README（README.md/README/readme.md/index.md）的首个标题作为默认 note；IO 失败静默返回 undefined。 */
async function readReadmeTitle(dir: string): Promise<string | undefined> {
  for (const candidate of ['README.md', 'README', 'readme.md', 'index.md']) {
    try {
      const content = await readFile(join(dir, candidate), 'utf8')
      const title = extractReadmeTitle(content)
      if (title !== undefined) return title
    } catch {
      /* 该候选不可读，尝试下一个 */
    }
  }
  return undefined
}

/** note 允许的空白：换行/制表（多行说明，渲染注入时折叠为空格）；
 * 其余不可见控制字符（含 U+2028/2029 行/段分隔符）仍拒绝——防止破坏注入格式。 */
const NOTE_UNSAFE_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/

/** 规范化 note：统一换行（\r\n/\r → \n）、trim；含不允许的控制字符抛 RefLibNoteError；
 * 空串/undefined 返回 undefined；超长截断。 */
function normalizeNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  const normalized = note.replace(/\r\n?/g, '\n').trim()
  if (normalized === '') return undefined
  if (NOTE_UNSAFE_CHARACTERS.test(normalized)) throw new RefLibNoteError()
  return normalized.length > NOTE_MAX_LENGTH ? normalized.slice(0, NOTE_MAX_LENGTH) : normalized
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
    // fork 继承物化：宿主每次创建会话（fork/subagent 带 parentSession）同步公告
    // `session/created`。`{ global: true }` 忽略上下文过滤（同 core/tools 的
    // seed 钩子）；监听器绝不抛错——session/created 监听器同步抛错会**回滚会话
    // 挂载**（core/session 的 announce 契约）。同步文件 IO 可接受：小文件、低频。
    ctx.on('session/created', (session) => {
      this.materializeInheritance(session)
    }, { global: true })
  }

  /** 当前会话的参考库列表（内存缓存 → sidecar 文件 → 旧日志迁移 → 父会话继承），
   * 返回前对每个条目实时探测可用性，状态变化时原子写回。每次读取（面板/命令/注入
   * 回调）即刷新——"下一次对话"必然反映最新失效状态。 */
  list(session: Session): readonly RefLibEntry[] {
    const cached = this.cache.get(session.id)
    const libs = cached !== undefined ? cached : this.loadFromStorage(session)
    const refreshed = this.refreshAvailability(session.id, libs)
    this.cacheSet(session.id, refreshed)
    return refreshed
  }

  /**
   * 对每个条目实时探测可用性；探测结果与条目当前 status 不同（或从未检测）时，
   * 更新 status/checkedAt 并原子写回 sidecar v3；无变化不写盘。
   * @param sessionId - 会话 id（写回目标）。
   * @param libs - 条目列表。
   * @returns 探测后的最新列表（元素在无变化时保持引用不变）。
   */
  private refreshAvailability(sessionId: string, libs: readonly RefLibEntry[]): readonly RefLibEntry[] {
    if (libs.length === 0) return libs
    const now = Date.now()
    let changed = false
    const next = libs.map((entry) => {
      const probe = probeAvailability(entry.path)
      if (!statusChanged(entry, probe)) return entry
      changed = true
      return { ...entry, status: probe, checkedAt: now }
    })
    if (changed) this.persistSync(sessionId, next)
    return next
  }

  /**
   * 为当前会话注册一个只读参考库：realpath 规范化并校验为存在的目录；
   * 同路径已注册时幂等返回现有条目。
   * @param session - 目标会话。
   * @param path - 目录路径（相对路径按宿主 cwd 解析）。
   * @param note - 可选用途说明（注入上下文时展示）；空/undefined 时尝试自动提取
   * README 首标题作为默认 note。
   * @returns 新增（或已存在）的条目。
   * @throws {RefLibPathError} 路径不存在或不是目录。
   * @throws {RefLibNoteError} note 含控制字符。
   */
  async add(session: Session, path: string, note?: string): Promise<RefLibEntry> {
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
    // note：显式提供优先；否则自动提取 README 标题（IO 失败/无标题则 undefined）。
    const noteValue = normalizeNote(note) ?? (await readReadmeTitle(canonical))
    const current = this.list(session)
    const existing = current.find((entry) => entry.path === canonical)
    if (existing !== undefined) {
      // 同路径再次 add 且带不同 note：更新用途说明（兼作改用途入口）。
      if (noteValue !== undefined && noteValue !== existing.note) {
        const next = current.map((entry) => (entry.id === existing.id ? { ...entry, note: noteValue } : entry))
        this.persistSync(session.id, next)
        this.cacheSet(session.id, next)
        return { ...existing, note: noteValue }
      }
      return existing
    }
    const entry: RefLibEntry = {
      id: randomUUID(),
      path: canonical,
      // add 已做 realpath + stat 校验，新条目直接标记可用并记录检测时间。
      status: 'available',
      checkedAt: Date.now(),
      ...(noteValue === undefined ? {} : { note: noteValue }),
    }
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

  /**
   * 更新已有条目的用途说明（note）；note 为空/undefined 时清除该字段。
   * 失效条目（status 非 available）**拒绝更新**——目录不可用时仅允许移除。
   * @param session - 目标会话。
   * @param id - 条目 id。
   * @param note - 新用途说明（可为空串清除）。
   * @returns 更新后的条目。
   * @throws {RefLibUnknownError} id 未注册。
   * @throws {RefLibUnavailableError} 条目目录不可用（仅允许移除）。
   * @throws {RefLibNoteError} note 含不允许的控制字符。
   */
  async setNote(session: Session, id: string, note?: string): Promise<RefLibEntry> {
    const current = this.list(session)
    const entry = current.find((item) => item.id === id)
    if (entry === undefined) throw new RefLibUnknownError(id)
    // list() 返回前已实时探测；失效条目只允许 remove。
    if (entry.status !== undefined && entry.status !== 'available') {
      throw new RefLibUnavailableError(entry.path)
    }
    const normalized = normalizeNote(note)
    const next = current.map((item) => {
      if (item.id !== id) return item
      // 空串/undefined：清除 note 字段（显式删除键，避免 spread 保留旧值）。
      if (normalized === undefined) {
        const rest = { ...item }
        delete rest.note
        return rest
      }
      return { ...item, note: normalized }
    })
    this.persistSync(session.id, next)
    this.cacheSet(session.id, next)
    return next.find((item) => item.id === id)!
  }

  /**
   * fork 继承物化（`session/created` 钩子调用）：子会话（header 带 parentSession）
   * 无自身 sidecar 时，把父会话的**有效列表**复制到子会话自身文件并**重新铸造条目
   * id**（fork 副本拥有独立身份，不与父会话共享条目 id）——继承时机从「首次读取」
   * 提前到「创建时刻」，并修复纯惰性继承的链式断口（中间会话未落盘时后代继承不
   * 到）。同步执行、绝不抛错（announce 契约：session/created 监听器抛错会回滚
   * 会话挂载）。
   * @param session - 新创建的会话。
   * @returns 物化后的子会话列表（未物化/无父会话时返回当前列表，含空列表）。
   */
  materializeInheritance(session: Session): readonly RefLibEntry[] {
    try {
      const parentId = session.header.parentSession
      if (parentId === undefined) return this.list(session)
      // 已有自身状态（如持久化恢复的会话、或已物化过）不覆盖。
      if (existsSync(this.pathOf(session.id))) return this.list(session)
      const parentLibs = this.resolveParentLibs(parentId)
      if (parentLibs.length === 0) return this.list(session) // 父无有效列表：保持惰性继承路径
      const owned = this.mintOwnedCopy(parentLibs)
      this.persistSync(session.id, owned)
      this.cacheSet(session.id, owned)
      return owned
    } catch (error) {
      this.ctx.logger.warn(`ref-lib: fork 继承物化失败（不阻断会话创建）：${String(error)}`)
      return this.list(session)
    }
  }

  /** 复制父列表并重新铸造条目 id：fork 副本拥有自己的身份（同 id 的「关联价值」是
   * 瞬时的——任一侧一变更即断裂，留不住；且避免未来跨会话功能/审计混淆）。 */
  private mintOwnedCopy(libs: readonly RefLibEntry[]): RefLibEntry[] {
    return libs.map((entry) => ({ ...entry, id: randomUUID() }))
  }

  /** 解析父会话的有效参考库列表：优先经 live 父会话（覆盖父为 legacy/惰性子会话的
   * 折叠路径），父会话不可得时兜底直接读其 sidecar 文件。 */
  private resolveParentLibs(parentId: string): readonly RefLibEntry[] {
    const sessions = this.ctx.get('sessions') as { get(sessionId: string): Session | undefined } | undefined
    const parent = sessions?.get(parentId)
    if (parent !== undefined) return this.list(parent)
    const file = this.pathOf(parentId)
    if (!existsSync(file)) return []
    return this.readSidecar(file) ?? []
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
    // fork 继承（legacy 子会话兜底）：复制父列表、重新铸造条目 id 并**落盘自身
    // sidecar**——与 session/created 物化（materializeInheritance）同一语义：fork
    // 副本拥有独立身份；落盘保证重启后 id 稳定（不落盘则每次冷读重新铸造导致漂移）。
    const parentId = session.header.parentSession
    if (parentId !== undefined) {
      const parentFile = this.pathOf(parentId)
      if (existsSync(parentFile)) {
        const inherited = this.readSidecar(parentFile)
        if (inherited !== undefined && inherited.length > 0) {
          const owned = this.mintOwnedCopy(inherited)
          this.persistSync(session.id, owned)
          return owned
        }
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
