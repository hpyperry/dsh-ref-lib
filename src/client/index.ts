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
 * `src/routes.ts`。目录选择走 `ctx.uiWorkspace.pickDirectory()`（host 原生 OS
 * 选择器，v17：0.1.2 起 `ctx.workspaces` 迁至 `ctx.uiWorkspace`），另提供路径
 * 输入直加（优化点 2：绕开卡顿的原生对话框）。
 * 文案经 `ctx.locale` 全量本地化（zh/en，优化点 2）。
 * @module @hpyperry/dsh-ref-lib/src/client
 */

import { type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Side-effect type imports：加载 slot 声明合并（conversation.input.dock 由
// ui-conversation 声明；commandview 槽位与 useChat 声明自 0.1.2 起在 ui-chat；
// ctx.uiWorkspace 在 ui-workspace）与 locale 服务的类型。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { RefLibEntry } from '../spec.ts'
import type { ImportPlan } from '../logic.ts'
import { parseApiErrorPayload, parseGroupsPayload, parseLibsPayload, parseSessionsPayload, RefLibApiError, type RefLibImportGroup, type RefLibSourceSession } from './data.ts'
import { RefLibCommandCard } from './RefLibCommandCard.tsx'
import { RefLibDock, type RefLibDockInjected } from './RefLibDock.tsx'
import { zh, en, type RefLibKey } from './locales.ts'

/** 所需服务（cordis fiber inject）。v17：`workspaces` → `uiWorkspace`（0.1.2 迁移）。 */
export const inject = ['slots', 'uiWorkspace', 'locale']

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
export function apply(ctx: Context): void {
  // 注册本插件文案命名空间（zh/en 逐键对齐，编译期校验）。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ref-lib: dictionaries')

  const injected = (): RefLibDockInjected => ({
    load: async (sessionId: SessionId): Promise<RefLibEntry[]> =>
      parseLibsPayload(
        await api<{ libs?: unknown }>(`/list?session=${encodeURIComponent(sessionId)}`, undefined, 'GET'),
      ),
    add: async (sessionId: SessionId, path: string, note?: string): Promise<void> => {
      await api('/add', { session: sessionId, path, ...(note === undefined ? {} : { note }) })
    },
    remove: async (sessionId: SessionId, id: string): Promise<void> => {
      await api('/remove', { session: sessionId, id })
    },
    setNote: async (sessionId: SessionId, id: string, note: string): Promise<void> => {
      await api('/note', { session: sessionId, id, note })
    },
    // v16 懒加载第一级：工作区组概览（轻量，不读标题）。
    listGroups: async (sessionId: SessionId): Promise<RefLibImportGroup[]> =>
      parseGroupsPayload(
        await api<{ groups?: unknown }>(`/sessions?session=${encodeURIComponent(sessionId)}&groups=1`, undefined, 'GET'),
      ),
    // v16 懒加载第二级：单个工作区的会话（标题补全只对该组执行）。
    loadGroupSessions: async (sessionId: SessionId, groupKey: string): Promise<RefLibSourceSession[]> =>
      parseSessionsPayload(
        await api<{ sessions?: unknown }>(
          `/sessions?session=${encodeURIComponent(sessionId)}&group=${encodeURIComponent(groupKey)}`,
          undefined,
          'GET',
        ),
      ),
    // 源条目走只读 /source 路由：不要求源会话 live（历史会话同样可导入）。
    loadEntries: async (sessionId: SessionId): Promise<RefLibEntry[]> =>
      parseLibsPayload(
        await api<{ libs?: unknown }>(`/source?session=${encodeURIComponent(sessionId)}`, undefined, 'GET'),
      ),
    importEntries: async (sessionId: SessionId, plan: ImportPlan): Promise<void> => {
      await api('/import', { session: sessionId, plan })
    },
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
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

  // /ref-lib 命令结果专属卡片：官方 GenericCommandCard 长结果显示不全（折叠单行
  // ellipsis / 展开 260px 内滚动），本卡片默认全展开完整结果 + 复制按钮。
  ctx.slots.inject('conversation.chat.commandview', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.commandview',
        key: 'ref-lib',
        locale: NS,
      },
      RefLibCommandCard,
    ),
  )
}
