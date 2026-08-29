/**
 * ref-lib 管理路由：`/api/ref-lib/*`。
 *
 * client（浏览器端）经**普通同源 fetch** 访问这些路由——这是插件在宿主
 * `ctx.webServer`（`@deepseek-ai/dsh-host-webserver`）上自注册的自定义 HTTP
 * 路由，静默双向、不渲染命令卡片（参照 dsh-ssh / dsh-persona-memory 先例）。
 * v4 起 client 读/写不再走 `/ref-lib` 命令分发。
 *
 * 安全：所有路由 loopback-only（同源 + 回环地址护栏，镜像 dsh-ssh 的
 * `isLoopbackRequest`）——这些端点会读改 sidecar 状态，LAN 暴露的部署不能开放。
 * @module @hpyperry/dsh-ref-lib/src/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { resolveRefLibPath } from './commands.ts'
import {
  RefLibDuplicateError,
  RefLibNoteError,
  RefLibPathError,
  RefLibUnavailableError,
  RefLibUnknownError,
  type RefLibService,
} from './service.ts'

/** 请求体大小上限（管理载荷都很小）。 */
export const MAX_JSON_BODY_BYTES = 64 * 1024

/** Loopback 校验：回环源地址 + 同源 Host/Origin（镜像 dsh-ssh 的护栏）。 */
export function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** 一条 JSON 响应。GET /list 的结果是会话状态，禁止任何缓存。 */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** 读取 JSON 请求体（过大或不可解析时返回 undefined）。
 * 注意**读满整个流**（排空请求体，keep-alive 连接才可复用），但只保留限额内的字节。 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size <= MAX_JSON_BODY_BYTES) chunks.push(buffer)
  }
  if (size > MAX_JSON_BODY_BYTES) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** makeRefLibRoutes 的依赖面（测试可注入假实现）。 */
export interface RefLibRouteDeps {
  /** per-session 参考库服务。 */
  refLibs: RefLibService
  /** 会话 id → 活会话；UI 面板总是指向当前会话（必为 live），非 live 返回 undefined。 */
  resolveSession: (sessionId: string) => Session | undefined
  /** 日志。 */
  log: (message: string) => void
}

/**
 * 构建 `/api/ref-lib/*` 路由族。
 * - `GET  /api/ref-lib/list?session=<id>` → `{ libs }`
 * - `POST /api/ref-lib/add    { session, path }` → `{ entry }`
 * - `POST /api/ref-lib/remove { session, id }` → `{ ok: true }`
 * - `POST /api/ref-lib/note   { session, id, note }` → `{ entry }`
 * - `GET  /api/ref-lib/sessions?session=<当前 id>` → `{ sessions: RefLibSourceSession[] }`
 *   （v12 跨会话导入来源清单；排除当前会话自身）
 * - `POST /api/ref-lib/import { session, plan: { additions, replacements } }` → `{ added, replaced }`
 *   （v12 跨会话导入：快照语义、重新铸造 id、冲突按用户决策替换 note）
 *
 * 注：fork 继承不在此路由族——`session/created` 钩子（service.materializeInheritance）
 * 在宿主创建子会话时直接写子会话 sidecar，UI 经现有 /list（dock 挂载 load）一次
 * 刷新即可读到（2026-08-23 简化，移除原 POST /api/ref-lib/inherit 兜底路由）。
 * @param deps - 依赖面。
 * @returns 待注册到 `ctx.webServer` 的路由数组。
 */
export function makeRefLibRoutes(deps: RefLibRouteDeps): WebRoute[] {
  const { refLibs, resolveSession, log } = deps

  /** 护栏 + 方法检查。 */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** 会话解析：不存在（非 live）时写出 404 并返回 undefined。 */
  const requireSession = (res: ServerResponse, sessionId: unknown): Session | undefined => {
    if (typeof sessionId !== 'string' || sessionId === '') {
      writeJson(res, 400, { error: 'missing session id' })
      return undefined
    }
    const session = resolveSession(sessionId)
    if (session === undefined) {
      writeJson(res, 404, { error: `session not live: ${sessionId}` })
      return undefined
    }
    return session
  }

  /** 业务错误的 wire 错误码（client 据此本地化展示，见 src/client/data.ts）。 */
  const PATH_ERROR_CODES = {
    missing: 'ref-lib/missing',
    'not-directory': 'ref-lib/not-directory',
    unsafe: 'ref-lib/unsafe',
  } as const

  /** 统一错误映射：路径/条目类业务错误 400（带 code 与 path/id 供本地化），其余 500。 */
  const writeError = (res: ServerResponse, error: unknown): void => {
    if (error instanceof RefLibPathError) {
      writeJson(res, 400, {
        error: error.message,
        code: PATH_ERROR_CODES[error.reason],
        path: error.path,
      })
      return
    }
    if (error instanceof RefLibUnknownError) {
      writeJson(res, 400, { error: error.message, code: 'ref-lib/unknown-id', id: error.id })
      return
    }
    if (error instanceof RefLibNoteError) {
      writeJson(res, 400, { error: error.message, code: 'ref-lib/note-unsafe' })
      return
    }
    if (error instanceof RefLibUnavailableError) {
      writeJson(res, 400, { error: error.message, code: 'ref-lib/unavailable', path: error.path })
      return
    }
    if (error instanceof RefLibDuplicateError) {
      // 同路径已注册且显式 note 不同：携带现有条目，client 据此弹「保留/覆盖」确认。
      writeJson(res, 400, { error: error.message, code: 'ref-lib/duplicate', entry: error.entry })
      return
    }
    log(`ref-lib route error: ${error instanceof Error ? error.message : String(error)}`)
    writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }

  return [
    {
      kind: 'exact',
      path: '/api/ref-lib/list',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const session = requireSession(res, url.searchParams.get('session'))
          if (session === undefined) return
          // v13：展示倒序（最近添加在前）；存储仍为添加正序（fork 继承确定性快照不受影响）。
          writeJson(res, 200, { libs: [...refLibs.list(session)].reverse() })
        } catch (error) {
          writeError(res, error)
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/ref-lib/add',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const session = requireSession(res, body.session)
          if (session === undefined) return
          if (typeof body.path !== 'string' || body.path.trim() === '') {
            writeJson(res, 400, { error: 'missing path' })
            return
          }
          const note = body.note
          if (note !== undefined && typeof note !== 'string') {
            writeJson(res, 400, { error: 'note must be a string' })
            return
          }
          const base = session.header.cwd ?? process.cwd()
          const entry = await refLibs.add(session, resolveRefLibPath(body.path, base), note)
          writeJson(res, 200, { entry })
        } catch (error) {
          writeError(res, error)
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/ref-lib/remove',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const session = requireSession(res, body.session)
          if (session === undefined) return
          if (typeof body.id !== 'string' || body.id === '') {
            writeJson(res, 400, { error: 'missing id' })
            return
          }
          await refLibs.remove(session, body.id)
          writeJson(res, 200, { ok: true })
        } catch (error) {
          writeError(res, error)
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/ref-lib/note',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const session = requireSession(res, body.session)
          if (session === undefined) return
          if (typeof body.id !== 'string' || body.id === '') {
            writeJson(res, 400, { error: 'missing id' })
            return
          }
          if (body.note !== undefined && typeof body.note !== 'string') {
            writeJson(res, 400, { error: 'note must be a string' })
            return
          }
          const entry = await refLibs.setNote(session, body.id, body.note)
          writeJson(res, 200, { entry })
        } catch (error) {
          writeError(res, error)
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/ref-lib/sessions',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const current = url.searchParams.get('session')
          if (typeof current !== 'string' || current === '') {
            writeJson(res, 400, { error: 'missing session id' })
            return
          }
          // 来源清单不需要当前会话 live——枚举的是 sidecar 文件；current 仅用于排除自身。
          // v16 懒加载三级：`groups=1` → 组概览（轻量，不读标题）；`group=<key>` → 单个
          // 工作区的会话（标题补全只对该组执行）；无参数 → 全量清单（兼容/命令模式）。
          const groups = url.searchParams.get('groups')
          const group = url.searchParams.get('group')
          if (groups === '1') {
            writeJson(res, 200, { groups: refLibs.listSessionGroups(current) })
            return
          }
          if (group !== null) {
            writeJson(res, 200, { sessions: await refLibs.listSessionsByGroup(current, group) })
            return
          }
          writeJson(res, 200, { sessions: await refLibs.listSessions(current) })
        } catch (error) {
          writeError(res, error)
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/ref-lib/source',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('session')
          if (typeof sessionId !== 'string' || sessionId === '') {
            writeJson(res, 400, { error: 'missing session id' })
            return
          }
          // 跨会话导入的**源**读取：只读 sidecar，**不要求会话 live**（历史会话的
          // 参考库同样可导入）。与 GET /list（当前 live 会话、实时探测）区分。
          writeJson(res, 200, { libs: [...refLibs.readSessionLibs(sessionId)].reverse() })
        } catch (error) {
          writeError(res, error)
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/ref-lib/import',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const session = requireSession(res, body.session)
          if (session === undefined) return
          const plan = body.plan
          if (typeof plan !== 'object' || plan === null) {
            writeJson(res, 400, { error: 'missing plan' })
            return
          }
          const { additions, replacements } = plan as { additions?: unknown; replacements?: unknown }
          if (!Array.isArray(additions) || !Array.isArray(replacements)) {
            writeJson(res, 400, { error: 'plan must have additions and replacements arrays' })
            return
          }
          for (const item of additions) {
            if (typeof item !== 'object' || item === null || typeof (item as { path?: unknown }).path !== 'string') {
              writeJson(res, 400, { error: 'addition items must have a string path' })
              return
            }
          }
          for (const item of replacements) {
            if (
              typeof item !== 'object' || item === null
              || typeof (item as { existingId?: unknown }).existingId !== 'string'
            ) {
              writeJson(res, 400, { error: 'replacement items must have an existingId' })
              return
            }
          }
          const result = await refLibs.importEntries(
            session,
            {
              additions: additions as { path: string; note?: string }[],
              replacements: replacements as { existingId: string; note?: string }[],
            },
          )
          writeJson(res, 200, result)
        } catch (error) {
          writeError(res, error)
        }
      },
    },
  ]
}
