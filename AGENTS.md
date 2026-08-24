# AGENTS.md — ref-lib（@hpyperry/dsh-ref-lib）

本文件是 `ref-lib/` 插件项目的**核心开发约定**，任何 agent（含本 session 及后续 session）
在动手前必须先读并遵守。`ref-lib/` 是**独立 git 仓库**；外层 `dsh-plugins/` 仅作容器目录，
不是 git 仓库。

## 1. 项目定位

- **`@hpyperry/dsh-ref-lib`**：只读参考库插件（node half + client UI，per-session 隔离）。
- **自包含工程**：`package.json` / `tsconfig.json` / `src/` / `tests/` / `scripts/` /
  构建配置与 `README.md` 齐全，可独立安装/构建/验证（安装见 `README.md`「📦 安装」、
  构建/验证见「🧑‍💻 开发」）。
- 版本沿革：v3（sidecar 存储，2026-08-17 事故修复）→ v4（`ctx.webServer` 路由通道）→
  v5（UI 重构：dock 入口/设计令牌面板/zh-en 本地化）→ v6（目录选择能力自适应）→
  v7（**dock 行内胶囊、零测量**：取消 hero 相位测量/绝对定位，纯 CSS 与输入卡左缘
  对齐，根除与模式按钮的重叠竞态）→ v8（**用途说明 note + 定稿英文注入模板**：
  add 支持 `--note`/UI 输入框/自动 README 首标题兜底；注入升级为 MUST/ALWAYS 强制
  查证流程、note 作 routing metadata、权威性/冲突处理/外部来源自报条款）→
   v9（**参考库可用性状态**：sidecar v3 条目带 `status`/`checkedAt`；每次读取（含每次
   模型请求的注入回调）实时 `statSync` 探测、仅状态变化写盘；失效库（missing /
   not-directory）不注入并红色提示（面板状态行 + dock 失效角标 + `/ref-lib list`
   `[已失效]` 标记）；失效条目仅允许移除（UI 禁用详情 + node note 接口 400
   `ref-lib/unavailable`）；胶囊徽标显可用数、红色角标显失效数；**`/ref-lib` 命令
   结果专属卡片**（`conversation.chat.commandview` keyed 槽位：默认全展开完整结果 +
   复制按钮，规避官方卡片折叠单行 ellipsis / 展开 260px 截断）；**UI 同步交互驱动**
   （`/ref-lib` 命令完成 / 发消息 / 面板操作即时刷新——经 dock owner 响应式会话快照
   钩子 `refLibCommandDone` / `userMessageCount`，无后台轮询；外部文件变化在下次
   GUI 交互时同步，注入侧不受影响）；**竞态守卫 `RefreshGuard`**（`src/client/
   refresh-guard.ts`：只接受最后发起的请求结果，`tests/refresh-guard.spec.ts` 钉死
   并发/乱序/作废行为）；刷新触发派生提取为纯函数 `refresh-triggers.ts`（单次遍历
   同时派生两个计数，`tests/refresh-triggers.spec.ts` 钉死信号契约，rc.7 前提查证
   见设计文档 §16）→
   v10（**fork 分支会话参考库继承物化**：dsh「分支会话」在宿主创建新会话（新 id +
   `header.parentSession`）；`session/created` 钩子（`{ global: true }`，与
   core/tools seed 钩子同款）在 fork 时把父会话有效列表复制到子会话自身 sidecar
   ——**条目 id 重新铸造**（副本独立身份）、继承时机提前到 fork 时刻（确定性快照）、
   修复纯惰性继承的链式断口（每级落盘）；UI 无新通道（dock 挂载现有 load() 一次
   刷新即读到，不新增 webServer 接口）；legacy 子会话惰性兜底同语义（重新铸造
   id + 落盘，重启后 id 稳定）；设计文档 §17）→
   v11（**依赖基线升级 dsh 0.1.0-rc.7 → 0.1.1-rc.2**：v9 预留的"等新版本稳定后升级"
   决策落地——peerDeps 11 包与 devDeps 4 包全部对齐 `^0.1.1-rc.2`（官方 npm 发布
   惯例，peer 范围与宿主版本族同元组）；API 兼容性已逐项核对（ref-lib 所用接口
   rc.7→rc.2 无破坏：唯一 breaking 是 `CommandRuntime.execute()` 新增必填 `images`
   参数，ref-lib 不直接调用；`commands.register` / `systemPrompt.context` /
   `webServer.register` / `session/created` / 两个槽位契约均未变）；客户端平台模块
   （`dsh-client-ui-primitives` / `dsh-client-ui-slots` / `cordis` / `react`）在
   rc.2 宿主由 **Vite shell seed 表**内联提供（非模块表 entry），ref-lib bundle
   external 的 require 命中 seed，运行时吃 rc.2 实现；node half 依赖基线同步后
   双版本消除（link 开发形态下此前解析到自身 rc.7 副本）；四道门禁全过（typecheck /
   lint / 147 测试含 L2 harness-roundtrip / build），`scripts/dev-isolate.sh` 以
   `~/.dsh-dev` + 3090 端口验证插件加载与 `/api/ref-lib/*` 路由）→
   v12（**跨会话导入（手动挑选）**：与 v10 fork 自动继承互补——从其他会话挑选
   参考库条目导入当前会话。三步状态机（选会话 → 勾条目 → 冲突项处理）：来源
   会话经 `sessionQuery` 枚举（只列有参考库的，按最近活跃排序；标题取
   `readTitleSnapshots`，缺失回退"工作区名 · 新会话"）；条目分类纯函数
   `classifyImport`（规范化绝对路径判定重复）；冲突项并排 diff 对比（用途说明 /
   可用状态差异按侧高亮：mine 红 / incoming 绿）逐条选择「保留现有 / 采用导入」。
   **快照语义**：新增条目重新铸造 id、note 保持源值；「采用导入」以导入侧 note
   替换现有条目（保留现有 id）——不回流，与 v10 一致。源会话读取只读探测
   可用性、不写回；目标会话导入时重新校验。错误显示在流程弹窗内部（flowError，
   避免被下层面板遮住）；取消/关闭分层回退（conflicts→picks→sessions→关闭）；
   默认**反选**起步、全选三态、失效新增条目禁用；`/ref-lib import [会话] [路径...]`
   命令同语义（id 精确 → 标题模糊匹配，多候选列清单；冲突在命令模式一律跳过）→
   v13（**导入流程定稿 + 官方会话类型**：`@deepseek-ai/dsh-session-query` peer
   （`^0.1.1-rc.2`）声明合并 `ctx.sessionQuery`，`attachSessionMeta` 改吃官方
   `SessionTitleObservationResult`，`SessionId()` 官方工厂替换本地 `as` 断言——cwd
   三源兜底逻辑不变（③ 观测 → ① live `sessions.get()?.header.cwd` → ②
   `listSessions()` 记录，最终回退"新会话"），宿主结构变化从此走 typecheck 而非
   被断言掩盖；冲突页视觉对齐原型（note 标签国际化"用途说明："、diff 高亮按侧
   红/绿、主面板状态行/详情编辑打磨）；195 测试全过，`docs/prototype-session-
   import.html` 为 v12 候选原型基准）→
v15（**能力形态：提醒式 + 自主检索**，2026-08-24 落地，设计文档
`docs/v15-tool-migration-design-notes.md`）：新增 peerDeps
`dsh-tools`/`dsh-agent`/`dsh-llm`/`dsh-agent-presets`（均 `^0.1.1-rc.2`）；
**`reference_lookup` 工具**（`src/tool.ts`：库 id schema 路径围栏 + 自实现受限
检索 `src/search.ts`（node fs 遍历 + 行匹配，无 rg 二进制）+ snippet 返回 +
catalog 操作；**纯检索无预算无记账**——模型可自主选择用工具/直接读文件/自己
grep）；**注入 = 强化提醒**（挂载即识别：有可用挂载库即注入提醒式政策
`renderRefLibsV15`（库清单+根路径+规范使用指引，每轮加载对抗上下文遗忘），
未挂载零注入；cwd 自动匹配 + 映射表经评估价值有限**整体移除**，见设计文档
§1.2）；**子 agent 种子告知**（`agent/created` 对 `origin:'subagent'` inject
inherit-lite 指引）+ **极简 preset 工具 deny**（`agent.ctx.tools.restrict`——
全局注册工具对极简 agent 默认可见，已核验设计文档 §6-21）；**覆盖检查
（nudge/strict）与逃逸预算（三层 + budget-stats 统计）2026-08-24 实测后整体
移除**——政策"BEFORE answering"诱导模型每次必查导致过度调用（一次 step 4 次
查询被截断），用户决定回到"提醒 + 自主"观察裸效果（`src/coverage.ts` /
`src/metrics.ts` 已删除，git 历史可恢复）；检索质量：多词 OR 匹配、忽略
`.pnpm-store` 等大目录、文件优先遍历、注释降权+行长升序排序、每文件命中上限；
**canonical 值红线：工具返回值必须是纯 lossless JSON（禁 undefined 键/函数/
符号/循环引用——`message: undefined` 曾触发 `INVALID_TOOL_OUTPUT`）**；
233 测试全过（coverage/metrics 套件随模块移除），调试工具
`scripts/analyze-session.mjs` / `dump-grep.mjs`（只读冷加载会话日志）。
**未完成（后续）**：S5 探测 TTL（热路径 statSync 仍在）、inherit none 策略、预设黑名单自动判定（denyPresets，方案 A 见设计文档变更记录）、
token 对比基准任务集（§4.1 开放问题 #16）；覆盖检查/逃逸如需恢复可从 git
历史取回并按需接线。

## 2. 开发规范（必须遵守）

- 所有插件开发必须**符合 DeepSeek Harness 的开发规范**（"everything is a plugin" 的
  Cordis 插件模型）。
- 规范来源：官方插件开发文档
  <https://deepseek-harness.github.io/deepseek-harness/develop/basic/>；遇到不确定的
  API/约定，以官方文档与 harness 既有实现为准，必要时 grep 官方源码仓库查证，禁止臆造。
- 基本形态（官方教程的"第一个插件"）：

  ```ts
  import type { Context } from '@deepseek-ai/cordis'

  export const name = 'my-plugin'

  export function apply(ctx: Context) {
    // 在此注册能力（服务、工具、指令等）
  }
  ```

- 插件通过 `cordis.yml` 覆盖层注册，插件路径必须是**绝对路径**。
- **client 插件（提供 Web UI 的浏览器端插件）**：除 node 端形态外，还须在 `package.json`
  声明 `dsh.client`（`platform: 'web'`，可带 `inject`）与 `exports["./client"]`
  （指向构建好的 bundle），并**以 host 可解析的包名加载**——client 扫描按包名解析
  package.json，绝对路径 entry 不会被识别为 client 插件；插件集变更需重启 `dsh web`
  才生效（生产构建无 HMR）。UI 挂载优先使用现有 slot（本插件使用
  `conversation.input.dock` 等官方 slot）。
- 门禁：`pnpm typecheck`（`tsc --noEmit`）/ `pnpm lint`（eslint + prettier，见
  `eslint.config.js`）/ `pnpm test`（必须含 L0–L2 全部层，见 §5）/ `pnpm build`
  （`tsc` + `tsdown`）。

## 3. 参考速查

| 目的 | 位置 |
| --- | --- |
| 官方插件开发文档（首个插件 / tool / config / publish） | <https://deepseek-harness.github.io/deepseek-harness/develop/basic/> |
| 官方文档首页 | <https://deepseek-harness.github.io/deepseek-harness/> |

## 4. 硬性约束

1. **先查证、后实现**：不确定的 API/约定必须先查官方文档或 harness 既有实现，禁止臆造。
2. **结果可复现**：本仓库可独立运行/验证（`pnpm build` + `scripts/dev-isolate.sh`），
   运行方式见 `README.md`「🧑‍💻 开发」节。
3. 本文件是仓库核心记忆；后续新增约定时直接维护本文件，并同步 `README.md`。

## 5. 插件开发测试标准（2026-08-17 事故后确立，本工作区所有插件必须遵守）

> 事故背景：ref-lib v1/v2 把 per-session 状态写成自定义会话事件 `ref-lib/set`，
> 但 harness 加载器只认仓库内生成白名单 `KNOWN_SESSION_EVENT_TYPES` 里的事件类型
> （白名单外的必须带 `ignorable: true` 信封标记，而 `session.append()` 无写入途径），
> 导致真实会话日志被整体拒读。教训：**开发联调不能直接跑在真实环境上，且必须有一道
> harness 边界的自动防线**。

分层测试（每层都是硬性要求）：

| 层 | 内容 | 本仓库参考实现 |
| --- | --- | --- |
| L0 纯函数单测 | logic/render/parse 等无副作用逻辑，快而密 | `tests/logic.spec.ts` 等 |
| L1 装配/装载测试 | 真实 `cordis-plugin-loader` 装载插件组合，验证服务/命令注册不炸 | `tests/loader.spec.ts` |
| L2 **harness 边界回归（事故防线）** | 真实 `SessionStore` + `JsonlSessionPersistence` + 临时根，跑「写会话 → flush → 全新实例冷加载」回路；**任何写入会话日志/持久化的插件必须包含此测试**，断言日志可加载、无白名单外事件；同时用「陷阱守卫」用例固化事故行为（写白名单外事件 → 必须抛 `SessionFormatUnsupportedError`） | `tests/harness-roundtrip.spec.ts` |
| L3 开发环境隔离 | **开发/联调一律用隔离 `DSH_HOME`**（默认 `~/.dsh-dev`）+ 独立 profile，真实 `~/.dsh` 零接触；`rm -rf` 即可重置 | `scripts/dev-isolate.sh`（通用用法：`PLUGIN=<插件目录> DEV_HOME=<任意目录> ./scripts/dev-isolate.sh`） |
| 通道 | client↔node 数据通道**首选 `ctx.webServer` 自注册 HTTP 路由**（`@deepseek-ai/dsh-host-webserver`，`/api/<plugin>/*`，loopback 护栏，参照 dsh-ssh / dsh-persona-memory 先例）；命令/投影仅在无 webServer 的组合兜底 | `src/routes.ts` + `tests/routes.spec.ts` |
| L4 实验前备份 | 任何要动真实 `~/.dsh/sessions` 的操作前先整目录备份 | 参考 `scripts/patch-ref-lib-logs.mjs` 的备份步骤 |

附加约定：

1. **不要往会话日志写白名单外事件**（自定义事件类型无法标记 `ignorable`，会让日志被
   整体拒读）。插件 per-session 状态存 dsh home 下 sidecar（`dshHomePath()`），旧
   日志事件仅做一次性迁移折叠。
2. 已中招的旧日志用 `scripts/patch-ref-lib-logs.mjs` 修补（补 `ignorable: true`），
   用 `scripts/verify-ref-lib-logs.mjs` 以 GUI 同款加载器验证。
3. 每个插件交付时，`pnpm test` 必须包含 L0–L2 全部层（L3/L4 是开发流程约定，写入
   插件 README）。

## 6. 开发环境速查

- 隔离开发环境：`scripts/dev-isolate.sh`（启动/插件安装卸载/补丁覆盖/热更新/重置的
  完整命令见 `README.md`「🧑‍💻 开发」节）。
- 热更新：`src/client/*` 改动 `pnpm build:client` 后浏览器 ≤0.5s 自动更新；node half
  改动 `pnpm build:node` 后必须重启 `dsh web`。
