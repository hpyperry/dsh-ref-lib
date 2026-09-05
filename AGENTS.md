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
   v14（**跨会话导入排除已归档会话**：宿主 `ctx.workspaceRegistry.archivedSessionIds`
   （`@deepseek-ai/dsh-workspace` 展示层归档集合——归档只隐藏工作区树、会话仍在
   live/persistence，sidecar 枚举原本会包含它们）在 `listSessions` **单点过滤**，
   UI 面板（`/api/ref-lib/sessions`）与 `/ref-lib import` 命令同享；宿主无
   workspaceRegistry（非 web 组合）或缺省时原样保留不阻断；纯函数
   `excludeArchivedSources`（L0 钉死缺省/空集合/部分/全归档行为）+ 服务层 stub
   集成测试；peer/dev 新增 `@deepseek-ai/dsh-workspace ^0.1.1-rc.2`（与 v11 基线
   同元组，声明合并经 typecheck 而非断言）；200 测试全过）→
   v15（**跨会话导入按工作区分组 + 懒加载**：跨工作区平铺难选——`listSessions` 经
   `workspaceRegistry.list()` 的 `sessionIds` **精确映射**（与宿主工作区树同口径）
   给每个源会话补 `workspace`（注册工作区 display title，wire 可选字段向后兼容）；
   纯函数 `groupSourcesByWorkspace`（分组键 = workspace，缺省归入「未分组」兜底组；
   组顺序 = 首次出现顺序 ≈ 组内最近活跃降序，组内保持入参顺序；泛型只约束
   sessionId/workspace，node 与 client 两半共用）；UI 会话选择步**分组渲染 + 组头
   可折叠**（默认展开，组键哨兵防同名碰撞），未分组行附 cwd 基名辅助识别；命令
   `/ref-lib import` 输出同步分组（`工作区 <title>：` / `未分组：` 分段）；**回退
   标题去"工作区名 · "前缀**（分组后工作区名由组头承担，UI 与命令统一显示"新会话"）；
   **v16 懒加载**（会话增多后全量 `readTitleSnapshots` 冷读会话日志变卡）——
   `/api/ref-lib/sessions` 三级契约：`groups=1` 组概览（枚举+归档过滤+workspace
   映射+计数，**不读标题**）→ 展开某组 `group=<key>` 按组拉取（标题补全只对该组
   执行，`filterSourcesByGroupKey`）→ 无参数全量（命令/兼容）；node 侧拆
   `enumerateSources`（公共枚举核心）+ `attachTitles`（标题补全，只对子集执行）+
   `listSessionGroups` / `listSessionsByGroup`；UI **默认全折叠**，展开按组懒加载
   并缓存（组内加载 spinner、失败进 flowError 可重试）；组键为服务端下发
   `UNGROUPED_GROUP_KEY`（`__ungrouped__` 哨兵），client 不再自造；新增 locale
   `import.group.ungrouped/count`；L0 钉死分组顺序/兜底组/概览聚合/按组过滤 +
   wire 三级解析 + 路由三级分发 + 服务层两级映射 + render 分组文本；版本
   0.12.0 → 0.13.0）→
   v16.1（**导入来源与宿主侧边栏同口径**：跨会话导入排除子代理
   （`origin === 'subagent'`）与**空白会话**（`blank`——从未开始对话，如测试残留的
   空会话；此前"未分组"被它们占满且侧边栏看不到）——一次
   `ctx.apiProxy.sessions.list()` 拿 `SessionSummary`（与侧边栏**同源同逻辑**：
   live 事件折叠 + 冷会话 size-cap 探测 + 投影缓存），`hiddenSessionIds()` 收集
   `origin === 'subagent' || blank` 的 id，三个入口（全量/组概览/按组）统一过滤；
   子代理 sidecar（v10 继承产物，带父会话参考库上下文）与 blank sidecar **保留
   不动**，仅不入导入来源；宿主无 apiProxy（非 web 组合）或调用失败降级不过滤；
   peer/dev 新增 `@deepseek-ai/dsh-host-apiproxy ^0.1.1-rc.2`；纯函数
   `excludeHiddenSources`（L0 钉死缺省/部分/全滤）+ 服务层 apiProxy stub 4 条
   （子代理/blank/调用失败/无服务）；231 测试全过，dev 实测 blank 会话（Redis
   残留）被正确剔除）→
   v17（**依赖基线升级 dsh 0.1.1-rc.2 → 0.1.2-rc.1（2026-09-03 正式发布）+ v16.1
   apiProxy 迁移**：破坏面与迁移方案见 `docs/upgrade-dsh-0.1.2-rc.1.md`。node half
   仅 `service.ts`：`ctx.apiProxy.sessions.list()`（`dsh-host-apiproxy` 删除）→
   `ctx.sessionController.list({}, signal)` 直接 `{ items }`
   （`@deepseek-ai/dsh-api-session-controller`，`hiddenSessionIds` 降级分支保留）；
   v1/v2 旧日志折叠改 `session.snapshotEvents()`（rc.1 起 `Session` 无 `.events`；
   rc.1 读取路径 `ignorable` 豁免与 rc.2 一致，含 ignorable 标记的旧日志仍可读——
   原修补/验证脚本已删除，见 §5 附加约定 2）。
   client half：`dsh-client-runtime` 删除（6 个类型迁出）——`ClientContext`→cordis
   `Context`、`SessionId`→`dsh-session/types`、`CommandNode/ConversationNode`→
   `dsh-client-ui-conversation/client`、`DirectoryEntry/DirectoryListing`→
   `dsh-host-directory-picker/types`（npm rc.1 的 `dsh-api-remotes` 无 ./client 类型
   产物，故不走文档初拟的 remotes 收口，见升级文档 §2.1 注）；`ctx.workspaces`→
   `ctx.uiWorkspace`（inject `'uiWorkspace'`）；dock 的 `session.nodes`→ui-chat 标准
   hook `useChat(s => s.legacy.nodes)`、`sessionId` 取自 `InputZone.session.sessionId`；
   `ctx.slots` 类型来源为 `@deepseek-ai/dsh-client-ui-renderer/client`（经 client 入口
   import type {} 收口，非 ui-conversation 传递）；tsdown `PLATFORM_EXTERNALS` 移除
   `dsh-client-runtime/client`。peer **16** 包（删 runtime/apiproxy + 增
   session-controller/ui-chat/ui-workspace；api-remotes 因 npm 缺 client 类型不加）、
   dev 新增 ui-renderer/host-directory-picker；version 0.15.0 → 0.17.0（v17 发布号
   定版；落地代码先经 0.16.0）；多版本兼容
   双轨矩阵与正式环境切换流程见升级文档 §5/§6）。

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
| L4 实验前备份 | 任何要动真实 `~/.dsh/sessions` 的操作前先**整目录备份**（`cp -R ~/.dsh ~/.dsh.bak-<时间戳>`），操作后确认无误再清理备份 | — |

附加约定：

1. **不要往会话日志写白名单外事件**（自定义事件类型无法标记 `ignorable`，会让日志被
   整体拒读）。插件 per-session 状态存 dsh home 下 sidecar（`dshHomePath()`），旧
   日志事件仅做一次性迁移折叠。
2. v1/v2 事故日志的处理已随 v17 收口：当时用于补 `ignorable: true` 的修补/验证脚本
   （`patch-ref-lib-logs.mjs` / `verify-ref-lib-logs.mjs`）**已删除**（2026-09-05，确认
   各环境无未修补残留）；旧日志如含 `ref-lib/set`，由 v3 起读取时一次性折叠迁移
   （`foldRefLibs`），无需再手工修补。若未来仍遇到拒绝加载的含自定义事件旧日志，
   先整目录备份（L4），再按 `KNOWN_SESSION_EVENT_TYPES` 与 `ignorable` 语义处理。
3. 每个插件交付时，`pnpm test` 必须包含 L0–L2 全部层（L3/L4 是开发流程约定，写入
   插件 README）。

## 6. 开发环境速查

- 隔离开发环境：`scripts/dev-isolate.sh`（启动/插件安装卸载/补丁覆盖/热更新/重置的
  完整命令见 `README.md`「🧑‍💻 开发」节）。
- 热更新：`src/client/*` 改动 `pnpm build:client` 后浏览器 ≤0.5s 自动更新；node half
  改动 `pnpm build:node` 后必须重启 `dsh web`。
