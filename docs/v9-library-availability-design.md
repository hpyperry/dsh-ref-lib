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

## 14. 遗留备注：UI 反向数据同步（已部分实现）

**问题**：外部变更（目录被删/恢复）与 `/ref-lib` 命令（add/remove/note）修改不会
自动反向同步到 Web UI——面板与胶囊仅在挂载、打开面板、或本 UI 内操作后刷新。

**已实现（2026-08-22）**：候选方案 1——**可见期 30s 静默轮询**（`RefLibDock` 挂载期间
每 30s `refresh(silent)`，失败不打扰用户；成功清除错误）。外部删除/恢复目录后，胶囊
失效角标与面板列表**最多 30s 内自动反向同步**，无需手动刷新。

**负载实测（dev 环境，macOS 本地磁盘）**：

| 指标 | 实测 |
| --- | --- |
| 单请求延迟（4 库） | ~0.7ms |
| 并发 50 请求（模拟 50 会话同刻轮询） | 总耗时 0.101s |
| `statSync` 单次 | 0.003ms |
| 折算 100 会话 × 4 库轮询 | 13.3 次 statSync/s ≈ 0.04ms/s CPU（可忽略） |
| 写盘 | 仅状态变化时（罕见事件） |

结论：每会话每 30s 一次 `GET /list`（node 端内存缓存 + N 次 statSync，毫秒级），多开会话
线性叠加，负载可忽略。

**剩余可选**（暂不做）：候选方案 2 node half 变更推送（webServer 事件 → client 刷新）、
候选方案 3 命令执行后 node half 主动通知 client 刷新——轮询已覆盖同场景，推送只在
需要更低延迟（<30s）或更省请求时再评估。
