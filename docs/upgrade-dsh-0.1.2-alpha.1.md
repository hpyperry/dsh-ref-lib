# 升级方案：dsh 0.1.1-rc.2 → 0.1.2-alpha.1（client 域拆分适配 + Remote 迁移）

> 状态：**方案已定稿（2026-08-28 初稿；2026-08-30 对照当前代码复核，结论更新），改动未落地，
> 暂缓实施**（dsh 0.1.2-alpha.1 尚未发布到 npm，可能有新变化，等发布后再执行）
> 目标版本：ref-lib **v17**（当前基线 v16.1 / 0.15.0，升级落地后 bump 0.16.0；初稿的
> "v14"编号已被跨会话导入特性占用，复核修正）
> 依据：deepseek-harness 源码 @ `cd5ef81481`（release/dsh-0.1.2-alpha.1 的合并提交，
> 2026-08-28 已合入 master）与 git tag `dsh-v0.1.1-rc.2` 逐项 diff 核验。
> **复核说明（2026-08-30）**：初稿之后 ref-lib 落地了 v12–v16.1（跨会话导入 /
> 归档过滤 / 工作区分组 / 懒加载 / 侧边栏同口径可见性），本文档已对照当前代码重新核验
> §1–§4 每一条结论，并新增 v16.1 `ctx.apiProxy` 迁移条目（§1.1 / §2.4 / §4）——这是
> 初稿未覆盖、0.1.2 实际破坏的唯一 node half API。

## 0. 决策：暂缓升级，等发布

**决定：dsh 0.1.2-alpha.1 尚未发布到 npm，代码适配暂不落地，等官方发布后再执行本文档方案。**
依据（2026-08-30 复核，与初稿结论一致）：

1. **npm 无包**：`@deepseek-ai/dsh-session` 最新发布仍为 `0.1.1-rc.2`（dist-tag `next`；
   `latest` 仍为 `0.0.1-rc.1`）；新包 `@deepseek-ai/dsh-client-ui-chat` 在 npm 上**仍不存在
   任何历史版本**（registry 404）。改 package.json 到 `^0.1.2-alpha.1` 后 `pnpm install`
   必然失败。
2. **本地无法完整验证**：依赖 ref-lib 的新包类型（ui-chat 等）在当前 node_modules 不存在，
   typecheck 会报「模块找不到」；本地 deepseek-harness 源码中 ui-chat 未 build，且参考库
   只读不可补 build。
3. **上游可能变化**：0.1.2 仍是 alpha，发布前 API/包结构可能再调整——现在落盘适配有返工风险。
4. 已有先例：v9 文档「§0 版本基线」曾对 rc.8 / 0.1.1-rc.1 做同样决策，v11 落地升级。

本次核验结论（§1–§4）已足够成熟，官方发布后按 §5 执行即可（预期工作量：12 个文件——
§2.1 package.json / §2.2–2.3 两处 client 入口与 dock / §2.4 四处 client import 替换 +
两处测试 + 两处 v16.1 服务迁移（service.ts + service.spec）/ §2.5 tsdown / §2.6 AGENTS.md；
纯 import 替换 + 一处 hook 改造（useChat）+ 一处服务迁移（apiProxy → sessionController），
无逻辑重写）。

## 1. 影响分析摘要

### 1.1 Node half —— 一处破坏（v16.1 apiProxy 移除）+ 其余零破坏

| API | 结论 |
| --- | --- |
| `commands.register` + `invocation.rawInput/agent.session` + `{kind,text}` 返回 | 不变 |
| `systemPrompt.context({name,order,text})` + `context.agent?.session` | 不变 |
| `webServer.register(route)` + `WebRoute` + loopback 护栏 | 不变 |
| `sessions.get()`、`SessionId()` 工厂、`Session`/`SessionEvent` 类型 | 不变 |
| `header.cwd` / `header.parentSession` | 不变 |
| `session/created` + `{global:true}` | 不变 |
| `@deepseek-ai/dsh-session/types` 子路径 + `SessionEventMap` 声明合并 | 保留 |
| `ctx.sessionQuery.listSessions/readTitleSnapshots` + `SessionTitleObservationResult` | 不变 |
| `ctx.workspaceRegistry.list()` / `archivedSessionIds`（v14/v15） | 不变（0.1.2 仅注释与 `SessionId` import 路径微调，API 原样） |
| `dshHomePath()` | 不变（src 零 diff） |
| `@deepseek-ai/cordis` | 4.0.1，零 diff |
| **`ctx.apiProxy.sessions.list()`（v16.1）** | **破坏：`@deepseek-ai/dsh-host-apiproxy` 包在 0.1.2 整体删除（commit `4f00a8b82a`）→ 迁移到 `@deepseek-ai/dsh-api-session-controller` 的 `ctx.sessionController.list()`** |

**结论：node half 仅 `src/service.ts` 的 `hiddenSessionIds()`（v16.1 会话可见性过滤）
需要迁移；其余源文件（`src/index.ts` / `routes.ts` / `logic.ts` / `render.ts` /
`commands.ts` / `validate.ts` / `spec.ts`）零改动。** 初稿的"node half 全部源文件零改动"
在 v16.1 落地后不再成立，本次复核修正。

v16.1 迁移细节（已在 harness 源码逐行核验）：

- 旧（rc.2）：`ctx.apiProxy.sessions.list({ rpcId: RpcId(...), payload: {} })` →
  `response.result.ok` / `response.result.value.items`（RpcResponse 信封）；
  `RpcId` 从 `@deepseek-ai/dsh-host-apiproxy` 导入
- 新（0.1.2）：`ctx.sessionController.list({}, signal)` → 直接返回
  `{ items: SessionSummary[] }`（`SessionListRequest { cursor?: string }`，
  无 RpcResponse 信封；`@Remote('list')` 方法在进程内可直接调用）
- `SessionSummary` 形状两边**一致**：`sessionId / updatedAt / running / blank` +
  `parentSessionId? / origin?: 'subagent' / cwd? / projections?`——`blank` 与
  `origin: 'subagent'` 字段在位，v16.1 的过滤逻辑（`origin === 'subagent' || blank`）
  可原样保留，只换数据源
- 语义等价：宿主 web-app bundle 由 `@deepseek-ai/dsh-host-apiproxy` 换成
  `@deepseek-ai/dsh-api-session-controller`（`packages/bundle/web-app/package.json`
  逐行核验），`list()` 同为"live 事件折叠 + 冷会话 size-cap 探测 + 投影缓存"的
  冷安全路径（侧边栏同源语义不变）
- 宿主无 `sessionController`（非 web 组合）时 `ctx.get('sessionController')` 为
  undefined → 降级不过滤（与现 apiProxy 的 undefined 缺省分支同语义）

### 1.2 Client half —— 3 处编译级破坏 + 若干 import 调整（复核确认，与初稿一致）

1. **`@deepseek-ai/dsh-client-runtime` 包删除**（6 个类型迁出，字段逐字未变）：
   - `ClientContext` → 无替代导出，改用 `@deepseek-ai/cordis` 的 `Context`（rc.2 里它
     本来就是 `Context` 别名：`export type ClientContext = Context`）
   - `SessionId` → `@deepseek-ai/dsh-session/types`
   - `DirectoryEntry` / `DirectoryListing` → `@deepseek-ai/dsh-api-remotes/client`
     （规范定义在 `@deepseek-ai/dsh-host-directory-picker/types`，经
     `dsh-api-workspace-controller/types` 再导出，`dsh-api-remotes/client` 的
     `export type *` 收口——再导出链已逐行核验）
   - `ConversationNode` / `CommandNode` → `@deepseek-ai/dsh-client-ui-conversation/client`
     （定义在 `contract/records.ts`，ui-chat 亦再导出）
2. **`ctx.workspaces.pickDirectory()/listDirectory()` 已移除** → `ctx.uiWorkspace.*`
   （`@deepseek-ai/dsh-client-ui-workspace` 的 `UiWorkspace`，签名完全一致：
   `pickDirectory(): Promise<string | null>` / `listDirectory(path?, signal?)`；
   client `inject` 数组 `'workspaces'` → `'uiWorkspace'`）
3. **dock owner 的 `session.nodes` 没了**（`SessionSnapshot` 无 `nodes` 字段）→
   ui-chat 标准 hook `useChat(s => s.legacy.nodes)`（`ChatSnapshot.legacy` 兼容投影，
   与官方 StatsLine 同款读法；`kind:'user'` / `kind:'command'` 折叠语义逐行保留，
   `deriveRefreshTriggers` 函数体零改动，只换数据来源）。`useChat` 经 ui-chat 对
   ui-slots `SessionStandardProps` 的声明合并（`useChat: UseChat`）进入 session 作用域
   slot 的 `PropsRuntime`，dock 组件 props 天然携带，无需新注入项。

**新增文件核查（初稿之后落地的 v12–v16.1 client 文件）**：`RefLibPanel.tsx` /
`data.ts` / `locales.ts` / `styles.ts` / `refresh-guard.ts` 的 dsh 依赖只有
`dsh-client-ui-primitives`（组件 + 图标，0.1.2 未变）——**全部无需改动**。

### 1.3 构建 / 装载 / 测试机制 —— 全部保留（复核确认）

- `cordis.patch.yml` / `dsh.bundle.patch`（vendor/include patch 语义未动）
- `dsh.client` 声明 + 按包名扫描（`packages/client/modules`）
- seed 冻结模块表机制不变；**新增平台词 `@deepseek-ai/dsh-client-store`**；
  `PRELOADED_CLIENT_EXTERNALS` 清空（rc.2 曾预载 runtime/client）——
  `packages/client/web/src/platform.ts` 逐行核验
- `cordis-plugin-loader` 1.0.2 / `cordis-plugin-include` 1.0.6 版本未变
- L2 测试依赖全在位：`SessionStore`（dsh-session）、`JsonlSessionPersistence`、
  `SessionFormatUnsupportedError`（dsh-session-persistence）、`KNOWN_SESSION_EVENT_TYPES`
  fail-closed 机制
- `SESSION_FORMAT_VERSION` 仍为 0（v0→v1 迁移分支被 revert，未落地）；jsonl 存储
  range-encode `sourceEventSeqs` 但读取 layout-blind 向后兼容
- `dsh web` / `dsh plugin` 命令与 `scripts/dev-isolate.sh` 流程不变

## 2. 逐文件改动方案

### 2.1 `package.json`

- peerDeps：除 `@deepseek-ai/cordis`（4.0.1）与 `react` 外，全部 `^0.1.1-rc.2` →
  `^0.1.2-alpha.1`；**删除** `@deepseek-ai/dsh-client-runtime` 与
  `@deepseek-ai/dsh-host-apiproxy`（后者随 0.1.2 包删除，见 §1.1）；**新增**
  `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-session-controller`、
  `@deepseek-ai/dsh-client-ui-chat`、`@deepseek-ai/dsh-client-ui-workspace`
  （peer **15 → 17** 包；初稿按当时树记"12 → 14"，复核按当前 package.json 修正）
- devDeps：`dsh-client-ui-conversation` / `dsh-client-ui-slots` /
  `dsh-session-persistence` / `dsh-session-persistence-jsonl` / `dsh-workspace` 全部 →
  `0.1.2-alpha.1`；`dsh-host-apiproxy` **移除**（tests 只经字符串
  `ctx.provide('apiProxy', …)` stub，无类型依赖，可一并删除）

### 2.2 `src/client/index.ts`（复核确认，与初稿一致）

```diff
-import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
+import { type Context } from '@deepseek-ai/cordis'
+import type { SessionId } from '@deepseek-ai/dsh-session/types'
+// 新增声明合并（commandview 槽位声明自 0.1.2 起在 ui-chat；ctx.uiWorkspace 在 ui-workspace）
+import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
+import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
...
-export const inject = ['slots', 'workspaces', 'locale']
+export const inject = ['slots', 'uiWorkspace', 'locale']
...
-export function apply(ctx: ClientContext): void {
+export function apply(ctx: Context): void {
...
-    pickDirectory: () => ctx.workspaces.pickDirectory(),
-    listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
+    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
+    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
```

### 2.3 `src/client/RefLibDock.tsx`（useChat 改造，唯一的行为改动点；复核确认）

```diff
-import type { DirectoryListing, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
+import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
+import type { SessionId } from '@deepseek-ai/dsh-session/types'
...
-  const { sessionId, session, load, ... } = props
+  const { sessionId, useChat, load, ... } = props
...
-  const { userMessageCount, refLibCommandDone } = deriveRefreshTriggers(session.nodes)
+  const chatNodes = useChat((s) => s.legacy.nodes)
+  const { userMessageCount, refLibCommandDone } = deriveRefreshTriggers(chatNodes)
```

`useChat` 来源：ui-chat 对 ui-slots `SessionStandardProps` 的声明合并（见 §1.2-3），
session 作用域 slot 的 `PropsRuntime` 天然携带。`session` prop 类型由
`ConversationSnapshot`（含 nodes）变为 `SessionSnapshot`（无 nodes，
`@deepseek-ai/dsh-api-session-controller/client`），组件内对 `session` 的其他引用
一并删除（当前组件仅在刷新触发处使用 `session.nodes`，改动面单一）。

### 2.4 其余 import 替换（3 处组件 + 1 处纯函数 + 1 处测试 + 1 处服务迁移）

| 文件 | 旧 | 新 |
| --- | --- | --- |
| `src/client/RefLibBrowser.tsx` | `DirectoryEntry, DirectoryListing` from `dsh-client-runtime/client` | `@deepseek-ai/dsh-api-remotes/client` |
| `src/client/RefLibCommandCard.tsx` | `CommandNode` from `dsh-client-runtime/client` | `@deepseek-ai/dsh-client-ui-conversation/client` |
| `src/client/RefLibImport.tsx` | `SessionId` from `dsh-client-runtime/client` | `@deepseek-ai/dsh-session/types` |
| `src/client/refresh-triggers.ts` | `ConversationNode` from `dsh-client-runtime/client` | `@deepseek-ai/dsh-client-ui-conversation/client` |
| `tests/refresh-triggers.spec.ts` | `ConversationNode` from `dsh-client-runtime/client` | `@deepseek-ai/dsh-client-ui-conversation/client` |
| **`src/service.ts`（v16.1 新增条目）** | `ctx.apiProxy.sessions.list({rpcId, payload:{}})` + `import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'` + RpcResponse 信封解包（`hiddenSessionIds()`，service.ts:458–472） | `ctx.sessionController.list({}, signal)` 直接取 `{ items }`；`import type {} from '@deepseek-ai/dsh-api-session-controller'`（声明合并）；undefined 降级分支保留 |
| **`tests/service.spec.ts`（v16.1 新增条目）** | `ctx.provide('apiProxy', { sessions: { list: … } })` stub ×3（约 917/989/995 行） | stub 换 `ctx.provide('sessionController', { list: … })`，返回值 `{ items: SessionSummary[] }` |

**已核查无需改动**：`RefLibPanel.tsx` / `data.ts` / `locales.ts` / `styles.ts` /
`refresh-guard.ts`（仅依赖 ui-primitives）；`src/index.ts` / `routes.ts` / `logic.ts` /
`render.ts` / `commands.ts` / `validate.ts` / `spec.ts`（node half 零改动）。

### 2.5 `tsdown.config.ts`（复核确认）

`PLATFORM_EXTERNALS` 删除 `'@deepseek-ai/dsh-client-runtime/client'`（该包运行时已不存在，
残留 external 会在运行时 require 失败；其余平台词 cordis/react/ui-slots/ui-primitives
全部仍被 seed 表覆盖）。

### 2.6 注释 / 文档

- `src/client/index.ts` / `RefLibDock.tsx` / `refresh-triggers.ts` 头部注释：目录服务名、
  刷新信号数据源、harness 源码路径（conversation-nodes 迁至 ui-chat）同步更新；
  `src/service.ts` `hiddenSessionIds` 注释（apiProxy → sessionController）
- `AGENTS.md`：追加 **v17** 版本沿革（初稿的"v14"已被跨会话导入特性占用，复核修正）；
  §2/§3 文档链接 `develop/basic/` → `docs/cordis-tutorial/`（0.1.2 源码 `docs/` 下
  cordis-tutorial 已在位，核验通过）；§5 附加约定 2 标注 ignorable 修补语义在新版失效
  （见 §4-1）

## 3. 关键核验结论（字段/契约逐字核对，2026-08-30 复核全部通过）

- `CommandNode`（kind/seq/time/commandId/name/args/outcome）与 `ConversationNode`
  union：rc.2 runtime vs 新 records.ts **逐字段一致**（`RunningToolCall` 增
  `parentCallId`、删 `callView`——ref-lib 不引用，无影响）
- `DirectoryEntry`/`DirectoryListing`：形状与 rc.2 **完全一致**（仅路径迁至
  `dsh-host-directory-picker/types`，经 `dsh-api-workspace-controller/types` →
  `dsh-api-remotes/client` 再导出）
- `conversation.chat.commandview` 槽位：`{kind:'keyed'; scope:'session';
  owner: CommandRowOwnerProps}` 与 `PropsRuntime<'conversation.chat.commandview'>`
  **逐字段一致**，仅声明包 ui-conversation → ui-chat
- `conversation.input.dock`：仍在 ui-conversation，`InputZone { session, input }`
  契约名不变，但 `session` 类型由 `ConversationSnapshot`（含 nodes）→
  `SessionSnapshot`（无 nodes，`@deepseek-ai/dsh-api-session-controller/client`）
- `SessionSummary`（v16.1 数据契约）：rc.2 api-proxy vs 0.1.2 session-controller
  **同形**（`blank` / `origin?: 'subagent'` 在位），v16.1 过滤逻辑原样保留，仅换数据源
- `ctx.slots` 类型来源：runtime → `dsh-client-ui-renderer`（经
  ui-conversation/client 的 apply.ts 传递可达，无需显式新 peer）
- `ctx.locale.register` / ui-slots 全部类型 / ui-primitives 组件与 12 个图标：
  全部未变（图标未迁移到 ui-theme）

## 4. 注意事项（升级前/升级时）

1. **旧日志 fail-closed（行为级，最需要留意）**：0.1.2 会话事件词汇表 fail-closed——
   `ignorable: true` 不再被加载器认可，白名单外事件一律拒读。**逐行核验**：rc.2 读取
   路径为 `KNOWN_SESSION_EVENT_TYPES.has(t) || event.ignorable === true`
   （coordinator.ts:1063），0.1.2 删除 `ignorable` 分支（coordinator.ts:1141）且
   known-event-types.ts 注释同步删去 ignorable 说明。含 `ref-lib/set` 事件的 v1/v2
   旧日志（即使补过 `ignorable`）在新版会被拒读，`foldRefLibs` 迁移路径失效——
   **`scripts/patch-ref-lib-logs.mjs` 的 ignorable 修补在新版不再起救援作用**。
   **应在上游升级前完成折叠迁移**；v3 sidecar 日志不受影响。L2「陷阱守卫」断言在
   新版依然成立（且更强：ignorable 不再豁免），测试无需修改。
2. **`ctx.uiWorkspace` 依赖宿主包含 `@deepseek-ai/dsh-client-ui-workspace`**（web-app
   bundle 已含）；dev-isolate 自定义 profile 若不含需补，或对 `ctx.get('uiWorkspace')`
   做可选兜底。
3. **`ctx.sessionController` 依赖宿主包含 `@deepseek-ai/dsh-api-session-controller`**
   （0.1.2 web-app bundle 已含——rc.2 的 `dsh-host-apiproxy` 被它替换）；dev-isolate
   自定义 profile 若不含需补，或对 `ctx.get('sessionController')` 做可选兜底（现
   apiProxy 的 undefined 降级分支同语义保留）。
4. **peer 版本范围**：官方发布后 peerDeps 对齐 `^0.1.2-alpha.1`（与宿主版本族同元组，
   v11 惯例）；若稳定版版本号不同（如 0.1.2 正式版），以最终发布号为准。

## 5. 发布后执行步骤

```bash
# 1) 官方发布 0.1.2-alpha.1（或稳定版）到 npm 后
pnpm install            # 解析到新版本族
# 2) 按 §2 应用改动（diff 基准已在本仓库 git 历史之外的本文档 §2 记录；
#    含 v16.1 apiProxy → sessionController 服务迁移，见 §2.4）
# 3) 四道门禁
pnpm typecheck && pnpm lint && pnpm test && pnpm build
# 4) L3 隔离验证（插件加载 + /api/ref-lib/* 路由）
PLUGIN=. DEV_HOME=/tmp/dsh-dev ./scripts/dev-isolate.sh
# 5) 升级前处理旧日志（如仍有 v1/v2 含 ref-lib/set 的会话）
#    —— 在 rc.2 上先跑折叠迁移，或确认无残留后再升级
# 6) AGENTS.md 追加 v17 落地注记（门禁结果、L3 结论）
```

> 附：完整改动 diff（初稿 325 行 + v16.1 apiProxy 迁移增量）已在实施时存档于本会话记录；
> 本文档 §2 的代码片段与之一致，可作为重放基准。
