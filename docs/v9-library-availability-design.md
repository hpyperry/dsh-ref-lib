# v9 设计：参考库可用性状态（文件夹失效检测）

> 状态：设计待确认（实现前需 review）
> 目标版本：ref-lib v9（依赖基线 dsh **0.1.0-rc.7**，保持不变）
> 范围：**仅可用性状态**。`@` 文件引用选择器（按钮 + 受限树形浏览 + list-dir 路由）整体
> 暂缓，见 §12。

## 0. 版本基线（dsh 0.1.0-rc.7，不随新版本升级）

**决定：新版本 dsh（0.1.0-rc.8 / 0.1.1-rc.1）存在问题，暂不采用；插件继续以 rc.7 为
依赖基线。** 依据：

1. **v9 不需要任何新 harness API**：可用性状态只用到 `systemPrompt.context`（注入）、
   `conversation.input.dock` / `InputZone`（dock 渲染）、`ctx.locale`（本地化）与 node
   内置 `statSync`——全部在 rc.7 具备。
2. **注入机制结论在 rc.7 同样成立**：`system-prompt` 与 `agent-loop` 在 rc.7→rc.8 时
   仅版本号变化（无 src 改动），"每 step `assemble()`、函数式 `text()` 每次重新求值"
   的行为 rc.7 起即如此（§3.3 引用路径不变）。
3. **零依赖变动**：package.json 保持现状（peerDeps `^0.1.0-rc.7`、devDeps 精确
   `0.1.0-rc.7`），node_modules 已是 rc.7，无需 `pnpm install` 变更。
4. 已知（作记录）：npm 上 `0.1.1-rc.1` 已发布（dist-tag `next` 指向它，`latest` 仍为
   坏的 `0.0.1-rc.1`）；本地 harness 仓库 HEAD 已到 `0.1.1-rc.1`。该版本相对 rc.8 的
   改动此前已核查为对 ref-lib 无破坏（webserver 新增 index 注入、ui-conversation 新增
   lineage 槽位等均为纯增量）——**等新版本 dsh 稳定后再评估升级**（届时只需改
   package.json 版本并重跑门禁）。

> **后续更新（v11，2026-08-23）**：上述"暂不采用"决定已落地为升级——依赖基线
> `0.1.0-rc.7` → `0.1.1-rc.2`（peerDeps/devDeps 全部对齐官方 npm 发布惯例
> `^0.1.1-rc.2`）。升级前后逐项核对了 ref-lib 所用接口（`commands.register` /
> `systemPrompt.context` / `webServer.register` / `session/created` / dock 与
> commandview 槽位契约）在 rc.7→rc.2 均未破坏；唯一 breaking
> （`CommandRuntime.execute()` 新增必填 `images` 参数）ref-lib 不直接调用。
> 客户端平台模块（`dsh-client-ui-primitives` / `dsh-client-ui-slots`）在 rc.2 宿主
> 由 Vite shell seed 表内联提供，ref-lib bundle 的 external require 命中 seed。
> 门禁全过（typecheck / lint / 147 测试含 L2 harness-roundtrip / build），并以
> `scripts/dev-isolate.sh`（`~/.dsh-dev` + 3090 端口）验证隔离环境加载与
> `/api/ref-lib/*` 路由。

## 1. 背景与目标

参考库目录在注册后可能被外部删除、重命名，或被替换为文件。当前 `RefLibEntry`
（`{ id, path, note? }`）无任何可用性信息：

- **注入**：失效目录仍会渲染进 systemPrompt，模型可能去访问不存在的路径（浪费 token、
  误导）；
- **UI**：面板/命令无法区分失效条目，用户无从得知"这个库已经没了"。

目标：
1. 数据模型加可用性字段（`status` + 检测时间戳 `checkedAt`）；
2. 注入侧只注入可用库，失效库自动跳过；
3. UI 红色提示失效条目（面板 + dock 角标）；
4. 刷新时机：**每次读取实时探测**（每次对话/每次模型请求即刷新），**仅状态变化时写盘**
   （详见 §3）。

## 2. 数据模型（sidecar v2 → v3）

```ts
/** 目录在文件系统上的可用性（最近一次检测快照）。 */
export type RefLibAvailability = 'available' | 'missing' | 'not-directory'

export interface RefLibEntry {
  readonly id: string
  readonly path: string
  readonly note?: string
  /** 最近一次可用性检测结果；无检测记录（v2/旧事件迁移）时缺省，首访检测。 */
  readonly status?: RefLibAvailability
  /** 最近一次检测的 epoch ms；缺省视为"从未检测"（立即探测）。 */
  readonly checkedAt?: number
}
```

- `missing`：路径不存在（stat 失败）——含被删除、权限不可达。
- `not-directory`：路径存在但不是目录（被替换为文件等）。
- `status`/`checkedAt` **持久化到 sidecar**（v3）：`status` 作为"上次已知状态"（用于
  比较变化与崩溃恢复），`checkedAt` 记录检测时间；sidecar 兼容见 §6。

## 3. 检测与刷新时机（每次读取实时探测，无 TTL 缓存）

### 3.1 探测

```ts
function probeAvailability(path: string): RefLibAvailability {
  try {
    const info = statSync(path)
    return info.isDirectory() ? 'available' : 'not-directory'
  } catch {
    return 'missing'
  }
}
```

**同步 `statSync`**：库数量少（<10）、本地磁盘、单次亚毫秒级。同步形态保持 `list()`
与 systemPrompt 注入回调（`text()` 为同步函数）不变。

### 3.2 `list()` 流程（每次读取都刷新）

```
list(session)：
  1. 取出条目列表（内存缓存 → sidecar → 旧日志迁移 → 父会话继承，现状不变）
  2. 对每个条目实时 statSync 探测
  3. 探测结果与条目当前 status 相同 → 不变更（不写盘）
  4. 探测结果不同 → 更新 status/checkedAt → 写回 sidecar（原子 tmp+rename）
  5. 返回探测后的最新列表
```

- **每次读取 = 每次对话刷新**：`list()` 的调用方即刷新触发点——面板打开/刷新、
  `/ref-lib list` 命令、**每次模型请求的注入回调**（见 §3.3）。
- **写盘只发生在状态变化时**：目录被删/恢复/替换是罕见事件，平时每次读取零写盘；
  探测成本 = N 个 `statSync`（毫秒级），无感知。
- **无 TTL 缓存**：不做"TTL 内读缓存、过期才探测"的优化——探测本身便宜，缓存徒增
  延迟与复杂度。TTL 作为可选兜底见 §3.4。

### 3.3 注入回调频率（rc.7 源码实证，rc.8 / 0.1.1-rc.1 未改此行为）

agent 的 `preStep()` 在**每个 step**（每次模型请求前）都调用 `systemPrompt.assemble()`；
`assemble()` 对函数式 `text()` **每次重新求值、无缓存**
（`packages/core/system-prompt/src/index.ts`）。ref-lib 的注入 context 即函数式
`text()` → **每次模型请求都会调 `list()` 并实时探测**——即"每次对话都刷新"。

因此"外部删除目录"后，**下一次模型请求**（无需任何手动操作）注入即跳过失效库；
轨迹视图里的 "System Prompt Updated"（`ui-trajectory` 比较相邻请求的
`header.system`，仅变化时显示）恰好是"注入已更新"的可见反馈。

### 3.4 可选兜底：TTL 模式（默认关闭）

当库数量很大（数十个）或目录位于慢速网络盘（NFS 等）时，每次探测才有可感知开销。
预留配置 `availabilityTtlMs?: number`（默认 `0` = 每次探测；>0 时改为"TTL 内读缓存，
过期才探测"）。v9 默认每次探测，TTL 仅作为未来兜底开关。

## 4. 注入策略

- `renderRefLibs(libs)`：先 `filterAvailable(libs)` 再渲染；过滤后为空 → 返回 `''`
  （与现有"无库"行为一致，不占用模型上下文 token）。
- 失效库**不注入**：注入的是"可用参考"，失效目录读了也白读，且避免误导模型访问
  不存在路径。UI 与 `/ref-lib list` 命令仍展示全部（含失效标记）。
- `renderLibList`：失效条目追加 `[已失效]`（missing）／`[不是目录]`（not-directory）。

## 5. UI 红色提示

- **面板条目行**：`status !== 'available'` → 红色文字 + 警示图标 + 本地化文案
  （`status.missing`：目录已删除/不存在；`status.notDirectory`：路径不再是目录）+
  行内「移除」（重选路径即先移除再 add）。
- **dock 胶囊**：计数旁加失效数角标（如 `参考库 (2 · 1 失效)`，新增 locale key
  `dock.unavailable`），仅当存在失效条目时显示。

## 6. sidecar 兼容（v2 → v3）

- `SIDECAR_VERSION` 2 → 3；`persistSync` 写 `{ version: 3, libs }`。
- `readSidecar` 兼容 v2：条目缺 `status`/`checkedAt` 照常读入（`isRefLibEntry` 允许
  字段缺失），首次 `list()` 时视为"从未检测" → 实时探测 + 结果落盘（升级自然发生，
  无需专门迁移）。
- 旧日志 `ref-lib/set` 折叠（`foldRefLibs`）产出的条目同 v2 处理（无 status，首访探测）。
- `upsertLib` / `removeLib` 不变；`add()` 新增条目直接写 `status: 'available'`、
  `checkedAt: now`（add 已做 realpath+stat 校验）。

## 7. 逻辑层纯函数（`src/logic.ts`，L0 可测）

```ts
/** 注入过滤：仅保留可用条目。 */
export function filterAvailable(libs: readonly RefLibEntry[]): RefLibEntry[]

/** 探测结果是否与条目当前 status 不同（决定是否写盘）。 */
export function statusChanged(entry: RefLibEntry, probe: RefLibAvailability): boolean
// entry.status === undefined → true（首次探测需落盘）；否则 entry.status !== probe
```

> 不引入 `probeDue`/TTL 决策函数（§3.4 的 TTL 兜底开启时再补）。

## 8. 性能

| 项 | 设计 |
| --- | --- |
| 每次读取成本 | N 个 `statSync`（N = 库数量，本地磁盘亚毫秒级）——每次对话/每次模型请求 |
| 写盘频率 | **仅状态变化时**（目录被删/恢复/替换，罕见事件）；平时零写盘 |
| 全量遍历 | 无（不做索引/扫描） |
| 注入开销 | 每次模型请求 N 个 statSync（与库数量线性，<10 个库无感知） |
| TTL 兜底 | 配置 `availabilityTtlMs`（默认 0 = 每次探测），库多/网络盘场景可开启 |

## 9. 改动清单

### node 端
- `src/spec.ts`：`RefLibAvailability` 类型；`RefLibEntry` 增加 `status?` / `checkedAt?`。
- `src/validate.ts`：`isRefLibEntry` 兼容可选 `status`/`checkedAt`（存在时类型校验，
  缺失允许——v2 兼容）。
- `src/logic.ts`：`filterAvailable`、`statusChanged`。
- `src/service.ts`：
  - `SIDECAR_VERSION` 2 → 3；
  - `probeAvailability(path)`（statSync 封装）；
  - 配置 `availabilityTtlMs?`（默认 0 = 每次探测；预留 TTL 兜底，v9 默认不启用）；
  - `list()`：每次读取对每个条目实时探测；`statusChanged` 为真 → 更新 + `persistSync`
    写回（保持同步形态）；
  - `add()`：新条目写入 `status: 'available'`、`checkedAt: now`。
- `src/render.ts`：`renderRefLibs` 入口 `filterAvailable`；`renderLibList` 失效标记。

### client 端
- `src/client/locales.ts`：新增键（zh 键集唯一来源，en 对齐）：
  `status.missing`、`status.notDirectory`、`dock.unavailable`（N 个失效）。
- `src/client/RefLibPanel.tsx`：条目行失效态（红色 + 图标 + 文案 + 「移除」）。
- `src/client/RefLibDock.tsx`：失效计数角标。
- `src/client/data.ts`：类型随 `RefLibEntry` 扩展（`status` 字段透传）。

### 依赖
- **零变动**：保持现状——peerDeps `^0.1.0-rc.7`、devDeps 精确 `0.1.0-rc.7`（与 node_modules
  一致，无需 `pnpm install`）。v9 不依赖任何 rc.8 / 0.1.1-rc.1 新特性（见 §0）。
- **不新增**任何依赖（本计划不需要 `dsh-client-ui-input-trigger` 等——那是 `@` 引用
  选择器暂缓项要的）。

### 构建
- `tsdown.config.ts`：**无改动**（无新 external / 无新依赖）。

## 10. 测试清单（分层，AGENTS.md §5 门禁）

- **L0** `tests/logic.spec.ts`（扩展）：`filterAvailable`（全失效 → 空 / 混合过滤 /
  全可用不变）；`statusChanged`（缺 status → true；相同 → false；不同 → true）。
- **L0** `tests/service.spec.ts`（扩展，临时 root 注入）：
  - 每次读取实时探测：目录存在 → available；删除 → 下一次 `list()` 即 missing；
    恢复 → 重新 available；替换为文件 → not-directory；
  - 状态变化写回：删除目录后 `list()` → sidecar 文件内容断言 status=missing、
    checkedAt 更新；状态未变时 `list()` 不写盘（mtime/内容不变断言）；
  - v2 sidecar（无 status 字段）→ 首访探测并升版写回 v3；
  - `add()` 新条目初始 status = available。
- **L0** `tests/render.spec.ts`（扩展）：失效过滤（含全失效 → `''`）、`renderLibList`
  失效标记。
- **L0** `tests/validate.spec.ts`（扩展）：v2 条目（无 status/checkedAt）通过；status
  非法值 / checkedAt 非数字 → 拒绝。
- **L0** `tests/locales.spec.ts`：现有键对等测试自动覆盖新增 key。
- **L1** `tests/loader.spec.ts`：现有装配测试保持通过（无新服务依赖）。
- **L2** `tests/harness-roundtrip.spec.ts`：**不动**（无会话日志写入）。
- 门禁：`pnpm typecheck && pnpm lint && pnpm test && pnpm build`。

## 11. 风险与取舍

- **statSync 阻塞**：同步探测在注入回调（agent 轮次）里执行，单次亚毫秒级、库数量
  <10，无感知；若库数量大/网络盘，开启 `availabilityTtlMs` 兜底。
- **写盘时机**：探测结果变化即同步写盘——发生在注入回调内（罕见事件，一次原子写），
  可接受；也可改为"变化仅更新内存，下一条管理写路径落盘"（复杂度换写频，v9 不做）。
- **失效注入策略**：完全跳过（默认）——失效目录不占 token、不误导模型。
- **不破坏兼容**：sidecar v2 无缝升版；`list` 路由响应多两个可选字段，现有 client
  解析不受影响。

## 12. 暂缓：`@` 文件引用选择器（v9 范围外）

先前讨论的"按钮 + 受限树形选择器"（dock「引用文件」按钮、`RefLibPicker` 树形浏览、
`GET /api/ref-lib/list-dir` 受限列目录路由、`slash/input-insert-text` 插入通道）整体
**暂缓**，不纳入 v9。理由：需求优先级调整，先落地可用性状态。设计要点已在此前的
评审讨论中沉淀（含"官方 `@` 全量遍历 + tool/result 失效的性能问题"、"host
`listDirectory` 只返回子目录、无法限制范围"等结论），后续启动时再成稿。

## 13. 待确认项

1. 每次探测 + 变化才写盘（默认）——确认不再需要 TTL 缓存。
2. 失效注入策略：完全跳过（默认）vs 注入"已失效"占位说明。
3. dock 角标文案：`参考库 (2 · 1 失效)` 是否合适。
4. `status`/`checkedAt` 持久化到 sidecar v3（默认）vs 仅内存缓存（sidecar 格式不变）。
5. 写盘时机：探测变化即同步写回（默认）vs 仅内存更新、延迟落盘。

## 14. UI 反向数据同步（交互驱动，无后台轮询）

**问题**：外部变更（目录被删/恢复）与 `/ref-lib` 命令（add/remove/note）修改不会自动
反向同步到 Web UI。

**最终方案（2026-08-22 用户决策）**：**交互驱动刷新，移除后台轮询**——UI 在以下
GUI 交互时即时同步：

| 触发 | 机制 | 延迟 |
| --- | --- | --- |
| `/ref-lib` 命令完成 | 会话快照中 ref-lib 命令节点 settled 计数 +1（command/run → done） | 即时 |
| 发消息 | 会话快照中 user 消息节点计数 +1 | 即时 |
| 面板操作（add/remove/note） | 操作后 refresh | 即时 |
| 外部文件操作（删/恢复目录） | 下次任意 GUI 交互时同步（无事件源，接受延迟） | 交互时 |

**取舍**：外部文件变化在用户不做任何 GUI 操作时 UI 不更新——低频只读场景可接受。
**注入侧不受影响**：每次模型请求的注入回调仍实时探测（node half `list()`），与 UI
刷新完全解耦——核心价值（模型读到最新参考库）零损失。

**过程中的轮询尝试（已废弃）**：曾实现 30s 可见期轮询（挂载期间 `setInterval` 静默
`refresh(silent)`），负载实测可忽略（单请求 ~0.7ms、并发 50 请求 0.101s、statSync
0.003ms、100 会话 × 4 库 ≈ 0.04ms/s CPU）——但低频场景不值得保留后台请求，最终
按用户决策移除，UI 同步回归交互驱动。

**竞态防护**：所有刷新源（命令/发消息/操作/挂载重试/会话切换）共用 `RefreshGuard`
（`src/client/refresh-guard.ts`，只接受最后发起的请求结果，`tests/refresh-guard.spec.ts`
钉死并发/乱序/作废行为）——见 §15。信号派生（`userMessageCount` / `refLibCommandDone`）
的 rc.7 前提查证与脆弱点清单见 **§16**。

## 15. 并发与竞态分析（RefLibDock 数据同步）

并发源：挂载预载重试（[sessionId] effect）、打开面板刷新（[open] effect）、
发消息刷新（[userMessageCount] effect）、命令完成刷新（[refLibCommandDone] effect）、
操作后 refresh（add/remove/setNote）、sessionId 切换。
防护：`RefreshGuard`（只接受最后发起的请求结果）、`busy`/`removingId` 禁用 UI（操作串行）、
effect cleanup（stopped/timer/clearInterval）。

| # | 场景 | 分析 | 风险 |
| --- | --- | --- | --- |
| 1 | 响应乱序（先发后至） | RefreshGuard 丢弃旧发起者，只接受最后发起 | 无 |
| 2 | 打开面板 vs 发消息/命令刷新 | 数据同源，后发起者接受，结果一致 | 无 |
| 3 | UI 操作（add/remove/note）vs 发消息/命令刷新 | 操作后必有 refresh（最后发起）→ 其他刷新源的旧快照被丢弃 | 基本安全；仅操作后 refresh 失败才短暂旧数据（有错误提示，下次交互纠正） |
| 4 | `/ref-lib` 命令操作 | 命令完成 → 快照 command 节点 settled → **即时刷新**（无需发消息/轮询） | 无（已由 refLibCommandDone 钩子覆盖） |
| 5 | sessionId 切换 | cleanup + RefreshGuard 递增 → 旧会话 in-flight 结果丢弃 | 无 |
| 6 | 静默刷新吞操作错误 | **已防护**：silent 刷新成功不 `setError(null)`——错误槽只由用户操作/打开面板管理 |
| 7 | 静默刷新干扰面板 loading | **已防护**：silent 刷新不碰 loading（`setLoading(false)` 仅非 silent） |
| 8 | 并发操作 | busy 禁用 UI，串行执行 | 无 |

**架构结论**：所有 fetch 竞态（含启动 404）的根源是"client 拉取"数据通道。官方 dock
插件（goal/queue）用 **session 投影**（宿主推送 + `useProjection`，零 fetch 零轮询）——
天然无 404、无轮询、无竞态。`ctx.sessionProjections.register` 为插件可扩展（已查证），
但 ref-lib 数据源在 sidecar（无会话事件）且可用性需实时 statSync，**纯投影不成立**
（§15 架构结论 2026-08-22 更正）——当前交互驱动刷新 + RefreshGuard 是 pull 模式下
的务实方案。

## 16. 交互驱动刷新：rc.7 前提查证记录与脆弱点清单（2026-08-23）

**背景**：交互驱动刷新（`userMessageCount` / `refLibCommandDone` 两个快照派生钩子）
的成立依赖若干 harness 行为。为确认「在 rc.7 及以前是否脆弱、是否受其他插件事件流
影响」，对 deepseek-harness 仓库 `dsh-v0.1.0-rc.7` tag 逐条核对源码，并对
rc.7 → rc.8 → 0.1.1-rc.1 做了差异比对。

### 16.1 前提核对（rc.7，全部成立）

| # | 前提 | rc.7 源码依据 | 结论 |
| --- | --- | --- | --- |
| 1 | dock 槽位的 `session` 是响应式快照，每次会话 store 发布重渲染 | `ui-conversation/src/client/contract/slots.ts`：`InputZone { session: ConversationSnapshot; input: InputState }`（"dispatching skeleton re-renders on either store's change"）；`skeleton/ConversationRoot.tsx`：`useSession(s => s)` → `renderSlot('conversation.input.dock', zone)` | ✅ |
| 2 | 发消息产生 `kind: 'user'` 节点 | `conversation-nodes/message.ts`：`user/message`（`source.kind==='user'` 且未被收件箱认领）→ `UserMessageNode`；非 user source → `context`；认领 → `steering` | ✅ |
| 3 | 命令完成体现为 command 节点 running → settled | `interaction/commands/src/index.ts`：`execute()` 先 append log-only `command/run`（`name: parsed.name`、`outcome` 未定），handler 结算后 append `command/done`（`kind: success\|error`）；未匹配命令**不记任何事件**；命令名正则 `^[a-z][a-z0-9_-]*$`、无别名、重名注册 fail loud | ✅ |
| 4 | 信号事件发布节奏及时 | 两个 Definition 未声明 `publication` → 默认 `'immediate'`（microtask flush，`conversation-assembler.ts`）；流式 chunk 为 `'animation-frame'`（`conversation-nodes/assistant.ts`），不触发 user 计数 | ✅ |
| 5 | 命令完成时数据已落盘 | ref-lib 命令 handler **await** `refLibs.add/remove` 后才返回 → 客户端看到 settled 时 sidecar 已更新，随后的 GET 必是新数据 | ✅ |

### 16.2 其他插件事件流影响结论

**正确性上不脆弱：其他插件的事件流不会造成假刷新，也不会吞掉刷新。** 依据：

- 所有插件事件（goal/queue/context 注入等）进**同一个会话 store**，dock 确实随每次
  发布重渲染——但两个 effect 依赖的是**派生计数**而非事件本身；其他插件事件无法
  改变这两个计数：
  - goal 续行轮次写成 `user/message` 但 `source: {kind:'goal', …}`
    （`goal/goal-round-driver/src/index.ts`）→ 客户端折叠为 **`context`** 节点，不增
    `'user'` 计数；官方插件无任何写 `source.kind === 'user'` 的 `user/message`
    （那是 agent loop 的人类输入专属通道）；
  - 其他插件命令（`/goal`、`/plan`）的 `CommandNode.name` 不同；同名注册冲突在
    注册期 fail loud；
  - 事件按 seq 顺序进 store，不存在被其他事件流遮蔽的机制。
- 多余/重叠刷新由 `RefreshGuard` 吸收（只接受最后发起者）。

### 16.3 脆弱点清单（按严重度）

1. **漏刷新窗口（功能层）**
   - **忙碌期发消息**：宿主在 `core/agent-loop/src/agent.ts` 是 **step 领取消息时才
     append `user/message`**，非 prompt 受理时——排队消息的计数延迟到进入步骤；
   - **steer 打断消息**：永远折叠为 `'steering'` 节点，**完全不触发** `userMessageCount`；
   - **`command/run` 落在窗口外**（压缩/截断把 run 切出窗口）：`CommandNode.name`
     为 null → `name === 'ref-lib'` 过滤漏掉 → 该次命令完成不刷新；
   - 外部文件操作无会话事件 → 不刷新（设计已接受的取舍，注入侧不受影响）。
2. **重渲染耦合（性能层）**：dock 在**每次** store 发布时重渲染（其他插件事件、流式
   帧、queue 快照变化），组件每次渲染跑节点派生——成本 = 事件率 × 节点数；长会话 +
   高事件流下需注意（已优化为单次遍历，见 16.4）。
3. **窗口长度抖动**：loadOlder / 压缩 / 断线补拉重建节点列表，计数可能增减 → 额外
   静默刷新（RefreshGuard 吸收，良性但要知道）。
4. **零测试覆盖（已修复，见 16.4）**：钩子派生原在组件内部，harness 对这些表面的
   改动（node kind / name 语义 / InputZone 响应性 / 发布节奏）不会使任何测试失败。

### 16.4 已落地防护（2026-08-23）

- 派生逻辑提取为**纯函数** `deriveRefreshTriggers(nodes)`（`src/client/
  refresh-triggers.ts`，单次遍历同时派生两个计数），RefLibDock 的 effect 依赖改为
  其返回值；
- 新增 `tests/refresh-triggers.spec.ts` 钉死契约：user 计数、运行中不计、成功/失败
  结算都计、其他命令隔离、`name: null`（run 出窗口）不计、steer/context/tool 不计、
  混合场景单次遍历、窗口变化增减计数；
- 函数签名使用 harness 的 `ConversationNode` 类型——harness 若改动节点形状，
  **typecheck 即失败**（编译期防线，而非仅运行时行为）。

### 16.5 版本差异说明

- 参考库仓库**最老 tag 即 `dsh-v0.1.0-rc.7`**，rc.6 及更早无法从参考库查证；dock
  槽位、InputZone 响应式 `session`、会话 Definition 折叠、log-only `command/run+done`
  配对在 rc.7 全部存在且互相咬合（本插件的开发基线）。
- rc.7 → rc.8 差异比对：`ConversationRoot` 仅 HeroShell 传参；`message.ts` 仅给
  user/steering 加可选 `referenceLabels`（kind 不变）；`commands` 执行器仅加图片附件
  支持（`command/run`/`command/done`、`name`、`source` 语义不变）——**该机制在
  rc.8 / 0.1.1-rc.1 语义一致**（当前 0.1.1-rc.1 checkout 的 InputZone 契约注释原样
  保留）。

## 17. fork 分支会话：参考库继承物化（2026-08-23）

**背景**：dsh「分支会话」在宿主创建**新会话**——`SessionStore.fork()`（core/session
`src/index.ts:1081`）铸造新 id（`session-<n>`）、seed 父会话事件 `[0..boundary]`、
header 写入 `parentSession: 源会话id`（:1091）；客户端聊天「分支」`forkAt(seq)`
（ui-conversation `apply.ts:419`）→ `sessions.fork`（runtime `manager.ts:588`）→
RPC `session.fork`。即：**fork 后 session 变化（新 id、新对象）**，参考库不会自动
跟随。

**发现的问题（v3 惰性继承）**：ref-lib 旧实现只在冷读时经 `header.parentSession`
读**直接父会话的文件**：
1. **链式断口（已复现）**：A→B→C 分支链中，若 B 从未落盘自身 sidecar（只读继承 +
   无变更），C=fork(B) 继承不到 A 的列表（C 得空列表）；
2. **继承时机漂移**：继承的是父会话**当前**列表（首次读取时），非 fork 边界处的
   快照；且惰性继承在子会话首次读取前不落盘。

**方案（fork 触发直写文件，无新增 webServer 接口）**：
1. **`session/created` 钩子（唯一路径）**：`RefLibService` 构造时注册
   `ctx.on('session/created', ..., { global: true })`（与 core/tools 的 seed 钩子
   同款，忽略上下文过滤；监听器绝不抛错——announce 契约：session/created 监听器
   同步抛错会回滚会话挂载）。子会话带 parentSession 且无自身 sidecar 时，把父会话
   **有效列表**（优先经 live 父会话解析，兜底读其文件）复制到子会话自身文件——
   继承时机提前到 **fork 时刻**（确定性快照），链式断口修复（每级都落盘）。
   **不经过 HTTP**：钩子直写 sidecar，UI 无新通道——fork 后打开子会话，dock 挂载的
   现有 `load()`（GET /list）一次刷新即可读到（2026-08-23 简化决策：曾短暂新增
   `POST /api/ref-lib/inherit` 兜底路由，确认正常流程用不上后移除）。
2. **复制而非逐条 list+add**：add() 会重复校验路径、重读 README 提取 note（IO 且
   可能改变 note）、逐条写盘；复制等价且单次写盘。
3. **条目 id 重新铸造（2026-08-23 用户决策）**：物化复制时每个条目生成新
   `randomUUID`——fork 副本拥有**独立身份**，不与父会话共享条目 id。理由：同 id
   的「关联价值」是瞬时的（任一侧一变更即断裂，留不住），且避免未来跨会话功能/
   审计混淆；删除互不影响（per-session sidecar 隔离）与 id 无关，保持不变。
   惰性兜底路径以同一语义（重新铸造 id + 落盘）服务 legacy 子会话——**必须落盘**，
   否则每次冷读重新铸造会导致重启后 id 漂移。
4. **惰性 parentSession 兜底保留**：服务旧版本创建的 legacy 子会话（无自身文件）
   首次读取时按同一语义物化（重新铸造 id + 落盘）；此后与物化过的子会话行为一致。

**语义变化**：继承时机从「首次读取」变为「创建时刻」；子会话创建即落盘（有父库
时）且条目 id 独立，父会话后续变化不再回流（含未读取过的子会话）。注入侧同路
（systemPrompt 上下文贡献同样继承）。

**测试**：`tests/service.spec.ts` fork 物化 5 用例（触发即落盘且 **id 重新铸造**、
链 A→B→C、已有自身状态不被覆盖、父无库不落盘、普通创建不触发）+ 惰性兜底用例
（重新铸造 id + 落盘 + 再次读取 id 稳定）；路由族测试不变（未新增路由）。
