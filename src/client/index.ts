/**
 * ref-lib client 插件（浏览器端）：在输入框上方（conversation.input.dock）
 * 注册「参考库」入口，提供 per-session 的 UI 交互式管理。
 *
 * 入口位置（v7）：注册在输入框上方（conversation.input.dock）槽位，胶囊渲染在
 * 输入卡正上方的独立一行，经 CSS 令牌与输入卡左缘对齐——hero（新会话）与 active
 * （具体对话）统一可见、零测量、零竞态，新建会话一开始即可注入参考库。
 *
 * 数据通道（v4/v5）：client 经**普通同源 fetch** 访问插件在宿主 `ctx.webServer`
 * 上自注册的 /api/ref-lib/* HTTP 路由（node 端读写 sidecar）——静默双向、
 * 不渲染命令卡片、不执行命令、不产生用户消息。路由 loopback-only 护栏见
 * `src/routes.ts`。目录选择走 `ctx.workspaces.pickDirectory()`（host 原生 OS
 * 选择器），另提供路径输入直加（优化点 2：绕开卡顿的原生对话框）。
 * 文案经 `ctx.locale` 全量本地化（zh/en，优化点 2）。
 * @module @hpyperry/dsh-ref-lib/src/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Side-effect type imports：加载 slot 声明合并（conversation.input.dock 由
// ui-conversation 声明）与 locale 服务的类型。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { RefLibEntry } from '../spec.ts'
import { parseApiErrorPayload, parseLibsPayload, RefLibApiError } from './data.ts'
import { RefLibDock, type RefLibDockInjected } from './RefLibDock.tsx'
import { zh, en, type RefLibKey } from './locales.ts'

/** 所需服务（cordis fiber inject）。 */
export const inject = ['slots', 'workspaces', 'locale']

/** 本插件文案命名空间。 */
const NS = 'ref-lib'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** ref-lib 面板/入口文案。 */
    'ref-lib': RefLibKey
  }
}

/**
 * 一条对宿主 /api/ref-lib 路由族的 JSON 调用；失败时优先抛出带 wire code 的
 * RefLibApiError（用于本地化），无 code 时回退普通 Error。
 */
async function api<T>(path: string, payload?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(
    '/api/ref-lib' + path,
    payload === undefined
      ? undefined
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
  )
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const parsed = parseApiErrorPayload(body)
    if (parsed !== null) throw new RefLibApiError(parsed.code, parsed.message, parsed.details)
    const message = (body as { error?: unknown } | null)?.error ?? 'HTTP ' + res.status
    throw new Error(typeof message === 'string' ? message : String(message))
  }
  return body as T
}

/**
 * 注册输入框上方的「参考库」入口与管理面板。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  // 注册本插件文案命名空间（zh/en 逐键对齐，编译期校验）。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ref-lib: dictionaries')

  const injected = (): RefLibDockInjected => ({
    load: async (sessionId: SessionId): Promise<RefLibEntry[]> =>
      parseLibsPayload(
        await api<{ libs?: unknown }>(`/list?session=${encodeURIComponent(sessionId)}`, undefined, 'GET'),
      ),
    add: async (sessionId: SessionId, path: string): Promise<void> => {
      await api('/add', { session: sessionId, path })
    },
    remove: async (sessionId: SessionId, id: string): Promise<void> => {
      await api('/remove', { session: sessionId, id })
    },
    pickDirectory: () => ctx.workspaces.pickDirectory(),
    listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
  })

  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'ref-lib',
        // 排在最后面（goal 10 / queue 20 / git-graph 100 等之后）：不与其他插件
        // 的 dock 入口抢位置；独立一行流式堆叠，天然不重叠。
        order: 200,
        locale: NS,
        inject: injected,
      },
      RefLibDock,
    ),
  )
}
