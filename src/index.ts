/**
 * ref-lib 插件入口（规范形态：default export Service 类）。
 *
 * 参考库为 **per-session** 数据：v3（2026-08-17 事故修复）起列表存于 dsh home
 * 下的 sidecar JSON（`<dshHome>/plugin-data/ref-lib/<sessionId>.json`），会话间
 * 完全隔离，**不再向会话日志写入自定义事件**（原因见 `service.ts` 头部说明）。
 * v4 起 client 读/写走插件自注册的 `/api/ref-lib/*` HTTP 路由（`ctx.webServer`，
 * 静默、无命令卡片）。
 *
 * - `ctx.refLibs` 服务：per-session 参考库校验与持久化（list / add / remove）；
 * - `/ref-lib` 命令（`ctx.commands`）：操作**当前会话**的参考库；
 * - `/api/ref-lib/*` 路由（`ctx.webServer` + `ctx.sessions`）：client UI 静默读/写；
 * - `reference-libs:policy` 上下文贡献（`ctx.systemPrompt.context`）：仅向配置了
 *   参考库的会话注入其库清单与只读约束（命名遵循 harness 的 `域:类型` 惯例，
 *   与 `sandbox:policy` / `approval:policy` 同类）。
 *
 * 只读保证分层：
 * - L1 沙箱天然只读：库位于 session workspace 之外时，read-only /
 *   workspace-write 模式下 bash/fs 均进程级只读（推荐用法）；
 * - L2 本插件注入的上下文软约束。
 * @module @hpyperry/dsh-ref-lib
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
// Side-effect type imports：加载 dsh-commands / dsh-system-prompt / dsh-session
// / dsh-host-webserver 对 `@deepseek-ai/cordis` Context 的声明合并与类型。
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { parseRefLibCommand, REF_LIB_USAGE, resolveRefLibPath } from './commands.ts'
import { renderLibList, renderRefLibs } from './render.ts'
import { makeRefLibRoutes } from './routes.ts'
import { RefLibService, type RefLibServiceConfig } from './service.ts'

/**
 * ref-lib 插件本体：注册服务、命令与上下文贡献。
 * 数据全部按当前会话（`invocation.agent.session` / `context.agent?.session`）操作。
 */
export class RefLibPlugin extends Service {
  /**
   * @param ctx - 宿主上下文。
   * @param config - 可选存储根目录覆盖（测试用）。
   */
  constructor(ctx: Context, config: RefLibServiceConfig = {}) {
    super(ctx, 'refLibPlugin')
    const refLibs = new RefLibService(ctx, config)

    // v4：client UI 静默读/写通道 —— 在宿主 webServer 上注册 /api/ref-lib/* 路由。
    // 仅 web 组合存在 webServer/sessions 时生效（inject 等待，缺服务则不注册）。
    ctx.inject(['webServer', 'sessions'], (routeCtx) => {
      const routes = makeRefLibRoutes({
        refLibs,
        resolveSession: (sessionId) => routeCtx.sessions.get(SessionId(sessionId)),
        log: (message) => ctx.logger.info(message),
      })
      for (const route of routes) routeCtx.webServer.register(route)
    })

    ctx.inject(['commands'], (commandsCtx) => {
      commandsCtx.commands.register({
        name: 'ref-lib',
        description: '管理本会话的只读参考库（add <path> [--note <用途>] / list / remove <id>）',
        input: { hint: 'add <path> [--note <用途>] | list | remove <id>' },
        handler: async (invocation) => {
          const parsed = parseRefLibCommand(invocation.rawInput)
          if (parsed.kind === 'error') return { kind: 'error', text: parsed.text }
          try {
            const session = invocation.agent.session
            if (parsed.kind === 'list') {
              return { kind: 'success', text: renderLibList(refLibs.list(session)) }
            }
            if (parsed.kind === 'add') {
              // 相对路径基于当前会话工作区解析（`~` 亦展开）。
              const base = session.header.cwd ?? process.cwd()
              const entry = await refLibs.add(session, resolveRefLibPath(parsed.path, base), parsed.note)
              const note = entry.note === undefined ? '' : `（${entry.note}）`
              return { kind: 'success', text: `已添加只读参考库：${entry.path}${note}` }
            }
            await refLibs.remove(session, parsed.id)
            return { kind: 'success', text: `已移除参考库条目：${parsed.id}` }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { kind: 'error', text: `${message}${REF_LIB_USAGE}` }
          }
        },
      })
    })

    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.context({
        name: 'reference-libs:policy',
        order: 150,
        text: (context) => {
          const session = context.agent?.session
          return session === undefined ? '' : renderRefLibs(refLibs.list(session))
        },
      })
    })
  }
}

export default RefLibPlugin
