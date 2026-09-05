# 升级方案：dsh 0.1.1-rc.2 → 0.1.2-rc.1（client 域拆分适配 + Remote 迁移 + 多版本兼容测试矩阵）

> 状态：**方案定稿**（2026-08-28 初稿 → 2026-08-30 对照 alpha.1 代码复核 → 2026-09-05
> 对照 **rc.1 正式发布**复核定稿，**同日按 §2 落地为 v17**——偏离项与验证结论见 §7）。
> 本文件由 `upgrade-dsh-0.1.2-alpha.1.md` 改版而来，文件名随目标版本同步。
> **0.1.2-rc.1 已于 2026-09-03 正式发布到 npm**（git tag `dsh-v0.1.2-rc.1` @ `a66e470204`，
> 2026-09-03 02:27 +0800），原 alpha 时代的「暂缓实施，等发布」决策解除；适配代码按本文档
> §2 落地为 ref-lib **v17**，但**必须先按 §5 的多版本兼容测试矩阵在隔离环境全绿**，再按 §6
> 双轨切换正式环境（宿主 0.1.1-rc.2 → 0.1.2-rc.1），生产零影响。
> 目标版本：ref-lib **v17**（当前基线 v16.1 / 0.15.0，升级落地后 bump 0.17.0——
> 发布号定版；落地代码先经 0.16.0）。
> 依据：deepseek-harness git tag `dsh-v0.1.2-rc.1`（`a66e470204`）为最终核验对象；初稿核验的
> alpha.1 合并提交 `cd5ef81481` 之后、rc.1 之前的增量（alpha.2–alpha.5 → rc.1，含两处行为级
> 变化）已逐项复查，结论见 §1.4；凡引用「已核验」的条目均带 rc.1 源码路径。
> **复核说明（2026-09-05）**：alpha.1 → rc.1 期间，初稿的破坏面结论（§1.1 apiProxy 删除 /
> §1.2 client 三处编译级破坏）**全部依然成立**；两处需要修正的行为级变化是：① 会话事件
> `ignorable` 豁免被 **revert 恢复**（§4-1），② 宿主 CLI `@deepseek-ai/dsh` 的 npm dist-tag
> `latest` 已切到 rc.1（§0-2 / §4-5 新增风险）。另外 alpha.1 后新落地了 seq/log-offset 重构与
> 投影缓存跨版本读兼容（§1.4），对 ref-lib 均为零改动。

## 0. 决策：rc.1 已发布 → 多版本测试矩阵先行、双轨切换、正式环境零影响

**决定：适配代码按 §2 落地为 v17（依赖基线 `0.1.2-rc.1`），但先按 §5 的矩阵在隔离环境完成
全部验证，再按 §6 双轨切换正式环境；切换前正式环境保持「宿主 dsh 0.1.1-rc.2 + ref-lib
v16.1」不动。** 依据（2026-09-05 复核）：

1. **npm 已发布，两大障碍消除**：`@deepseek-ai/dsh-session` 及全部 ref-lib 依赖包在
   dist-tag `next` 下均有 `0.1.2-rc.1`（`alpha` 保留 `0.1.2-alpha.5`）；alpha 时代缺失的
   新包（`dsh-api-session-controller` / `dsh-api-workspace-controller` / `dsh-client-ui-chat` /
   `dsh-client-store`）同样在位——「npm 无包、registry 404」与「本地无法 typecheck」不再成立。
   `pnpm install` 刷新依赖族即可本地完整验证（§5.3）。
2. **宿主 CLI dist-tag 已切（新风险点）**：`@deepseek-ai/dsh` 的 `latest` 已是
   `0.1.2-rc.1`（`next` 同号）——现在执行无 pin 的 `npm i -g @deepseek-ai/dsh` 就会**升级生产
   宿主**。正式环境与所有安装脚本必须显式 pin 版本（§4-5 / §5.3 / §6）。
3. **破坏性更新仍在**（§1.1 / §1.2），且 v16.1（rc.2 依赖族）与 v17（rc.1 依赖族）**互不
   跨宿主运行**（client 的 fiber inject 所需宿主服务在对方宿主不存在——v16.1 inject
   `'workspaces'`、v17 inject `'uiWorkspace'`——加载即失败，论证见 §5.1），因此采用
   「双轨发布 + 版本对矩阵」，而不是原地升级单点切换。
4. **行为级回滚已确认**：会话事件 `ignorable` 豁免在 alpha 周期内被 revert 恢复
   （`2c6ff296af` Revert "worktree/remove-ignorable-session-events"），rc.1 读取路径与 rc.2
   语义一致（`KNOWN_SESSION_EVENT_TYPES.has(t) || event.ignorable === true`，
   `packages/session/session-persistence/src/coordinator.ts:1250`）——旧日志处理不再有
   「升级前必须完成折叠」的时间压力（§4-1），但生产数据兼容仍需在**副本**上验证（§5.4）。

本次复核结论（§1–§4）按 rc.1 最终化；落地执行路径见 §5（矩阵）→ §6（生产切换），预期改动
面与初稿一致：12 个文件——§2.1 package.json / §2.2–2.3 两处 client 入口与 dock / §2.4 四处
client import 替换 + 两处测试 + v16.1 服务迁移（service.ts + service.spec）/ §2.5 tsdown /
§2.6 AGENTS.md；纯 import 替换 + 一处 hook 改造（useChat）+ 一处服务迁移
（apiProxy → sessionController），无逻辑重写。

## 1. 影响分析摘要

### 1.1 Node half —— 一处破坏（v16.1 apiProxy 移除）+ 其余零破坏（rc.1 复核通过）

| API | 结论 |
| --- | --- |
| `commands.register` + `invocation.rawInput/agent.session` + `{kind,text}` 返回 | 不变 |
| `systemPrompt.context({name,order,text})` + `context.agent?.session` | 不变 |
| `webServer.register(route)` + `WebRoute` + loopback 护栏 | 不变 |
| `sessions.get()`、`SessionId()` 工厂、`Session`/`SessionEvent` 类型 | 不变（rc.1 新增 `SessionSeq`/`SessionLogOffset` 品牌类型与 `session/not-found` 事件，ref-lib 不引用） |
| `header.cwd` / `header.parentSession` | 不变（rc.1 `jsonl format.ts` header 逐字段含二者） |
| `session/created` + `{global:true}` | 不变（`packages/core/session/src/index.ts` 事件声明在位） |
| `@deepseek-ai/dsh-session/types` 子路径 + `SessionEventMap` 声明合并 | 保留（rc.1 package.json `./types` 子路径在位） |
| `ctx.sessionQuery.listSessions/readTitleSnapshots` + `SessionTitleObservationResult` | 不变（`packages/session-query/session-query/src/index.ts`） |
| `ctx.workspaceRegistry.list()` / `archivedSessionIds`（v14/v15） | 不变（rc.1 仅 `SessionId()` → `brandString<SessionId>()` 内部实现替换，API 同形） |
| `dshHomePath()` | 不变 |
| `@deepseek-ai/cordis` | **4.0.1 → 4.0.2**（rc.1 `vendor/cordis/package.json`）；ref-lib peer `^4.0.1` 仍覆盖，无需改 |
| **`ctx.apiProxy.sessions.list()`（v16.1）** | **破坏：`@deepseek-ai/dsh-host-apiproxy` 包在 0.1.2 删除（commit `4f00a8b82a`，alpha.1 起已不在仓库/web-app）→ 迁移到 `@deepseek-ai/dsh-api-session-controller` 的 `ctx.sessionController.list()`**（rc.1 复核：`packages/api/session-controller/src/index.ts:214` `async list(_request, signal)` 进程内可调用） |

**结论：node half 仅 `src/service.ts` 的 `hiddenSessionIds()`（v16.1 会话可见性过滤）
需要迁移；其余源文件（`src/index.ts` / `routes.ts` / `logic.ts` / `render.ts` /
`commands.ts` / `validate.ts` / `spec.ts`）零改动。** 初稿的"node half 全部源文件零改动"
在 v16.1 落地后不再成立，本次（alpha.1 复核起）已修正。

v16.1 迁移细节（rc.1 逐行核验）：

- 旧（rc.2）：`ctx.apiProxy.sessions.list({ rpcId: RpcId(...), payload: {} })` →
  `response.result.ok` / `response.result.value.items`（RpcResponse 信封）；
  `RpcId` 从 `@deepseek-ai/dsh-host-apiproxy` 导入
- 新（0.1.2-rc.1）：`ctx.sessionController.list({}, signal)` → 直接返回
  `{ items: SessionSummary[] }`（`SessionListRequest { cursor?: string }`，
  `SessionListValue { items }`，无 RpcResponse 信封；`@Remote('list')` 方法在进程内可直接调用）
- `SessionSummary` 形状两边**一致**（rc.1 `packages/api/session-controller/src/types.ts:155`
  逐字核对：`sessionId / updatedAt / running / blank` + `parentSessionId? / origin?: 'subagent' /
  cwd? / projections?`）——`blank` 与 `origin: 'subagent'` 字段在位，v16.1 的过滤逻辑
  （`origin === 'subagent' || blank`）可原样保留，只换数据源
- 语义等价：宿主 web-app bundle 在 rc.1 依赖 `@deepseek-ai/dsh-api-session-controller`
  （`packages/bundle/web-app/package.json` 逐行核验，无 `dsh-host-apiproxy`），`list()` 同为
  「live 事件折叠 + 冷会话 size-cap 探测 + 投影缓存」的冷安全路径（侧边栏同源语义不变）
- 宿主无 `sessionController`（非 web 组合）时 `ctx.get('sessionController')` 为
  undefined → 降级不过滤（与现 apiProxy 的 undefined 缺省分支同语义）

### 1.2 Client half —— 3 处编译级破坏 + 若干 import 调整（rc.1 复核通过）

1. **`@deepseek-ai/dsh-client-runtime` 包删除**（6 个类型迁出，字段逐字未变）：
   - `ClientContext` → 无替代导出，改用 `@deepseek-ai/cordis` 的 `Context`（rc.2 里它
     本来就是 `Context` 别名：`export type ClientContext = Context`）
   - `SessionId` → `@deepseek-ai/dsh-session/types`
   - `DirectoryEntry` / `DirectoryListing` → `@deepseek-ai/dsh-api-remotes/client`
     （规范定义在 `@deepseek-ai/dsh-host-directory-picker/types`
     `packages/host/directory-picker/src/types.ts:11/21`，经
     `dsh-api-workspace-controller/types`（`src/types.ts:12` 再导出）收口到
     `dsh-api-remotes/client`（`src/client/index.ts` `export type *`）——rc.1 再导出链逐行核验）
   - `ConversationNode` / `CommandNode` → `@deepseek-ai/dsh-client-ui-conversation/client`
     （定义在 `contract/records.ts`，rc.1 `CommandNode` 在 `records.ts:225`，
     `kind: 'command'`；ui-chat 亦再导出）
2. **`ctx.workspaces.pickDirectory()/listDirectory()` 已移除** → `ctx.uiWorkspace.*`
   （`@deepseek-ai/dsh-client-ui-workspace` 的 `UiWorkspace` 服务；rc.1 官方 browse 选择器
   `packages/client/ui-directory-picker-browse/src/client/index.ts:79-80` 即用
   `ctx.uiWorkspace.listDirectory(path, signal)` / `createDirectory`，native 选择器
   `ui-directory-picker-native/src/client/index.ts:29` 用 `ctx.uiWorkspace.pickDirectory()`，
   inject 数组 `'workspaces'` → `'uiWorkspace'`，签名一致：
   `pickDirectory(): Promise<string | null>` / `listDirectory(path?, signal?)`）
3. **dock owner 的 `session.nodes` 没了**（`SessionSnapshot` 无 `nodes` 字段）→
   ui-chat 标准 hook `useChat(s => s.legacy.nodes)`（rc.1 复核：
   `packages/client/ui-chat/src/client/contract/snapshot.ts:82-98` 的
   `LegacyConversationSlice.nodes: readonly ConversationNode[]` 在位，官方 StatsLine
   `StatsLine.tsx:164` 同款读法；`kind:'user'` / `kind:'command'` 折叠语义保留，
   `deriveRefreshTriggers` 函数体零改动，只换数据来源）。`useChat` 经 ui-chat 对 ui-slots
   `SessionStandardProps` 的声明合并进入 session 作用域 slot 的 `PropsRuntime`（rc.1 复核：
   `packages/client/ui-chat/src/client/contract/slots.ts:173-177`），dock 组件 props 天然携带，
   无需新注入项。alpha.1 → rc.1 期间 ui-chat 新增 `useChatNode/useChatNodeProcess` 槽位
   props（纯增量，不影响既有 `useChat`）。

**新增文件核查（初稿之后落地的 v12–v16.1 client 文件）**：`RefLibPanel.tsx` /
`data.ts` / `locales.ts` / `styles.ts` / `refresh-guard.ts` 的 dsh 依赖只有
`dsh-client-ui-primitives`（组件 + 图标，0.1.2 未变）——**全部无需改动**。

### 1.3 构建 / 装载 / 测试机制 —— 全部保留（rc.1 复核通过，ignorable 结论修正）

- `cordis.patch.yml` / `dsh.bundle.patch`（vendor/include patch 语义未动）
- `dsh.client` 声明 + 按包名扫描（`packages/client/modules`）
- seed 冻结模块表机制不变；`dsh-client-store` 平台词在位；`PRELOADED_CLIENT_EXTERNALS`
  为空——`packages/client/web/src/platform.ts` 在 alpha.1 → rc.1 **零 diff**（复核确认）
- `cordis-plugin-loader` 1.0.2 / `cordis-plugin-include` 1.0.6 版本未变
- L2 测试依赖全在位：`SessionStore`（dsh-session）、`JsonlSessionPersistence`、
  `SessionFormatUnsupportedError`（dsh-session-persistence 定义、
  dsh-session-persistence-jsonl 再导出）、`KNOWN_SESSION_EVENT_TYPES` fail-closed 机制
- `SESSION_FORMAT_VERSION` 仍为 0（`packages/core/session/src/types.ts:87`）；rc.1 落地
  seq/log-offset 品牌重构（`27bf1039db`，§1.4-②）——jsonl 物理行携带 `SessionSeq`/
  `SessionLogOffset` 语义，但**读取布局向后兼容**（版本仍 0、跨版本 fixture 在 jsonl.spec
  在位），rc.2 写出的日志 rc.1 可读（生产升级的数据兼容见 §5.4 副本验证）
- **会话事件 `ignorable` 豁免在 rc.1 恢复**（`2c6ff296af` revert，见 §4-1）：读取路径
  `KNOWN_SESSION_EVENT_TYPES.has(t) || event.ignorable === true`
  （`packages/session/session-persistence/src/coordinator.ts:1250`）——与 rc.2 语义一致，
  修正 alpha.1 时代「ignorable 不再被认可」的结论（§4-1 整段改写）
- `dsh web` / `dsh plugin` 命令与 `scripts/dev-isolate.sh` 流程不变（宿主版本需按矩阵
  显式选择，见 §5.3）

### 1.4 alpha.1 → rc.1 增量核查（本版新增，全部为 ref-lib 零改动项）

| 增量（commit / tag 区间 cd5ef81481..a66e470204） | 内容 | 对 ref-lib 的影响 |
| --- | --- | --- |
| ① `2c6ff296af` Revert "remove-ignorable-session-events"（随 alpha.2 合入） | 会话事件 `ignorable` 豁免恢复（rc.2 语义） | §4-1 修正：旧日志处理时间压力解除；L2 陷阱守卫断言不变 |
| ② `27bf1039db` refactor(session)!: 区分 event seqs 与 log offsets | `SessionSeq` / `SessionLogOffset` 品牌类型；jsonl 物理层调整；`SESSION_FORMAT_VERSION` 仍 0，读取 layout-blind 向后兼容 | 零改动（ref-lib 只读 header/类型不写日志）；rc.2 日志 rc.1 可读 |
| ③ `4553c9d957` refactor(session)!: 删除 SQLite persistence 后端 | `session-persistence-sqlite` 目录移除 | 无关（ref-lib 用 jsonl/无 sqlite） |
| ④ `49df707c86` / `fcd109d29a` feat(storage): per-record 版本读兼容 + 备份跳过的 salvage；projection-cache 跨版本读兼容 | 宿主存储/投影缓存升级可读性保障 | 无关但利好：宿主升级不必清缓存（副本验证覆盖） |
| ⑤ cordis vendor 4.0.1 → 4.0.2 | 宿主 cordis 小版本 | peer `^4.0.1` 覆盖，零改动 |
| ⑥ ui-chat 若干 perf 重构（keyed chat sources / 流式发布节流等）+ 新增 `ui-schedule`、`session-turn-outline` 包 | 内部性能与新增无关包 | rc.1 复核：`useChat`/`legacy`/槽位契约/CommandNode 等 ref-lib 所用 token 无 +/− 漂移 |
| ⑦ api/workspace/webserver 等包 `invariant` 内部重构、`SessionId()` → `brandString<SessionId>()` 实现替换 | 纯内部 | API 同形（typecheck 级不可见） |

## 2. 逐文件改动方案（v17 实现基准，与初稿一致）

### 2.1 `package.json`

- peerDeps：除 `@deepseek-ai/cordis`（`^4.0.1`，rc.1 vendored 4.0.2 仍在范围内）与 `react`
  外，全部 `^0.1.1-rc.2` → **`^0.1.2-rc.1`**；**删除** `@deepseek-ai/dsh-client-runtime` 与
  `@deepseek-ai/dsh-host-apiproxy`（npm 上两者最新仍止于 0.1.1-rc.2，rc.1 宿主不再提供）；
  **新增** `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-session-controller`、
  `@deepseek-ai/dsh-client-ui-chat`、`@deepseek-ai/dsh-client-ui-workspace`
  （peer **15 → 17** 包；cordis + react + 13 个 dsh peer）
- devDeps：`dsh-client-ui-conversation` / `dsh-client-ui-slots` /
  `dsh-session-persistence` / `dsh-session-persistence-jsonl` / `dsh-workspace` 全部 →
  **`0.1.2-rc.1`**（精确 pin，与现有 devDeps 写法一致）；`dsh-host-apiproxy` **移除**
  （tests 只经字符串 `ctx.provide('apiProxy', …)` stub，无类型依赖，可一并删除）
- 注：ref-lib `.npmrc` 为 `auto-install-peers=false`，但 pnpm 仍会把 peer specifier 写入
  lockfile importer 并从 registry 解析（现状 rc.2 树即如此）——rc.1 基线在独立 worktree 内
  `pnpm install` 即可整树换到 `0.1.2-rc.1`；若个别新 peer 未被解析（严格形态），把它显式加
  入 devDependencies 即可（类型/单测引用它们，见 §5.3-依赖基线）。

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
`ConversationSnapshot`（含 nodes）变为 `SessionSnapshot`（无 nodes），组件内对 `session`
的其他引用一并删除（当前组件仅在刷新触发处使用 `session.nodes`，改动面单一）。

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

`PLATFORM_EXTERNALS` 删除 `'@deepseek-ai/dsh-client-runtime/client'`。说明：替换后对
`dsh-client-runtime` 的引用全部消失（现状本就是 `import type`，构建期擦除、不产生运行时
require），保留该词只是让 external 表指向一个 0.1.2 已不存在的模块名——删除以保持构建配置
与真实依赖一致，并保证将来若有人误引入 value import，会在 typecheck/lint 即暴露而非在
rc.1 宿主上运行时解析失败。其余平台词 cordis/react/ui-slots/ui-primitives/client-locale
全部仍被 seed 表覆盖。新增的 `dsh-api-remotes/client`、`dsh-client-ui-chat/client`、
`dsh-client-ui-workspace/client` 均为 type-only import（构建期擦除），**不**进 external 表。

### 2.6 注释 / 文档

- `src/client/index.ts` / `RefLibDock.tsx` / `refresh-triggers.ts` 头部注释：目录服务名、
  刷新信号数据源、harness 源码路径（conversation-nodes 迁至 ui-chat）同步更新；
  `src/service.ts` `hiddenSessionIds` 注释（apiProxy → sessionController）
- `AGENTS.md`：追加 **v17** 版本沿革；§2/§3 文档链接 `develop/basic/` →
  `docs/cordis-tutorial/`（rc.1 源码 `docs/cordis-tutorial` 在位，核验通过）；§5 附加约定 2
  的 ignorable 语义说明维持现状（rc.1 与 rc.2 相同，不再有「在新版失效」问题）

## 3. 关键核验结论（字段/契约逐字核对，2026-09-05 对照 rc.1 全部通过）

- `CommandNode`（kind/seq/time/commandId/name/args/outcome）与 `ConversationNode`
  union：rc.1 `packages/client/ui-conversation/src/client/contract/records.ts`
  （`CommandNode` @ :225）——alpha.1 → rc.1 无字段漂移（`RunningToolCall` 曾增
  `parentCallId`、删 `callView`，ref-lib 不引用）
- `DirectoryEntry`/`DirectoryListing`：形状与 rc.2 **完全一致**（仅路径迁至
  `dsh-host-directory-picker/types`，经 `dsh-api-workspace-controller/types`（:12）→
  `dsh-api-remotes/client`（`export type *`）再导出，rc.1 逐行核验）
- `conversation.chat.commandview` 槽位：`{kind:'keyed'; scope:'session';
  owner: CommandRowOwnerProps}`（rc.1 `packages/client/ui-chat/src/client/contract/slots.ts:209`）
  与 `PropsRuntime<'conversation.chat.commandview'>` 逐字段一致，声明包 ui-conversation →
  ui-chat
- `conversation.input.dock`：仍在 ui-conversation
  （rc.1 `packages/client/ui-conversation/src/client/contract/slots.ts:127`
  `{ kind: 'list'; scope: 'session'; owner: InputZone }`），`InputZone { session, input }`
  契约名不变，但 `session` 类型由 `ConversationSnapshot`（含 nodes）→ `SessionSnapshot`
  （无 nodes）
- `ChatSnapshot.legacy.nodes`（useChat 数据源）：rc.1
  `packages/client/ui-chat/src/client/contract/snapshot.ts:82-98` 的
  `LegacyConversationSlice.nodes: readonly ConversationNode[]` 在位；官方 StatsLine
  （`StatsLine.tsx:164`）同款读法
- `useChat` 声明合并：rc.1 `packages/client/ui-chat/src/client/contract/slots.ts:173-177`
  `declare module '@deepseek-ai/dsh-client-ui-slots' { interface SessionStandardProps {
  useChat: UseChat } }`——dock 等 session 作用域 slot 的 `PropsRuntime` 天然携带
- `SessionSummary`（v16.1 数据契约）：rc.1
  `packages/api/session-controller/src/types.ts:155` 与 rc.2 api-proxy **同形**
  （`blank` / `origin?: 'subagent'` / `parentSessionId?` / `cwd?` / `projections?` 在位），
  v16.1 过滤逻辑原样保留，仅换数据源
- `ctx.slots` 类型来源：runtime → `dsh-client-ui-renderer`（经 ui-conversation/client 的
  apply.ts 传递可达，无需显式新 peer）
- `ctx.locale.register` / ui-slots 全部类型 / ui-primitives 组件与 12 个图标：
  全部未变（图标未迁移到 ui-theme）
- `SessionId()` 工厂：rc.1 仍在（`packages/core/session/src/types.ts:24`，内部改为
  `brandString<SessionId>()`），v13 的 cwd 三源兜底调用不受影响

## 4. 注意事项（升级前/升级时）

1. **会话事件 `ignorable` 豁免已恢复（rc.1 与 rc.2 语义一致，需留意的行为变化已解除）**：
   0.1.2 alpha 早期曾删除 `ignorable` 分支（alpha.1 复核时的状态），alpha.2 起 revert
   恢复（`2c6ff296af`）。rc.1 读取路径 `KNOWN_SESSION_EVENT_TYPES.has(t) ||
   event.ignorable === true`（`coordinator.ts:1250`），fail-closed 仅针对**未标记** ignorable
   的白名单外事件。含义：① v1/v2 时代含 `ref-lib/set` 的旧日志（已按旧版修补工具
   补过 `ignorable: true` 的）在 rc.1 宿主**仍然可读**，
   不再需要「升级前必须完成折叠迁移」；② 折叠迁移（foldRefLibs）仍是把旧事件一次性收进
   sidecar 的清理目标，可从容在升级后做；③ L2「陷阱守卫」断言在 rc.1 依然成立且与 rc.2
   语义一致（写**未标记** ignorable 的白名单外事件 → 必须抛
   `SessionFormatUnsupportedError`），测试无需修改。
2. **`ctx.uiWorkspace` 依赖宿主包含 `@deepseek-ai/dsh-client-ui-workspace`**（rc.1 web-app
   bundle 已含）；dev-isolate 自定义 profile 若手工裁剪需补，或对 `ctx.get('uiWorkspace')`
   做可选兜底。
3. **`ctx.sessionController` 依赖宿主包含 `@deepseek-ai/dsh-api-session-controller`**
   （rc.1 web-app bundle 已含——rc.2 的 `dsh-host-apiproxy` 被它替换）；dev-isolate 自定义
   profile 若不含需补，或对 `ctx.get('sessionController')` 做可选兜底（现 apiProxy 的
   undefined 降级分支同语义保留）。
4. **peer 版本范围**：对齐 `^0.1.2-rc.1`（与宿主版本族同元组，v11 惯例；devDeps 精确 pin
   `0.1.2-rc.1`）；cordis 保持 `^4.0.1`（rc.1 vendored 4.0.2，npm latest 4.0.2，均覆盖）；
   react `^18.2.0` 不变。
5. **宿主 CLI 必须 pin（新增风险提示）**：`@deepseek-ai/dsh` 的 npm dist-tag `latest` 已是
   `0.1.2-rc.1`——任何 `npm i -g @deepseek-ai/dsh`（无版本号）或依赖 `latest` 的安装脚本都会
   直接升级宿主。**测试/矩阵一律用 `scripts/dsh-local.sh` 的版本化本地安装 + `DSH_BIN`
   （§5.3），不装全局、不改 PATH**；全局升级只发生在 §6 生产切换那一次（显式
   `@deepseek-ai/dsh@0.1.2-rc.1`）。
6. **锁文件整树换族**：rc.1 基线需在独立 worktree 内重装（node_modules 与 lockfile 按版本
   族互斥，§5.3-依赖基线），不要在现有 rc.2 树上原地 `pnpm update` 混装。

## 5. 多版本兼容测试方案：双轨矩阵（正式环境零影响）

> 本节回答「0.1.2-rc.1 有破坏性更新，怎么在不影响正式环境的前提下验证多版本兼容」。
> 总体思路：**双轨发布 + 版本对矩阵 + 全部验证落在隔离环境 + 生产只在矩阵全绿后同窗切换
> （可回滚）**。

### 5.1 版本对与互跑边界（为什么必须是「双轨」而不是「原地升级」）

| 轨道 | 宿主（@deepseek-ai/dsh CLI） | 插件（ref-lib） | 依赖基线 | 状态 |
| --- | --- | --- | --- | --- |
| **轨道 A（生产，现状）** | `0.1.1-rc.2`（本机 `dsh --version` 即此） | v16.1（0.15.0） | peers `^0.1.1-rc.2` | 绿（现网运行中） |
| **轨道 B（目标）** | `0.1.2-rc.1` | v17（0.17.0，§2 适配后） | peers `^0.1.2-rc.1` | 本文档的验收对象 |

**跨轨道互跑会硬失败（已论证，不必尝试兼容）**。机制（rc.1 复核时修正了初稿的归因）：
插件 client half 经 cordis fiber inject 声明所需宿主服务（v16.1：`['slots', 'workspaces',
'locale']`；v17：`['slots', 'uiWorkspace', 'locale']`）。rc.1 宿主**不提供 `workspaces`**
（该服务随 0.1.2 移除）、rc.2 宿主**不提供 `uiWorkspace`**（`@deepseek-ai/dsh-client-ui-workspace`
在 npm 上没有 rc.2 版本，0.1.2 才发布）→ 注入失败 → client `apply` 不执行、加载期报错。
而 bundle external 里双方都会出现的只有平台词（cordis/react/ui-slots/ui-primitives/
client-locale，两个宿主的 seed 表都有）；ref-lib 对 `dsh-client-runtime` 的 import 全部是
type-only（构建期擦除，不产生运行时 require），初稿「bundle external 命中对方 seed 表缺失
模块」的归因不准确，已修正。node half 方面 v16.1 在 rc.1 宿主会因 `apiProxy` 缺失退化为
「不过滤隐藏会话」（功能退化但可加载），v17 在 rc.2 宿主则缺 `sessionController` 同样退化
——但 client 已先失败，无实际意义。**结论：插件版本与宿主版本族绑定；矩阵按「版本对」
各自验证，不做跨跑兼容；跨跑尝试应由加载 smoke 快速暴露（§5.4-②）。**

因此「多版本兼容」在本方案的精确含义是：**同一份 ref-lib 源码仓库同时维护两个版本轨道的
可发布状态（A 轨分支/标签与 B 轨分支各自锁定依赖族），在任何时候都能按矩阵在隔离环境重放
任一轨道的全部验证，并保证 A 轨（生产）在 B 轨就绪前不受任何 B 轨开发动作的影响。**

### 5.2 矩阵总览与每格验收标准

| 层 | 轨道 A（对照基线，须保持绿） | 轨道 B（验收目标，须达成同集） |
| --- | --- | --- |
| **L0/L1**（纯函数 + 装载/装配） | 现网绿（231 测试含 refresh-triggers/guard 等） | 同一测试集在 rc.1 依赖基线下全绿（预期除 §2.4 两处测试 import/stub 替换外零改动） |
| **L2**（harness 边界回归：写→flush→冷加载 roundtrip + 陷阱守卫） | 绿 | 绿：roundtrip 版本内自洽（rc.1 读路径 layout-tolerant，无需改）；陷阱守卫语义与 rc.2 一致（§4-1-③），断言**不改** |
| **L3**（隔离宿主实跑：插件加载 + `/api/ref-lib/*` 路由 + UI） | dev-isolate 复跑为对照 | dev-isolate（rc.1 宿主）+ 全功能冒烟清单（见下） |
| **数据平面兼容**（A 轨时代产物 → B 轨宿主冷读） | —（同版本自洽） | 在**副本**上断言：sidecar 可读、rc.2 会话日志可读、补过 ignorable 的 legacy 日志可读、投影缓存无需清（§5.4-③） |

**轨道 B 的 L3 冒烟清单（每项断言）**：dock 胶囊渲染；面板 list/add/browse（
`ctx.uiWorkspace`）/手动路径/失效红标；跨会话导入（工作区分组 + 组懒加载 + 冲突页）；
`/ref-lib` 命令专属卡片（commandview keyed 槽位）；`/ref-lib import`；注入 prompt 在
新会话可见；无 console 报错；node half 路由 `/api/ref-lib/*` 全端点可达。

### 5.3 轨道隔离细则（全程不依赖 npm 全局 dsh）

> 想立刻跑 B 轨冒烟，只需两行（其余见下）：
> ```bash
> DSH_BIN="$(DSH_VERSION=0.1.2-rc.1 ./scripts/dsh-local.sh)"
> DEV_HOME="$HOME/.dsh-dev-rc1" PROFILE=ref-lib-rc1 DSH_BIN="$DSH_BIN" ./scripts/dev-isolate.sh
> ```
> 全局 `npm i -g` 的 dsh（`which dsh` 那份，0.1.1-rc.2）全程不被读取/覆盖。

**版本化本地宿主（scripts/dsh-local.sh）**：把 `@deepseek-ai/dsh@<版本>` 幂等安装到
`~/.dsh-tools/<版本>/`（`DSH_TOOLS_DIR` 可换目录；`rm -rf ~/.dsh-tools` 即卸载），并打印其
bin 绝对路径——装的是**用户工具目录**，不是 npm 全局：

```bash
DSH_BIN_RC1="$(DSH_VERSION=0.1.2-rc.1 ./scripts/dsh-local.sh)"   # 轨道 B：rc.1 宿主
DSH_BIN_RC2="$(DSH_VERSION=0.1.1-rc.2 ./scripts/dsh-local.sh)"   # 轨道 A：rc.2 宿主
"$DSH_BIN_RC1" --version    # 断言 0.1.2-rc.1（DSH_VERSION 缺省即 0.1.2-rc.1）
```

**dev-isolate.sh 支持 DSH_BIN**（默认 `dsh`，向后兼容）：所有 `dsh` 调用改走该变量——
不再由 PATH 决定宿主版本，全局 dsh 装什么都没关系。

**依赖基线（两个 worktree，各自一套 node_modules/lockfile）**

```bash
# 轨道 A（现状）＝ main 分支原样：pnpm install 无变化（回归对照）
# 轨道 B：新建 worktree 与分支，避免与 A 的 rc.2 锁文件/依赖树互相污染
git worktree add ../ref-lib-v17 -b feat/v17-rc1
# 在 worktree 内按 §2.1 改 package.json 后
pnpm install            # peer/dev 解析到 0.1.2-rc.1（dist-tag next；必要时临时
                        # auto-install-peers=true 或把新 peer 显式加入 devDependencies）
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # 四道门禁（L0–L2 在此层完成）
```

**隔离运行环境（A/B 各自的 DEV_HOME + profile，真实 ~/.dsh 零接触）**

```bash
# 轨道 A 对照跑（rc.2 宿主 + main checkout）
DEV_HOME="$HOME/.dsh-dev-rc2" PROFILE=ref-lib-rc2 DSH_BIN="$DSH_BIN_RC2" \
  PLUGIN=<main checkout> ./scripts/dev-isolate.sh
# 轨道 B 验收跑（rc.1 宿主 + v17 worktree；插件 worktree 的依赖族与宿主同代：rc.1）
DEV_HOME="$HOME/.dsh-dev-rc1" PROFILE=ref-lib-rc1 DSH_BIN="$DSH_BIN_RC1" \
  PLUGIN=<ref-lib-v17 worktree> ./scripts/dev-isolate.sh
# 两个实例用不同端口/不同时启动；rm -rf ~/.dsh-dev-rc{1,2} ~/.dsh-tools 即完全重置
```

> dev-isolate.sh 现状：以 `DSH_HOME=$DEV_HOME` 调 `dsh plugin add <PLUGIN>` 后启动 web。
> 2026-09-05 起支持 `DSH_BIN`——本节的版本化宿主正是经它注入（不再需要改 PATH、不再需要
> `npm i -g --prefix` 双份全局）。B 轨首次 add 后重启 web 生效。

### 5.4 生产保护措施（「不影响正式环境」的具体保障）

1. **双轨锁定**：正式环境保持「宿主 0.1.1-rc.2 + ref-lib v16.1」直到 B 轨矩阵全绿；B 轨
   开发/验证一律发生在独立 worktree + 独立 `~/.dsh-dev-rc1`，真实 `~/.dsh` 与 web profile
   零接触（AGENTS §5 L3/L4 约定）。
2. **加载 smoke 快失败**：B 轨 L3 启动即断言插件加载成功与 client 注入（dock 可见）；若
   意外出现「插件装进错误版本宿主」的跨跑（§5.1），会在加载期硬失败并红显，不产生静默
   半可用状态。
3. **数据兼容只在副本上验证**：在轨道 A 的隔离环境（`~/.dsh-dev-rc2`）造好数据（若干会话
   sidecar + 一条补过 ignorable 的 legacy `ref-lib/set` 日志 fixture + 普通 rc.2 会话日志），
   `cp -R` 成 rc.1 的数据源副本，再让 rc.1 宿主冷加载并断言：无 `SessionFormatUnsupportedError`
   （legacy fixture 含 ignorable 标记必须被接受）、sidecar 状态/`checkedAt` 正常、投影缓存
   不清也正常（rc.1 宿主内建跨版本读兼容，§1.4-④）。
4. **L4 备份纪律**：任何要动真实 `~/.dsh/sessions` / 真实 profile 的操作（仅 §6 生产切换
   窗口）前整目录备份；先对副本演练一次切换再执行（§6）。
5. **无 pin 即红线**：仓库内安装脚本/文档禁止出现裸 `@deepseek-ai/dsh`（§4-5）。

### 5.5 通过门槛与红灯处理

- **门槛**：B 轨 L0–L2 四道门禁全绿 + L3 冒烟清单全过 + 数据平面副本验证全过 + A 轨对照
  复跑仍绿 → 才允许进入 §6 生产切换。任一红灯 → 停在轨道 A，记录问题回 §2/§3 修订后重跑
  对应格。
- **回归控制**：A 轨作为对照基线每次矩阵执行都复跑（成本低：A 轨依赖树/lockfile 不变，
  L3 只在需要时跑）。

## 6. 生产切换与回滚（执行清单）

```bash
# ── 前置：B 轨矩阵（§5）全绿，含数据平面副本验证 ──

# 1) 发布 v17（0.17.0）到 npm（peer/dev 已对齐 0.1.2-rc.1）
# 2) L4 备份（强制）：整目录备份正式 dsh home 与 profile
cp -R "$HOME/.dsh" "$HOME/.dsh.bak-$(date +%Y%m%d-%H%M%S)"
# 3) 切换窗口（停服状态下同窗完成；顺序不可颠倒）：
#    先升宿主（rc.1 宿主起来后，v16.1 client 会因 inject 的 `workspaces` 服务缺失而
#    加载失败，因此插件升级必须紧随宿主切换，避免半程可用窗口）
npm i -g @deepseek-ai/dsh@0.1.2-rc.1          # 显式 pin，不得无版本号
dsh --version                                  # 断言 0.1.2-rc.1
dsh plugin --profile web add @hpyperry/dsh-ref-lib   # 或升级到 v17
# 4) 启动后冒烟：§5.2 L3 清单（dock/面板/命令/导入/注入）在生产数据上过一遍
# 5) 观察窗（建议 ≥1 天真实使用），异常即回滚：
#    - 回滚 = 还原备份：恢复备份的 ~/.dsh + 降级宿主到 0.1.1-rc.2 + 重装 v16.1
# 6) AGENTS.md 追加 v17 落地注记（门禁结果、L3/L4 结论、回滚触发与否）
```

## 7. v17 实施注记（2026-09-05 落地）

> 本节记录按 §2 落地时与文档计划的实际偏离及验证结果；§2 各 diff 仍可作为重放基准，
> 以下表列为**对计划的有效修订**（实现期对照 rc.1 已安装 npm 产物与类型面逐项核实）：

| 计划（§2/§3） | 落地实际 | 原因 |
| --- | --- | --- |
| `DirectoryEntry/DirectoryListing` 从 `@deepseek-ai/dsh-api-remotes/client` 导入（§2.4/§1.2-1） | 改从 **`@deepseek-ai/dsh-host-directory-picker/types`** 导入（Browser/Dock 两处） | npm rc.1 的 `dsh-api-remotes` tarball **缺 `lib/types/client/`**（package.json 声明的 ./client types 路径不存在）——repo 源码有的收口链没进发布产物；host-directory-picker/types 是规范出处且已发布 |
| peer 新增 4 包 → **17**（§2.1） | 新增 3 包 → **16**：`dsh-api-remotes` **不加**（无 ./client 类型、无任何导入点）；加 `api-session-controller` / `client-ui-chat` / `client-ui-workspace` | 同上；peer 只列实际消费面 |
| devDeps 只换族（§2.1） | 另**新增** `dsh-client-ui-renderer@0.1.2-rc.1`、`dsh-host-directory-picker@0.1.2-rc.1`（均 0.1.2-rc.1 精确 pin） | `ctx.slots` 类型声明在 ui-renderer（§3「经 ui-conversation 传递可达」不成立，须 client 入口 `import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'`）；Directory 类型解析需要包在位 |
| dock 顶层 `sessionId` 不变（§2.3 假定） | `sessionId` 改为取 **`InputZone.session.sessionId`**（`const sessionId = session.sessionId`） | rc.1 dock props 不再直接提供 sessionId（SessionStandardProps 的 sessionId 合并来自未引入的 ui-session 包）；`InputZone.session` 是 `SessionSnapshot`（含 sessionId） |
| `useChat(s => s.legacy.nodes)`（§2.3） | 同，但选择器参数**显式标注** `(s: ChatSnapshot)`（ChatSnapshot 从 `dsh-client-ui-chat/client` 导入） | dock props 的 useChat 经多重声明合并后无上下文推断，隐式 any 报错（noImplicitAny）；显式标注与官方 StatsLine 语义一致 |
| `service.ts` 仅迁 apiProxy（§1.1/§2.4） | 迁移 apiProxy **并**把 v1/v2 旧日志折叠的 `session.events` → **`session.snapshotEvents()`** | rc.1 起 `Session` 不再暴露 `.events`（seq/log-offset 重构改为 `snapshotEvents(fromSeq?, toSeqExclusive?)`） |
| `ctx.sessionController.list({}, signal)`（§1.1） | 同，signal 实参传 `new AbortController().signal` | rc.1 类型签名 signal 为必填 `AbortSignal` |
| L2 陷阱守卫（§4-1-③） | **未改**，231 测试全过 | rc.1 读取路径 `KNOWN || ignorable`（coordinator.ts:1250）与 rc.2 一致 |
| 版本号 | package.json 0.15.0 → **0.17.0**（发布号定版；落地代码先经 0.16.0） | 目标版本 v17 |
| §2.6：AGENTS §2/§3 链接 `develop/basic/` → `docs/cordis-tutorial/` | **未改**（AGENTS 仍指向官网 `<.../develop/basic/>`） | 官网 URL 未确认改版；0.1.2 源码内 `docs/cordis-tutorial` 仅作本地查证路径，不构成对外链接依据 |

**⚠️ 正式环境警示**：v17（0.17.0）依赖族为 0.1.2-rc.1，**只能在 0.1.2-rc.1（及以上）宿主运行**——
若正式环境（宿主 0.1.1-rc.2）的 ref-lib 以「本地 link 本仓库」方式安装，宿主重启即会加载到
v17 client（inject `'uiWorkspace'` 在 rc.2 宿主不存在 → 客户端加载失败）。切换前先确认正式
profile 的 ref-lib 安装形态（npm 发布版 0.15.0 不受影响），并按 §6 同窗升级宿主 + 插件。

**验证结果**：`pnpm typecheck` / `pnpm lint` / `pnpm test`（**231 全过**，含 L2 harness-roundtrip
与陷阱守卫）/ `pnpm build`（tsc + tsdown，client.js 131 kB）四道门禁在 0.1.2-rc.1 依赖基线上
**全绿**；L3 隔离验证（rc.1 宿主 `~/.dsh-dev` + 3090 端口，经 `scripts/dsh-local.sh` +
dev-isolate `DSH_BIN`，全新环境）插件安装/加载成功、`/api/ref-lib/*` 路由在位、服务端无报错
日志；AGENTS.md 已追加 v17 沿革。**待办**：浏览器侧确认（工作区选择不再回跳、dock/面板/命令
卡片在 rc.1 上正常）→ npm 发布 v17 → 按 §6 走正式环境切换窗口。

## 附：版本 / 证据速查表（2026-09-05 核验）

| 项 | 值 |
| --- | --- |
| 核验对象 | deepseek-harness git tag `dsh-v0.1.2-rc.1` = `a66e470204`（2026-09-03 02:27 +0800） |
| alpha.1 基线（初稿核验） | `cd5ef81481`（release/dsh-0.1.2-alpha.1 合并提交） |
| npm 版本 | 全依赖包 dist-tag `next` = `0.1.2-rc.1`；`alpha` = `0.1.2-alpha.5`；`@deepseek-ai/dsh`（宿主 CLI）`latest`/`next` = `0.1.2-rc.1` |
| 删除包（npm 最新仍止于 rc.2 族） | `dsh-client-runtime` / `dsh-host-apiproxy`（最新 0.1.1-rc.2，不再发布） |
| cordis | 仓库 vendored 4.0.1 → 4.0.2；npm `@deepseek-ai/cordis` latest 4.0.2 / next 4.0.1-rc.4；ref-lib peer `^4.0.1` 覆盖 |
| 本机宿主 | `dsh --version` = 0.1.1-rc.2（轨道 A） |
| ignorable 语义 | rc.1 恢复 rc.2 行为（`2c6ff296af` revert）；读取 `coordinator.ts:1250` |
| 会话格式 | `SESSION_FORMAT_VERSION` = 0（`types.ts:87`）；rc.2 → rc.1 日志可读 |
| 关键源码锚点（rc.1） | sessionController.list `api/session-controller/src/index.ts:214`；SessionSummary `types.ts:155`；useChat 合并 `client/ui-chat/.../slots.ts:173-177`；legacy.nodes `.../snapshot.ts:82-98`；commandview `.../slots.ts:209`；dock `ui-conversation/.../slots.ts:127`；Directory 链 `host/directory-picker/types.ts:11` → `api/workspace-controller/types.ts:12` → `api/remotes/client` |
