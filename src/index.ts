/**
 * ref-lib 插件入口（规范形态：default export Service 类）。
 *
 * 参考库为 **per-session** 数据：v3（2026-08-17 事故修复）起列表存于 dsh home
 * 下的 sidecar JSON（`<dshHome>/plugin-data/ref-lib/<sessionId>.json`），会话间
 * 完全隔离，**不再向会话日志写入自定义事件**（原因见 `service.ts` 头部说明）。
 * v4 起 client 读/写走插件自注册的 `/api/ref-lib/*` HTTP 路由（`ctx.webServer`，
 * 静默、无命令卡片）。
 *
 * v15（能力形态，见 `docs/v15-tool-migration-design-notes.md`）——**提醒式 + 自主
 * 检索**（2026-08-24 实测收敛：移除覆盖检查与逃逸预算，观察裸效果）：
 * - **reference_lookup 工具**（`ctx.tools`）：按需定位库内内容（库 id + query →
 *   命中行片段），路径围栏天然成立；**不诱导必查**——模型可自主选择用工具、
 *   直接读文件或自己 grep；
 * - **注入 = 强化提醒**：挂载即识别（有可用库即注入库清单+根路径+规范使用提醒，
 *   每轮加载对抗上下文遗忘；未挂载零注入）；
 * - **子 agent 种子告知**（`agent/created` inject 指引）+ 极简 preset 工具 deny。
 *
 * 只读保证分层：
 * - L1 沙箱天然只读：库位于 session workspace 之外时，read-only /
 *   workspace-write 模式下 bash/fs 均进程级只读（推荐用法）；
 * - L2 本插件注入的上下文软约束 + reference_lookup 工具本身只读。
 * @module @hpyperry/dsh-ref-lib
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Side-effect type imports：加载 dsh-commands / dsh-system-prompt / dsh-session
// / dsh-host-webserver / dsh-tools / dsh-agent / dsh-agent-presets 对
// `@deepseek-ai/cordis` Context 的声明合并与类型。
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { parseRefLibCommand, REF_LIB_USAGE, resolveRefLibPath, resolveSourceSessions } from './commands.ts'
import { filterAvailable, planImport } from './logic.ts'
import { renderImportSessions, renderImportSource, renderLibList, renderRefLibsV15 } from './render.ts'
import { makeRefLibRoutes } from './routes.ts'
import { RefLibDuplicateError, RefLibService, type RefLibServiceConfig } from './service.ts'
import { registerReferenceLookup } from './tool.ts'

/** ref-lib 插件配置（v15：存储根即可，无覆盖检查/逃逸配置——已移除）。 */
export type RefLibPluginConfig = RefLibServiceConfig

/** 子 agent 种子告知文本（inherit-lite：一行政策 + 清单引用；首轮前注入）。 */
const SUBAGENT_SEED_TEXT =
  'This session inherits registered read-only reference libraries from its parent session. They are ' +
  'local, strictly read-only, and authoritative for project facts. When this task needs project details ' +
  '(signatures, code locations, standards), you may use the reference_lookup tool or read the library ' +
  'files directly. Reference libraries are strictly read-only.'

/**
 * ref-lib 插件本体：注册服务、命令、上下文贡献与检索工具。
 * 数据全部按当前会话（`invocation.agent.session` / `context.agent?.session`）操作。
 */
export class RefLibPlugin extends Service {
  /**
   * @param ctx - 宿主上下文。
   * @param config - 配置（存储根）。
   */
  constructor(ctx: Context, config: RefLibPluginConfig = {}) {
    super(ctx, 'refLibPlugin')
    const refLibs = new RefLibService(ctx, config)

    // ---- v15：reference_lookup 工具注册（纯检索，无预算/记账——逃逸与覆盖检查已移除）----
    ctx.inject(['tools'], (toolsCtx) => {
      registerReferenceLookup(toolsCtx, {
        libs: {
          list: (session) => refLibs.list(session),
        },
      })
    })

    // ---- v15：systemPrompt 上下文（挂载即识别：有可用库即注入库清单+路径+规范
    // 提醒，每轮加载强化记忆；未挂载零注入）----
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.context({
        name: 'reference-libs:policy',
        order: 150,
        text: (context) => {
          const session = context.agent?.session
          if (session === undefined) return ''
          const available = filterAvailable(refLibs.list(session))
          if (available.length === 0) return '' // 无可用挂载库：零注入
          return renderRefLibsV15(available)
        },
      })
    })

    // ---- v15：agent/created（子 agent 种子告知 + 极简 preset 工具 deny）----
    ctx.on(
      'agent/created',
      (payload) => {
        try {
          const agent = payload.agent
          // 极简 preset：reference_lookup 对极简 agent 默认可见（全局注册语义），显式 deny。
          const preset = agent.ctx.get('agentPresets')?.composedPreset(agent.ctx)
          if (preset === 'minimal') {
            agent.ctx.tools.restrict({ deny: ['reference_lookup'] })
          }
          // 子 agent：inherit-lite 种子告知（首轮前注入）。
          if (agent.session.header.origin === 'subagent') {
            agent.inject(
              createUserMessage({
                content: [{ type: 'text', text: SUBAGENT_SEED_TEXT }],
                source: { kind: 'plugin', plugin: 'ref-lib' },
              }),
            )
          }
        } catch (error) {
          // announce 契约：监听器抛错会回滚 agent 发布——绝不外抛。
          ctx.logger.warn(`ref-lib: agent/created 处理失败（不阻断）：${String(error)}`)
        }
      },
      { global: true },
    )

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
        description: '管理本会话的只读参考库（add <path> [--note <用途>] / list / remove <id> / import <会话> [路径...]）',
        input: { hint: 'add <path> [--note <用途>] | list | remove <id> | import <会话> [路径...]' },
        handler: async (invocation) => {
          const parsed = parseRefLibCommand(invocation.rawInput)
          if (parsed.kind === 'error') return { kind: 'error', text: parsed.text }
          try {
            const session = invocation.agent.session
            if (parsed.kind === 'list') {
              return { kind: 'success', text: renderLibList([...refLibs.list(session)].reverse()) }
            }
            if (parsed.kind === 'add') {
              // 相对路径基于当前会话工作区解析（`~` 亦展开）。
              const base = session.header.cwd ?? process.cwd()
              const entry = await refLibs.add(session, resolveRefLibPath(parsed.path, base), parsed.note)
              const note = entry.note === undefined ? '' : `（${entry.note}）`
              return { kind: 'success', text: `已添加只读参考库：${entry.path}${note}` }
            }
            if (parsed.kind === 'import') {
              // 无会话参数：列出所有有参考库的会话（id + 标题 + 条目数），让 id 可发现。
              const sources = await refLibs.listSessions(session.id)
              if (parsed.source === '') {
                return { kind: 'success', text: renderImportSessions(sources) }
              }
              // 会话解析：id 精确优先，否则标题模糊；多匹配时列候选让用户挑。
              const matched = resolveSourceSessions(sources, parsed.source)
              if (matched.length === 0) {
                return {
                  kind: 'error',
                  text: `未找到会话 "${parsed.source}"（可用 /ref-lib import 查看有参考库的会话清单）。${REF_LIB_USAGE}`,
                }
              }
              if (matched.length > 1) {
                return { kind: 'success', text: renderImportSessions(matched) }
              }
              const sourceId = matched[0]!.sessionId
              const mine = refLibs.list(session)
              const sourceLibs = refLibs.readSessionLibs(sourceId)
              if (sourceLibs.length === 0) {
                return { kind: 'error', text: `源会话没有参考库：${sourceId}` }
              }
              // 无路径参数：列出源会话条目清单（供挑选后按路径导入）。
              if (parsed.paths.length === 0) {
                return { kind: 'success', text: renderImportSource(sourceId, sourceLibs) }
              }
              const requested = sourceLibs.filter((entry) => parsed.paths.includes(entry.path))
              if (requested.length === 0) {
                return {
                  kind: 'error',
                  text: `源会话中未找到匹配的路径（可用 /ref-lib import ${sourceId} 查看清单）。${REF_LIB_USAGE}`,
                }
              }
              // 命令无法交互决策：冲突条目（当前会话同路径）一律保留现有、跳过。
              const plan = planImport(mine, requested, () => 'mine')
              const { added } = await refLibs.importEntries(session, plan)
              const skipped = requested.length - added.length
              return {
                kind: 'success',
                text: `已导入 ${added.length} 个参考库${skipped > 0 ? `（跳过 ${skipped} 个与当前会话重复的条目，覆盖请用参考库面板）` : ''}`,
              }
            }
            await refLibs.remove(session, parsed.id)
            return { kind: 'success', text: `已移除参考库条目：${parsed.id}` }
          } catch (error) {
            if (error instanceof RefLibDuplicateError) {
              return {
                kind: 'error',
                text: `该目录已是参考库：${error.entry.path}（如需更新用途说明，请在参考库面板中编辑详情）`,
              }
            }
            const message = error instanceof Error ? error.message : String(error)
            return { kind: 'error', text: `${message}${REF_LIB_USAGE}` }
          }
        },
      })
    })
  }
}

export default RefLibPlugin
