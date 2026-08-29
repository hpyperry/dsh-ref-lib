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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
// 官方声明合并：加载 ctx.sessionQuery（SessionQueryEngine）与观测/记录类型。
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
// 官方声明合并：加载 ctx.workspaceRegistry（WorkspaceRegistry）——v14 归档过滤
// 读 `archivedSessionIds` 展示层归档集合（会话仍在 persistence，sidecar 枚举包含）。
import type {} from '@deepseek-ai/dsh-workspace'
import {
  attachSessionMeta,
  excludeArchivedSources,
  filterSourcesByGroupKey,
  foldRefLibs,
  probeLibs,
  removeLib,
  summarizeGroups,
  upsertLib,
  type ImportPlan,
  type RefLibGroupSummaryRow,
  type RefLibSourceSessionRow,
} from './logic.ts'
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

/** add 的路径已注册（同 realpath 路径）且显式 note 不同：不再静默覆盖，
 * 由调用方提示用户选择「保留现有 / 更新用途」（v12 修复历史静默覆盖行为）。 */
export class RefLibDuplicateError extends Error {
  /**
   * @param entry - 现有条目（调用方据此展示 diff 或确认覆盖）。
   */
  constructor(readonly entry: RefLibEntry) {
    super(`该目录已是参考库：${entry.path}`)
    this.name = 'RefLibDuplicateError'
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

/** encodeSegment 的逆：把 sidecar 文件名还原为会话 id（畸形序列按原样保留）。 */
function decodeSegment(encoded: string): string {
  let out = ''
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i]!
    if (ch !== '~') {
      out += ch
      continue
    }
    const hex = encoded.slice(i + 1, i + 5)
    if (hex.length !== 4 || !/^[0-9A-Fa-f]{4}$/.test(hex)) {
      out += ch
      continue
    }
    out += String.fromCharCode(Number.parseInt(hex, 16))
    i += 4
  }
  return out
}

/** re-export：源会话清单行（跨会话导入来源，含标题补全字段）。 */
export type RefLibSourceSession = RefLibSourceSessionRow

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
    const { next, changed } = probeLibs(libs, probeAvailability, Date.now())
    // 状态变化才写盘（v9：无变化零写盘）。
    if (changed) this.persistSync(sessionId, next)
    return next
  }

  /**
   * 为当前会话注册一个只读参考库：realpath 规范化并校验为存在的目录。
   * 同路径已注册时**幂等返回现有条目**，不覆盖；若用户**显式**提供了与该条目
   * 不同的 note，抛 {@link RefLibDuplicateError}（携带现有条目）——由调用方提示
   * 用户选择「保留现有 / 更新用途」，不再静默覆盖（v12 修复历史行为；改用途的
   * 显式入口是 `setNote` / 面板详情编辑）。
   * @param session - 目标会话。
   * @param path - 目录路径（相对路径按宿主 cwd 解析）。
   * @param note - 可选用途说明（注入上下文时展示）；空/undefined 时尝试自动提取
   * README 首标题作为默认 note。
   * @returns 新增（或已存在）的条目。
   * @throws {RefLibPathError} 路径不存在或不是目录。
   * @throws {RefLibNoteError} note 含控制字符。
   * @throws {RefLibDuplicateError} 同路径已注册且显式 note 与现有不同（需用户确认）。
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
    // 显式 note（用户提供）与自动 note（README 提取）分离：重复判定只看显式值。
    const explicitNote = normalizeNote(note)
    const current = this.list(session)
    const existing = current.find((entry) => entry.path === canonical)
    if (existing !== undefined) {
      // 幂等：无显式 note（或与现有相同）→ 返回现有条目，不覆盖（README 自动
      // 提取结果同样不覆盖现有 note——重复添加不应悄悄改变现有配置）。
      if (explicitNote === undefined || explicitNote === existing.note) return existing
      // 显式 note 与现有不同：不再静默覆盖，抛错由调用方提示用户确认。
      throw new RefLibDuplicateError(existing)
    }
    // 自动 note 仅在新增条目时提取（重复添加不重新提取，保持"添加即幂等"直觉）。
    const noteValue = explicitNote ?? (await readReadmeTitle(canonical))
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
   * 列出**配置过参考库**的其他会话（v12 跨会话导入的来源清单）。
   * 枚举本插件的 sidecar 目录（`<root>/*.json`）——不扫描全部会话，只列有参考库的；
   * 空列表会话不出现。会话标题经宿主 `ctx.sessionQuery.readTitleSnapshots` 补全
   * （与宿主 `@session` 引用同源：`session/title` 事件折叠，**冷会话同样可读**）；
   * 宿主无 sessionQuery 服务（非 web 组合）或读取失败时该会话无标题（UI 回退显示 id）。
   * v16 懒加载：UI 不再全量拉取本清单——先 `listSessionGroups`（轻量概览，不读标题），
   * 展开某个工作区时再 `listSessionsByGroup`（只对单个工作区的会话做标题补全）。
   * 本方法保留全量语义（命令模式 `/ref-lib import` 与兼容路径使用）。
   * @param excludeSessionId - 排除的会话 id（通常是当前会话——导入给自己无意义）。
   * @returns 按 sidecar 修改时间倒序（最近活跃在前）。
   */
  async listSessions(excludeSessionId?: string): Promise<RefLibSourceSession[]> {
    return this.attachTitles(this.enumerateSources(excludeSessionId))
  }

  /**
   * v16 懒加载第一级：工作区组概览（`groups=1`）。只做 sidecar 枚举 + 归档过滤 +
   * workspace 映射 + 组内计数聚合——**不读标题、不探测可用性**（展开某组时才做），
   * 会话数量级增长下保持轻量。组顺序 = 组内最近活跃会话降序（枚举按 mtime 倒序后
   * 首次出现顺序）。
   * @param excludeSessionId - 排除的会话 id（当前会话）。
   * @returns 组概览（key 回传给 {@link listSessionsByGroup} 做第二级加载）。
   */
  listSessionGroups(excludeSessionId?: string): RefLibGroupSummaryRow[] {
    return summarizeGroups(this.enumerateSources(excludeSessionId))
  }

  /**
   * v16 懒加载第二级：按组 wire 键取单个工作区的会话（`group=<key>`）。与
   * `listSessions` 同语义（含标题补全），但 `readTitleSnapshots` 只作用于该组的
   * 会话子集——展开时按需加载，避免全局冷读会话日志。
   * @param excludeSessionId - 排除的会话 id（当前会话）。
   * @param key - 组 wire 键（`listSessionGroups` 返回的 key）。
   * @returns 该组会话（按 mtime 倒序；无标题/读取失败时降级为无 title）。
   */
  async listSessionsByGroup(excludeSessionId: string | undefined, key: string): Promise<RefLibSourceSession[]> {
    return this.attachTitles(filterSourcesByGroupKey(this.enumerateSources(excludeSessionId), key))
  }

  /**
   * 枚举公共核心（v16 抽出，两级懒加载与全量共用）：读 sidecar 目录 → 过滤空列表 →
   * 实时探测 available → 按 mtime 倒序 → 排除归档会话 → 补全 workspace（注册工作区
   * display title）。**不含标题补全**（那是 `attachTitles` 的事，仅对需要的子集执行）。
   * @param excludeSessionId - 排除的会话 id。
   * @returns 排序、过滤、补全后的源会话清单（可能为空数组）。
   */
  private enumerateSources(excludeSessionId?: string): RefLibSourceSession[] {
    let sources: RefLibSourceSession[] = []
    let names: string[]
    try {
      names = readdirSync(this.root)
    } catch {
      return [] // root 尚未创建（没有任何会话配置过参考库）
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const sessionId = decodeSegment(name.slice(0, -'.json'.length))
      if (sessionId === excludeSessionId) continue
      const file = join(this.root, name)
      let mtime = 0
      try {
        mtime = statSync(file).mtimeMs
      } catch {
        continue
      }
      const libs = this.readSidecar(file)
      if (libs === undefined || libs.length === 0) continue
      // v12.1：available 计数用**实时探测**结果（未打开过的会话其 sidecar status 可能
      // 停留在旧值——目录已删除仍记 available）。探测不写盘（跨会话导入是只读参照）。
      const { next } = probeLibs(libs, probeAvailability, Date.now())
      sources.push({
        sessionId,
        count: libs.length,
        available: next.filter((entry) => entry.status === 'available').length,
        updatedAt: mtime,
      })
    }
    sources.sort((a, b) => b.updatedAt - a.updatedAt)
    // v14：排除宿主已归档会话（workspaceRegistry 的 archivedSessionIds 是展示层
    // 归档集合——会话仍在 live/persistence，sidecar 枚举会包含它们）。宿主无
    // workspaceRegistry（非 web 组合）或集合为空时原样保留，不阻断导入。
    sources = excludeArchivedSources(sources, this.ctx.get('workspaceRegistry')?.archivedSessionIds)
    if (sources.length === 0) return sources
    // v15：按注册工作区补全 workspace（display title）——经 workspaceRegistry.list()
    // 的 sessionIds 精确映射（与宿主工作区树同口径）。未归属工作区的会话不带该字段
    // （UI/命令归入「未分组」）；宿主无 workspaceRegistry（非 web 组合）时全部不带。
    const registry = this.ctx.get('workspaceRegistry')
    if (registry !== undefined) {
      const workspaceBySession = new Map<string, string>()
      for (const workspace of registry.list()) {
        for (const sessionId of workspace.sessionIds) workspaceBySession.set(String(sessionId), workspace.title)
      }
      sources = sources.map((source) => {
        const workspace = workspaceBySession.get(source.sessionId)
        return workspace === undefined ? source : { ...source, workspace }
      })
    }
    return sources
  }

  /**
   * 标题/工作区补全（v13.1）：cwd 多源兜底——
   * 1) live 会话直接读 header.cwd（sessions.get，不依赖 sessionQuery 观测时序）；
   * 2) sessionQuery.listSessions 的全量记录 header（persistence corpus）；
   * 3) readTitleSnapshots 观测的 value.session（与 title 同源）。
   * v16：只对传入子集（整组）执行——懒加载下 `readTitleSnapshots` 不随会话总量增长。
   * @param sources - 已枚举（含 workspace 补全）的源会话清单。
   * @returns 补全标题/工作区后的清单（顺序与入参一致；宿主服务异常时降级原样返回）。
   */
  private async attachTitles(sources: RefLibSourceSession[]): Promise<RefLibSourceSession[]> {
    if (sources.length === 0) return sources
    try {
      // 官方类型：ctx.sessionQuery（SessionQueryEngine，dsh-session-query 声明合并）
      // 与 ctx.sessions（SessionStore，dsh-session 声明合并）——不再用本地结构断言。
      const query = this.ctx.get('sessionQuery')
      const live = this.ctx.get('sessions')
      if (query === undefined && live === undefined) return sources
      const [records, observations] = await Promise.all([
        query === undefined ? Promise.resolve([]) : query.listSessions(),
        query === undefined
          ? Promise.resolve([] as readonly SessionTitleObservationResult[])
          : query.readTitleSnapshots(sources.map((source) => SessionId(source.sessionId))),
      ])
      const cwdBySession = new Map<string, string | undefined>()
      for (const record of records) cwdBySession.set(record.header.id, record.header.cwd)
      return attachSessionMeta(sources, observations).map((source) => {
        // cwd 兜底：live header → sessionQuery 记录 → 观测（attachSessionMeta 已填）。
        if (source.cwd !== undefined && source.cwd !== '') return source
        const liveCwd = live?.get(SessionId(source.sessionId))?.header.cwd
        const recordCwd = cwdBySession.get(source.sessionId)
        const cwd = liveCwd ?? recordCwd
        return cwd === undefined || cwd === '' ? source : { ...source, cwd }
      })
    } catch (error) {
      // 标题/工作区是展示性信息：宿主服务异常时降级（UI 回退显示"新会话"或 id），不阻断导入。
      this.ctx.logger.warn(`ref-lib: 会话标题读取失败（降级显示会话 id）：${String(error)}`)
      return sources
    }
  }

  /**
   * 只读读取某会话 sidecar 中的参考库条目（v12 跨会话导入的**源**读取）。
   * 与 `list()` 不同：**不要求会话 live、不实时探测、不写盘**——源条目只作展示与
   * 导入参照，导入到目标会话时才会重新校验/探测（importEntries）。历史会话
   * （重启后未挂载）的参考库同样可导入。
   * @param sessionId - 源会话 id。
   * @returns 条目列表；无 sidecar 或文件畸形时返回空列表（与 listSessions 的
   * 枚举口径一致——只列有参考库的会话）。
   */
  readSessionLibs(sessionId: string): readonly RefLibEntry[] {
    const file = this.pathOf(sessionId)
    if (!existsSync(file)) return []
    const libs = this.readSidecar(file)
    if (libs === undefined || libs.length === 0) return []
    // v12.1：源读取**实时探测**（未打开过的会话其 status 可能停留在旧值）——
    // 探测结果用于 UI 展示（失效徽标）与导入前置判断，**不写回源 sidecar**
    // （跨会话导入是只读参照，不污染源数据；导入到目标时仍会重新校验）。
    return probeLibs(libs, probeAvailability, Date.now()).next
  }

  /**
   * 跨会话导入（v12）：把源会话的条目按用户决策写入当前会话。**快照语义、不回流**
   * ——与 v10 fork 继承一致：新增条目**重新铸造 id**（副本独立身份）、note 保持源值
   * （不重新提取 README）、冲突条目按「使用导入的」决策以导入侧 note 替换现有条目
   * （保留现有 id，路径相同无需变更）。一次计算 + 一次原子写盘。
   * @param session - 目标会话。
   * @param plan - 导入规划（client 经 `planImport` 产生：additions 新增 / replacements 替换）。
   * @returns 新增与替换后的条目（调用方用于刷新 UI）。
   * @throws {RefLibPathError} 新增条目路径当前不可用（源会话配置后目录已删除/变更）。
   * @throws {RefLibNoteError} note 含不允许的控制字符。
   */
  async importEntries(session: Session, plan: ImportPlan): Promise<{ added: RefLibEntry[]; replaced: RefLibEntry[] }> {
    const current = this.list(session)
    const added: RefLibEntry[] = []
    const replaced: RefLibEntry[] = []
    let next = current
    for (const item of plan.additions) {
      // 快照语义：路径仍须可用（当前环境校验），note 保持源值、不自动提取 README。
      const canonical = await realpath(item.path).catch(() => {
        throw new RefLibPathError(item.path, 'missing')
      })
      if (hasControlCharacters(canonical)) throw new RefLibPathError(canonical, 'unsafe')
      const info = await stat(canonical).catch(() => {
        throw new RefLibPathError(item.path, 'missing')
      })
      if (!info.isDirectory()) throw new RefLibPathError(item.path, 'not-directory')
      const noteValue = normalizeNote(item.note)
      // 防呆：与现有条目重复的 add 请求直接跳过（client 已分类，这里兜底幂等）。
      if (next.some((entry) => entry.path === canonical)) continue
      const entry: RefLibEntry = {
        id: randomUUID(),
        path: canonical,
        status: 'available',
        checkedAt: Date.now(),
        ...(noteValue === undefined ? {} : { note: noteValue }),
      }
      next = upsertLib(next, entry)
      added.push(entry)
      continue
    }
    for (const item of plan.replacements) {
      // replace：路径已存在，仅采纳导入侧 note（undefined 清除现有 note）。
      const existing = next.find((entry) => entry.id === item.existingId)
      if (existing === undefined) throw new RefLibUnknownError(item.existingId)
      const noteValue = normalizeNote(item.note)
      const updated = { ...existing, ...(noteValue === undefined ? {} : { note: noteValue }) }
      if (noteValue === undefined) delete (updated as { note?: string }).note
      next = next.map((entry) => (entry.id === existing.id ? updated : entry))
      replaced.push(updated)
    }
    if (added.length > 0 || replaced.length > 0) {
      this.persistSync(session.id, next)
      this.cacheSet(session.id, next)
    }
    return { added, replaced }
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
    // 官方类型（dsh-session 声明合并 ctx.sessions: SessionStore）——不再用本地 as 断言。
    const parent = this.ctx.get('sessions')?.get(SessionId(parentId))
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
