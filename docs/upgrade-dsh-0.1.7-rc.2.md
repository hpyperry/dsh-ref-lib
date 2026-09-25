# dsh 最新代码评估与升级方案（0.1.2-rc.1 → 0.1.7-rc.2）
## —— ref-lib 存在意义复核 + 实测破坏面 + 「单包多宿主」兼容路线

> 状态：**评估定稿**（2026-09-25；对照 deepseek-harness `HEAD` = tag `dsh-v0.1.7-rc.2`
> 逐项查证 + **在两份真实依赖族上实测**）。本文档只做评估与方案，**未改动任何源码**。
> 落地目标版本：ref-lib **v18**（当前 v17 / 0.17.0）。
> 依据：
> - 参考库 checkout `/Users/hpy/dev/PROJECTS/deepseek-harness` @ `477b4f4205`（tag `dsh-v0.1.7-rc.2`，
>   2026-09-25；root `package.json` version `0.1.7-rc.2`）——**只读查证**，未做任何写入；
> - 本机运行宿主 `dsh --version` = **0.1.2-rc.1**（`~/.local/share/fnm/.../@deepseek-ai/dsh/package.json`）；
> - npm registry dist-tags（2026-09-25 实测，见 §1.2）；
> - **探针工程实测**：把本仓库源码复制到 `.probe-017/`（评估后已删除），peer/dev 全族换到
>   `0.1.7-rc.2` 后 `pnpm install` + `tsc --noEmit` + `vitest run`，得到本文档 §3.1 的
>   客观破坏面清单（复现命令见 §6.1）。

---

## 0. 结论摘要（TL;DR）

**结论一：ref-lib 仍然有存在意义，而且不可替代的核心只剩两块——但它现在也是"薄插件"了。**
平台在 0.1.3→0.1.7 期间补齐了**上下文注入的机制层**（`@file`/`@session` 提及、skill 目录、
AGENTS.md 链、右栏 tab 注册表），但**没有任何内建能力提供「per-session、用户运行时自选、
带用途说明、每次请求强制注入路由策略」的只读目录清单**。详见 §2（对照表 + 反事实推演）。

**结论二：升级面极小，且已被实测钉死。**
在 `0.1.7-rc.2` 依赖族上，本仓库 **23 个类型错误全部来自同一处破坏**（ui-primitives 图标
改名），**231 个测试 229 通过、2 个失败全部来自同一处破坏**（`JsonlSessionPersistence`
改默认导出）。**其余 node API 面与全部 client 槽位/服务/类型零破坏**（逐条清单见 §3.3）。

**结论三：本次不需要 v17 那套「双轨发布」。单包可同时跑 0.1.2-rc.1 … 0.1.7-rc.2。**
跨版本差异只在**图标的导出名**（0.1.7 起 `Icon*16` → `Icon*<Weight>`），而图标是
**运行时从宿主 seed 模块表取的外部模块**——一个约 40 行的运行时兜底（§4.2 / §5.2）就能让**同一份
client bundle** 在 0.1.2/0.1.5/0.1.7 三代宿主上都正确渲染。peer 区间 `^0.1.2-rc.1`
**继续保留**（实测它满足 0.1.7 新引入的 peer preflight，且不含 0.2.x，§5.4）。

**结论四：两处必须纠正的"过期事实"（文档级，非数据级）。**
- **旧日志可读性声明已失效**：`SESSION_FORMAT_VERSION` 从 0 一路升到 **4**，而 v0→v1 迁移边
  **拒绝未知历史事件——即使带 `ignorable: true`**。所以 AGENTS.md §5 注 2 与 `service.ts`
  注释里"含 ignorable 标记的旧日志仍可读"在 ≥0.1.3-alpha.2 的宿主上**不再成立**。
  **本机实测（§6.3）真实 `~/.dsh/sessions` 零命中**，所以这是文档纠正，不是数据救援。
- **`session.snapshotEvents()` 已 `@deprecated`（"new calls are prohibited"）**，我们唯一的生产
  调用点在 `src/service.ts` 的 legacy 折叠路径；要么随 legacy 路径一起删，要么显式加 lint 豁免。

**结论五：三个"可选的现代化红利"，均非升级必需**（§3.4 / §7.3）：
右栏 tab（`ctx.sidebarRightTabs`，0.1.5-alpha.1 起在位，可把 Modal 面板升级为常驻面板）、
`workspaceRegistry.pinnedSessionIds`（导入来源排序与侧边栏同口径）、
`ctx.uiWorkspace.createDirectory`（原生目录浏览器的"新建文件夹"对齐）。

---

## 1. 「最新代码」到底是哪一版：三个不同的"最新"

评估这件事先要分清三个坐标，否则结论会自相矛盾（本机宿主、npm 稳定通道、checkout HEAD
**三者不是同一版**）。

### 1.1 三个坐标（2026-09-25 实测）

| 坐标 | 版本 | 证据 |
| --- | --- | --- |
| **本机运行宿主** | `0.1.2-rc.1` | `dsh --version`；`~/.local/share/fnm/node-versions/v22.22.3/installation/lib/node_modules/@deepseek-ai/dsh/package.json` version |
| **参考库 checkout HEAD** | `0.1.7-rc.2` | `git -C /Users/hpy/dev/PROJECTS/deepseek-harness describe --tags` → `dsh-v0.1.7-rc.2`；HEAD `477b4f4205`（2026-09-25） |
| **npm `@deepseek-ai/dsh` dist-tags** | `latest` = `0.1.5-rc.3`；`next` = `0.1.7-rc.2`；`alpha` = `0.1.7-alpha.2` | `curl -s https://registry.npmjs.org/@deepseek-ai%2Fdsh` |

> ⚠️ 含义：**无版本号执行 `npm i -g @deepseek-ai/dsh` 拿到的是 0.1.5-rc.3（不是 HEAD 的 0.1.7-rc.2）**。
> "最新代码"（本文档的评估对象）是 **checkout HEAD = 0.1.7-rc.2**；"最容易被装上的"是
> **0.1.5-rc.3**。两者对我们的破坏面**不同**（图标改名只发生在 0.1.7 线），所以 §5 的方案
> 必须同时覆盖两者。

### 1.2 依赖族发布情况（实测，全部 19 个我们消费的包）

| 包 | `next` | 是否有 `0.1.5-rc.3` | 是否有 `0.1.7-rc.2` |
| --- | --- | --- | --- |
| `dsh-api-session-controller` / `dsh-client-ui-chat` / `dsh-client-ui-slots` / `dsh-workspace` / `dsh-session-persistence(-jsonl)` / `dsh-client-ui-renderer` / `dsh-host-directory-picker` … | 均为 `0.1.7-rc.2` | ✅ | ✅ |
| `@deepseek-ai/cordis` | `latest` = **4.0.4** | — | —（peer `^4.0.1` 覆盖） |

结论：**两个版本族都在 npm 上完整可得**，所以「按哪一版做基线」是纯工程选择，不受发布阻塞。
（`latest` 这个 dist-tag 在多数子包上停在 `0.0.1-rc.1` 之类的旧号，**只有 `next` 是当前族**——
不要用子包的 `latest` 判断当前版本。）

### 1.3 版本时间轴与工作量规模

```
0.1.2-rc.1 ── 0.1.3-alpha.1/2 ── 0.1.5-alpha.1/2 ── 0.1.5-rc.1/2/3 ── 0.1.6-alpha.1/2 ── 0.1.7-alpha.1/2 ── 0.1.7-rc.1/2
（本机宿主 / v17 基线）                                                                    （HEAD，本文评估对象）
```

`git log dsh-v0.1.2-rc.1..dsh-v0.1.7-rc.2 --no-merges` = **3432 个提交**。平台改动量巨大，
但**落到 ref-lib 的消费面上只有两处**（§3）——这正是本文档的核心发现。

---

## 2. 存在意义复核：ref-lib 还有必要存在吗？

### 2.1 ref-lib 提供的产品面（拆成可独立评判的 7 项）

| # | 能力 | 现状实现 |
| --- | --- | --- |
| C1 | per-session、**用户运行时**自选的只读目录清单（可指向 workspace 之外的任意目录） | sidecar JSON（`<dshHome>/plugin-data/ref-lib/<sid>.json`）+ dock/面板 + `/ref-lib` 命令 |
| C2 | 每个目录带**人写的用途说明（note）**，作为 routing metadata 进入模型上下文 | `render.ts` 定稿英文模板 |
| C3 | **强制性的检索/权威性策略**：先查参考库、再 web/记忆；note 只是路由元数据不是权威证据；冲突显式上报；外部来源需自报 | 同上（静态模板 + 动态清单） |
| C4 | 可用性探测（missing / not-directory）→ 不注入死路径 + UI 红标 | `probeLibs` + `filterAvailable` |
| C5 | 跨会话导入（工作区分组 / 懒加载 / 冲突 diff） | v12–v16 状态机 + `/api/ref-lib/sessions` 三级契约 |
| C6 | fork 分支继承（物化 + 重新铸造 id） | `session/created` 钩子 |
| C7 | 专属 UI：输入卡上方胶囊、管理面板、/ref-lib 命令全展开卡片 | `conversation.input.dock` + `conversation.chat.commandview` |

### 2.2 平台内建对照表（HEAD 实测）

| 内建能力 | 它是什么 | 与 ref-lib 的重叠 | 证据 |
| --- | --- | --- | --- |
| `context/file-reference` + `-local` + `client/ui-reference` | `@file`/`@folder`/`@session` **逐条提及**补全；provider 索引以会话 cwd 为根；选中只插入提示文本，不读内容 | **部分重叠 C1**：可临时指路，但**无持久化、无 note、无策略、无法指 workspace 之外的目录** | `packages/context/file-reference/README.md`；`ui-reference/README.md` |
| `context/session-reference` | `@[label](dsh-session:…)` → 另一会话的**有界只读快照**作为 durable user 消息 | **部分重叠 C5 的意图**，但对象是"会话转写"而非"目录清单" | `packages/context/session-reference/README.md` |
| `context/agent-instructions` | `$DSH_HOME/AGENTS.md` + 项目链，**按路径派生**、按字节预算注入 | **部分重叠 C2/C3 的机制**，但目录集合由路径决定、非用户自选、无 note | `packages/context/agent-instructions/README.md` |
| `skill/*`（`skill-filesystem` / `tool-skill`） | skill 目录发现（`<project>/.dsh/skills`、`<dshHome>/skills`、`customSkillDirs`…）+ `skill` 工具返回 `resourceBase` | **部分重叠 C1/C2**：这是"受控只读文档集"的**新惯用法**；但根目录是 **profile 配置**、非 per-session 运行时增删；note 只有 frontmatter `description`/`whenToUse`；无"先查此处"策略 | `packages/skill/skill-filesystem/README.md` |
| `workspace/workspace`（`ctx.workspaceRegistry`） | 命名工作区 + 会话分组 | **零重叠**：README 明示"invisible to models，不加 prompt/请求上下文成本" | `packages/workspace/workspace/README.md` |
| `host/directory-picker*` | GUI 选目录 | **零重叠**：README 明示"**multiple roots are unsupported**" | `packages/host/directory-picker/README.md` |
| `sandbox/*` + `fs/fs-sandbox` | `workspace-write` 可写白名单 = workspaceRoot + tmp；其余进程级只读 | **零重叠，但反向确认了 C1 的 L1 只读前提仍然成立**：没有任何"用户声明的额外 ro/rw root"机制 | `packages/sandbox/sandbox/src/roots.ts:47` |
| `storage/storage-domain` + `storage-json` | schema 校验的 KV 域，`single` 布局 = 原子写单 JSON | **零重叠（是 C1 的存储层替代品）**：文档把 "session sidecar metadata" 列为用例 | `packages/storage/storage-json/README.md` |
| `client/ui-sidebar-right` | 右栏 docking surface + `ctx.sidebarRightTabs` tab 类型注册表 | **零重叠（是 C7 的 UI 载体替代品）** | `packages/client/ui-sidebar-right/README.md` |
| `settings/*` + `configure({auto:false})` | 配置表单 | **零重叠**：profile 配置域，装不下 per-session 运行时数据 | `packages/settings/settings/README.md` |
| `host/plugin-inventory` / `session/session-projection` | 只读投影 | **零重叠 / 不适用**：前者 Remote-only 无 Context 合并；后者折叠**已提交会话事件**，而本插件刻意不写日志 | 各自 README |

**概念搜索（负责"是否在规划中"的判定）**：在 `packages/`、`docs/`、`.agents/notes/**` 全库检索
`reference library` / `knowledge base` / `read-only root` / `routing metadata` / `curated context`
以及 `additionalRoots|extraRoots|readOnlyRoots|additionalPaths` —— **零命中**（仅命中
native sandbox 的 `--ro/--rw` argv 文档与一条无关的 error-taxonomy 笔记）。**平台既没有实现、
也没有在规划这个产品。**

### 2.3 结论：不可替代的三点 + 已被"平价化"的四点

**仍然独有（平台没有任何等价物）**
1. **C1** per-session、**运行时**由用户增删的**任意目录**清单（含 workspace 之外）。
2. **C3** 路由/权威性策略文本：`先查参考库 → 再 web/记忆`、`note 仅为路由元数据非权威证据`、
   `冲突必须显式上报`、`外部来源必须自报 "Not in reference library; external source used."`、
   `严格只读`。平台内建里最接近的 `FILE_REFERENCE_PROMPT` **只说"声称看过之前先 read"**。
3. **C4 + C5 + C6** 组合：可用性探测与死路径不注入、跨会话导入的去重/冲突 diff/工作区分组、
   fork 时刻的确定性物化继承。

**已被内建"平价化"（未来可选瘦身方向，非本次必需）**
1. **存储层**：手写 sidecar + 原子写 + realpath 校验 → 可换 `ctx.storageDomain` + `storage-json`
   的 `single` 布局（文档明确把 "session sidecar metadata" 列为用例）。
2. **通道**：`/api/ref-lib/*` + fetch → 可换 Typert Remote（`ctx.remote.*`）。**但本次不建议**：
   cookbook 全是 monorepo 内部口径，命名空间清单在 first-party 源码里，CLI 无生成命令，
   **没有任何第三方 Remote 先例**；而 `docs/subsystems/web-server.md` 明确背书"插件自注册路由"。
3. **note/路由元数据**在概念上与 skill frontmatter 部分重合。
4. **`@` 手动指路**已被 `file-reference` 覆盖。

**如果今天重写**：会是一个薄插件——「durable sourced session message（或 `systemPrompt.context`）
+ storage-domain 持久化 + 一个 dock 入口」，把发现交给 `file-reference`。但**今天不必重写**：
现有实现没有正确性问题（L1 只读前提在 HEAD 依然成立），风险是"维护漂移"，不是"错误"。

> **一句话结论**：**机制层已被平台追平，产品层仍然独有。** 值得继续维护，但应按 §7.3 的机会
> 逐步减重，而不是继续加功能。

---

## 3. 影响分析：破坏面（全部实测，不是推断）

### 3.1 探针实测：方法与原始结果

把本仓库（`src/` `tests/` `scripts/` `docs/` `tsconfig.json` `tsdown.config.ts`
`vitest.config.ts` `eslint.config.js` `.npmrc` `pnpm-workspace.yaml`）复制到 `.probe-017/`，
peer 由 `^0.1.2-rc.1` → `^0.1.7-rc.2`、devDeps `0.1.2-rc.1` → `0.1.7-rc.2`，然后：

```bash
cd .probe-017 && pnpm install          # 4m36s，成功；解析到的关键包全为 0.1.7-rc.2，cordis 4.0.4
./node_modules/.bin/tsc --noEmit       # → 23 个错误，全部是图标（下表）
./node_modules/.bin/vitest run         # → 229 passed / 2 failed（仅 L2 两个用例）
```

实测解析版本（抽样）：`dsh-client-ui-primitives` `dsh-client-ui-slots` `dsh-session`
`dsh-system-prompt` `dsh-commands` `dsh-host-webserver` `dsh-session-query`
`dsh-api-session-controller` `dsh-home-paths` `dsh-workspace` `dsh-client-ui-conversation`
`dsh-session-persistence-jsonl` = **全部 `0.1.7-rc.2`**；`@deepseek-ai/cordis` = **4.0.4**。

**`tsc --noEmit` 的 23 个错误**（无一条属于逻辑/类型不兼容）：

```
RefLibBrowser.tsx(18..23)     6 条   IconChevronRightOutline14 / IconEditOutline16 / IconFolderClose16 /
                                    IconFolderOpen16 / IconLoadingOutline16 / IconWarningOutline16
RefLibCommandCard.tsx(18..21) 4 条   IconCheckOutline16 / IconCopyOutline16 / IconLoadingOutline16 / IconWarningOutline16
RefLibDock.tsx(25)            1 条   IconFolderOpen16
RefLibImport.tsx(25..27)      3 条   IconFolderOpen16 / IconLoadingOutline16 / IconWarningOutline16
RefLibPanel.tsx(20..28)       9 条   IconEditOutline16 / IconEllipsisOutline16 / IconFolderOpen16 /
                                    IconLoadingOutline16 / IconPlusOutline16 / IconRefreshOutline16 /
                                    IconSearchOutline16 / IconTrashOutline16 / IconWarningOutline16
```

**`vitest run` 的 2 个失败**：

```
FAIL tests/harness-roundtrip.spec.ts > v3：插件 add/remove 后会话日志可冷加载…
FAIL tests/harness-roundtrip.spec.ts > 陷阱守卫：写白名单外事件（ref-lib/set）→ 冷加载抛 …
TypeError: JsonlSessionPersistence is not a constructor
 ❯ boot tests/harness-roundtrip.spec.ts:35:19
```

——**这就是全部破坏面。** 其余 L0/L1 全部测试（含 `loader.spec` 真实 cordis 装载、
`service.spec` 64 条、`routes.spec` 32 条）在 0.1.7-rc.2 依赖族上**原样通过**。

### 3.2 破坏项逐条

#### B1（**BREAKING**）ui-primitives 图标导出改名：`Icon<Glyph><Size>` → `Icon<Glyph><Weight>`

- **决策文档**：`.agents/notes/implemented/architecture/2026-09-16-size-neutral-product-icon-weights.md`
  ——"Every shared product glyph exports a size-neutral `Regular` and `Medium` component…
  The former numeric suffix survives only as the default size when a glyph has no 16px source."
- **落地提交**：`4937343a5e feat(web): unify the client visual language`（2026-09-17）。
- **引入版本（逐 tag 实测）**：

  | tag | `Icon*16` 导出数 | `Icon*Regular` 导出数 |
  | --- | --- | --- |
  | `dsh-v0.1.2-rc.1` | 52 | 0 |
  | `dsh-v0.1.5-rc.3` | 53 | 0 |
  | `dsh-v0.1.6-alpha.2` | 56 | 0 |
  | **`dsh-v0.1.7-alpha.1`** | **0** | **92** |
  | `dsh-v0.1.7-rc.2` | 0 | 94 |

  → **切换点干净利落：0.1.6 及以前只有旧名，0.1.7 起只有新名，不存在两者并存的版本。**
- **本仓库受影响面**：**13 个不同图标、51 处使用、5 个文件**（`RefLibBrowser.tsx` 12 /
  `RefLibPanel.tsx` 21 / `RefLibImport.tsx` 9 / `RefLibCommandCard.tsx` 7 / `RefLibDock.tsx` 2）。
- **精确映射**（`Regular` = 1px 描边，即旧图标的默认视觉；`Medium` = 1.3px 强调，**不要用**）：

  | 旧（≤0.1.6） | 新（≥0.1.7） |
  | --- | --- |
  | `IconFolderOpen16` | `IconFolderOpenRegular` |
  | `IconFolderClose16` | `IconFolderCloseRegular` |
  | `IconChevronRightOutline14` | `IconChevronRightOutlineRegular` |
  | `IconEditOutline16` | `IconEditOutlineRegular` |
  | `IconLoadingOutline16` | `IconLoadingOutlineRegular` |
  | `IconWarningOutline16` | `IconWarningOutlineRegular` |
  | `IconEllipsisOutline16` | `IconEllipsisOutlineRegular` |
  | `IconPlusOutline16` | `IconPlusOutlineRegular` |
  | `IconRefreshOutline16` | `IconRefreshOutlineRegular` |
  | `IconSearchOutline16` | `IconSearchOutlineRegular` |
  | `IconTrashOutline16` | `IconTrashOutlineRegular` |
  | `IconCheckOutline16` | `IconCheckOutlineRegular` |
  | `IconCopyOutline16` | `IconCopyOutlineRegular` |

  **默认尺寸无变化**（`IconChevronRightOutlineArtwork` `size = 14`、`IconFolderOpenArtwork`
  `size = 16` 等与原后缀一致），所以所有 `size={…}` 调用点**不用改**。
  注意 `IconFolderOpen16 → IconFolderOpenRegular`（**没有** `Outline` 中缀）；
  rc.1 同时存在的 `IconFolderOpenOutline16` 才映射到 `IconFolderOpenOutlineRegular`。
- **为什么这是硬失败**：图标是 **value import**（`@deepseek-ai/dsh-client-ui-primitives` 是
  module-table seed 词，运行时经 `require` 取值），旧名在 0.1.7 宿主上解析为 `undefined`，
  React 渲染 undefined 组件即崩——**不是"少个图"，是白屏级错误**。

#### B2（**BREAKING，仅测试；实为"持久化后端整条契约重写"**）`dsh-session-persistence-jsonl` 在 0.1.3-alpha.1 换契约

> **落地修订（2026-09-25，v18 实施时实测补充）**：本节初稿只写了"具名导出改默认导出"。
> 实际动手时发现 **0.1.3-alpha.1 把整条持久化后端契约一起重写了**，三处都要改，否则
> L2 依然红（`load is not a function` / 冷读 `SessionPersistenceNotFoundError`）。
> 下表为逐 tag 实测结果（`git show <tag>:packages/session/session-persistence-jsonl/src/index.ts`）：

| 契约点 | ≤ 0.1.2-rc.1 | ≥ 0.1.3-alpha.1（含 0.1.5 / 0.1.7） |
| --- | --- | --- |
| 类导出 | 具名 **+** 默认 | **仅默认**（`export default`） |
| 读取 API | `load(id) → SessionInspection` | `open(id, access) → SessionHandle`，再 `handle.read() → { events }` |
| 落盘前提 | 直接 `store.flush(session)` 即可 | **必须持有写句柄**：`backend.create(session.header)` / `open(id, 'write')`；否则 `session/flush` 没有监听者参与（`SessionStore.flush()` 返回 **false**），磁盘上什么都不写，冷读只会报 `SessionPersistenceNotFoundError` |
| 产物命名 | `session.jsonl`（未压缩） | `session.v<格式版本>.jsonl.zstd`（**zstd 压缩**，目录 `<root>/<cwd 派生目录>/<id>/`） |

- 0.1.7-rc.2 的 `lib/types/index.d.ts`：`declare class JsonlSessionPersistence …`
  **仅** `export default JsonlSessionPersistence`（无具名导出）。
- **逐 tag 实测该具名导出**：0.1.2-rc.1 ✅ → **0.1.3-alpha.2 起 ❌**（0.1.5-rc.2/rc.3 / 0.1.6-alpha.2 /
  0.1.7-rc.2 均无）。
- 影响面集中在 `tests/harness-roundtrip.spec.ts`（L2 两道防线），**生产代码零改动**
  （插件不直接读写会话日志——这正是 v3 事故修复的设计目的）。改法见 §4.3。
- **为什么必须持有写句柄**：0.1.3-alpha.1 起后端按「写所有权」工作——`SessionStore.flush()`
  只派发 `session/flush` 事件，真正落盘的是活跃写句柄那条路径；生产环境由 **agent-loop**
  在 `create`/`resume` 时取得（`packages/core/agent-loop/README.md`：
  "The loop is the production acquisition point for session write handles"）。
  0.1.2-rc.1 及以前这条链路是隐式的，所以旧测试"裸 flush 也能落盘"。
- 顺带印证 §6.3 的扫描脚本为何必须**解压**：0.1.5 起的日志是 `session.v*.jsonl.zstd`。

#### B3（**行为级 BREAKING：旧数据可读性**）会话格式 v0→v1 迁移边拒绝未知历史事件（含 `ignorable`）

- `SESSION_FORMAT_VERSION` 逐 tag 实测：`0.1.0-rc.7`…`0.1.2-rc.1` = **0** →
  `0.1.3-alpha.2` = **2** → `0.1.5-rc.1` = **3** → **`0.1.7-alpha.1` 起 = 4**；
  HEAD `packages/core/session/src/types.ts:89` `export const SESSION_FORMAT_VERSION = 4`。
- 迁移链在 `packages/session/session-format-catalog/src/generated.ts:15-32` 静态装配
  （v0→v1→v2→v3→v4），**与挂载的插件无关**。
- **v0→v1 边（历史迁移）：拒绝未知事件类型，即使 `ignorable: true`** ——
  `packages/session/session-format-v0-to-v1/src/validation.ts:117-126`
  （`migration refuses unknown historical events even when ignorable`），
  由 `tests/validation.spec.ts:329-333` 显式钉死。
- 与之对照，**同版本读取仍保留 `ignorable` 逃生门**（`session-format-v3-to-v4/src/validation.ts:59-62`），
  所以 L2「陷阱守卫」用例的语义**没变**（它写的是当前格式的未标记事件 → 仍抛
  `SessionFormatUnsupportedError`）。
- **对本仓库的含义**：
  - v3 起的 sidecar 设计**完全不受影响**（我们不再往日志写自定义事件）；
  - **只有 v1/v2 时代的旧日志**（含 `ref-lib/set`，当年被修补脚本补过 `ignorable: true` 的）
    在 ≥0.1.3-alpha.2 的宿主上会在 v0→v1 边被**整体拒读**；
  - 于是 `foldRefLibs(session.snapshotEvents())` 这条 legacy 迁移路径**再也不可能被触发**——
    它已是不可达代码，且 AGENTS.md §5 注 2 与 `src/service.ts` 注释的相应声明**现在是错的**。
- **本机数据实测（§6.3）：零命中**，所以这是**文档纠正**，不是数据救援；但换环境（他机/他 profile）
  仍应按 §6.3 的脚本先扫一遍再升宿主。

#### B4（**互操作 BREAKING：具名导出改窄**）`PERSONA_SECTION`、`input.images`、`commands.execute` 等

以下均为 HEAD 的破坏性改动，**但 ref-lib 不消费**，列出以防将来误用：

| 面 | 变化 |
| --- | --- |
| `systemPrompt` | `PERSONA_SECTION` → `PERSONA_PREFIX_SECTION` + 新增 `PERSONA_SUFFIX_SECTION`；`Config.persona` → `personaPrefix`/`personaSuffix` |
| `commands` | `CommandInputDescriptor.images` → `attachments`；`CommandInvocation.attachments` 放宽为 `(ImageBlock\|FileBlock)[]`；`CommandRuntime.execute()` 第 3 参 `images` → `submittedAttachments` |
| `session-query` | 配置字段 `persistedInspectConcurrency` → `persistedReadConcurrency`（+ 新 `preparedSessionCacheSize`） |
| `session-persistence(-jsonl)` | `JsonlSessionPersistence` 仅默认导出（见 B2） |
| 会话格式 | v0 → v4（见 B3） |

#### B5（**DEPRECATED，非破坏**）`Session.snapshotEvents()` / `eventAt()` / `ownEvents()`

`packages/core/session/src/index.ts:639-655`：

```
@deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
See the Agent Note (.../2026-09-09-deprecate-synchronous-session-event-reads.md)
```

- 唯一生产调用点：`src/service.ts` 的 legacy 折叠（与 B3 同一条路径）。
- 处置：随 legacy 路径一并删除（推荐，见 §4.4），或保留但加显式豁免注释
  （first-party 的写法是 `// oxlint-disable-next-line typescript/no-deprecated -- …`）。
- **不得**在新增代码里调用；测试文件是唯一被豁免的场景。

#### B6（**HYGIENE，非破坏**）打包 externals 与 seed 表漂移

- HEAD seed 表（`packages/client/web/src/platform.ts:8-14`，共 **9** 项）：
  `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、
  `@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
  `@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
  相对 rc.1 **只多了一项 `ui-dockkit`**（0.1.5-rc.3 起），**没有删改**。
- 本仓库 `tsdown.config.ts` 的 `PLATFORM_EXTERNALS` 现有 6 项，其中
  **`@deepseek-ai/dsh-client-locale/client` 不是 seed 词**——今天无害（该 import 是 `import type {}`，
  构建期擦除），但一旦有人写成 value import，bundle 会发出 `require(...)` 并在
  `packages/client/modules/src/client/system.ts:319-330` 抛 "missed the module table"。
- 实测已构建产物 `lib/client.js` 的 `require` 只有 3 个：
  `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` —— **全在 seed 表内**，
  所以「运行没问题」的结论是实测的，不是推断的。

### 3.3 零破坏清单（逐 API，带 HEAD 锚点）

> 这张表是本文档最有实用价值的部分：**除 §3.2 的 B1/B2 外，其余全部无需改动**。

| 面 | 结论 | HEAD 锚点 |
| --- | --- | --- |
| `ctx.commands.register({name, description, input, handler})` | 不变 | `packages/interaction/commands/src/index.ts:285-292` |
| handler 的 `invocation.rawInput` / `agent.session` | 不变 | 同上 `:41-58`；`agent.session` 见 `packages/core/agent/src/runtime-types.ts:168` |
| `CommandResult`（`{kind:'success',text?}` / `{kind:'error',text}`） | **逐字不变**（仅新增可选 `sourceEventSeq`） | `packages/interaction/commands/src/types.ts:33-41` |
| `ctx.systemPrompt.context({name, order, text})` + `PromptContext` | 不变，**未废弃** | `packages/core/system-prompt/src/index.ts:489-498`；类型 `:79-86` |
| `AssembleContext.agent`（我们用的 `context.agent?.session`） | 不变 | `packages/core/agent/src/runtime-types.ts:16-21` |
| `order: 150` 是否撞车 | **不撞**：`CONTEXT_ORDERS` 只有 110/115/120 | `packages/core/system-prompt/src/index.ts:164-171` |
| `ctx.webServer.register(route)` + `WebRoute` + 自建 loopback 护栏 | 不变（**平台不提供 loopback 护栏**，README 明示 route owner 自负） | `packages/host/webserver/src/index.ts:38-48, 166-173`；`README.md:113` |
| `Session.header.cwd` / `session.id` / `SessionId()` | 不变 | `packages/core/session/src/index.ts:464, 470`；`types.ts:20-29` |
| `session/created` 事件 + `{ global: true }` | **逐字不变**（`global` 是 cordis 选项，不是 payload） | `packages/core/session/src/index.ts:55`；`vendor/cordis/src/events.ts:113-117` |
| `ctx.sessions.get/list/fork` | 不变 | `packages/core/session/src/index.ts:1227, 1235, 1255` |
| `ctx.sessionQuery.listSessions/readTitleSnapshots` + `SessionTitleObservationResult` + `SessionTitleSnapshot` | 不变 | `packages/session-query/session-query/src/index.ts:174-176, 251-262`；`types.ts:162-186` |
| `ctx.sessionController.list({}, signal)` → `{ items }` + `SessionSummary.{blank,origin,cwd,parentSessionId}` | 不变（`SessionSummary` 仅**新增必填** `agentAvailable: boolean`） | `packages/api/session-controller/src/index.ts:251-254`；`types.ts:177-188` |
| `ctx.workspaceRegistry.archivedSessionIds` / `list()` / `Workspace.title` / `.sessionIds` | 不变 | `packages/workspace/workspace/src/index.ts:290-298, 342-344`；`types.ts:75, 91` |
| `dshHomePath(...)` | 不变（新增 `dshCachePath`，我们不用） | `packages/util/home-paths/src/index.ts:98` |
| `conversation.input.dock` 槽位（`{kind:'list',scope:'session',owner:InputZone}`） | **逐字不变** | `packages/client/ui-conversation/src/client/contract/slots.ts:195` |
| `conversation.chat.commandview`（`{kind:'keyed',scope:'session'}`，按**命令名**派发） | 不变 | `packages/client/ui-chat/src/client/contract/slots.ts:309`；派发 `chat/CommandNodeView.tsx:18-21` |
| `InputZone.session.sessionId`（v17 取 sessionId 的方式） | 不变（`SessionSnapshot.sessionId`） | `packages/api/session-controller/src/client/contract/snapshot.ts:69-70` |
| `useChat(s => s.legacy.nodes)`（刷新信号源） | 不变（官方 `StatsPills` 同款读法） | `packages/client/ui-chat/src/client/contract/slots.ts:274-277`；`snapshot.ts:95-111`；`chat/StatsPills.tsx:318` |
| `CommandNode` / `ConversationNode` / `UserMessageNode.kind:'user'` | **逐字不变** | `packages/client/ui-conversation/src/client/contract/records.ts:222-261` |
| `ctx.uiWorkspace.pickDirectory/listDirectory` | 不变（新增 `createDirectory`、`DirectoryBrowseError`） | `packages/client/ui-workspace/src/client/navigation.ts:91, 98` |
| `ctx.locale.register(ns, {zh, en})` + `LocaleNamespaceMap` 声明合并 + `PropsLocale/TranslateNS` | 不变 | `packages/client/locale/src/client/index.ts:389, 399-400`；`ui-slots/src/index.ts:39, 79, 93` |
| `ctx.slots.register` 的 `{name, id/key, order, locale, inject}` | 不变（`ComposedProps` 仅新增 `PropsRenderFactories`，属加宽） | `packages/client/ui-slots/src/index.ts:764-793` |
| `DirectoryEntry` / `DirectoryListing`（`dsh-host-directory-picker/types`） | **逐字不变** | `packages/host/directory-picker/src/types.ts:11-45` |
| `cordis` `Service` / `Context` / `ctx.effect` / `ctx.inject` / `ctx.on` | 不变（vendor 4.0.2 → 4.0.4，peer `^4.0.1` 覆盖） | 探针里 `loader.spec` 真实装载通过 |
| `dsh.bundle.patch` + `cordis.patch.yml` + `dsh.client.platform:'web'` + `exports["./client"]` | 不变、**无新增必填字段** | `packages/bundle/README.md:21-23`；`packages/client/modules/src/index.ts:195-205, 834-854` |
| `KNOWN_SESSION_EVENT_TYPES` 白名单 + `Session.append()` 无 `ignorable` 通道 | 规则不变（**仍然禁止写白名单外事件**） | `packages/core/session/src/known-event-types.ts:8-22`；`index.ts:715-733` |

### 3.4 平台新增能力（机会，非破坏）

| 新能力 | 引入版本 | 对本插件的潜在价值 |
| --- | --- | --- |
| `client/ui-sidebar-right`（`ctx.sidebarRight` / `ctx.sidebarRightTabs` / `sidebar.right.pane.tab` 槽位） | 0.1.2-rc.1 **无**（0 文件）→ **0.1.5-alpha.1 起在位** | 把 `RefLibPanel`（现为 Modal）升级为**常驻右栏 tab**；官方 `ui-sidebar-documentpreview` 是第三方可照抄的公开路径范例 |
| `workspaceRegistry.pinnedSessionIds` / `pinSession` | HEAD 新增（rc.1 无 `pinSession`） | 跨会话导入来源排序与侧边栏同口径（现在纯按 mtime） |
| `ctx.uiWorkspace.createDirectory` | HEAD 新增 | 给自研目录浏览器补齐"新建文件夹"（原生浏览器的能力对齐） |
| `client/ui-input-trigger`（`ctx.inputTriggers.registerSource`） | rc.1 已在 | 可给 `/ref-lib` 加参数补全（`TriggerChar = '/' \| '@'`） |
| `@deepseek-ai/dsh-api-remotes/client` 的 `./client` 类型产物 | rc.1/HEAD 源码均在位 | 纠正 AGENTS.md v17 关于"npm rc.1 无 ./client 类型"的记述（**该结论在 HEAD 源码层面不成立**；rc.1 tarball 未复核） |
| `ctx.webServer.host` getter | — | 若将来允许 `0.0.0.0` 绑定，可自检并自禁用（当前 loopback 护栏已足够） |

> 附注：`ui-dockkit` 新增进 seed 表，但其 README 自述 **"Internal engine… not as a stable API"**——
> **不要依赖**。

---

## 4. 逐文件升级方案（v18 实现基准）

> 总改动面：**2 个源文件族（图标 + 测试导入）+ 1 个 package.json + 3 处注释/文档**。
> 预计净增代码 < 40 行（若采用 §5.2 的图标兜底），**无逻辑重写**。

### 4.1 `package.json`

```diff
-  "version": "0.17.0",
+  "version": "0.18.0",
   "peerDependencies": {
     "@deepseek-ai/cordis": "^4.0.1",
-    "@deepseek-ai/dsh-api-session-controller": "^0.1.2-rc.1",
-    ...（其余 13 个 dsh-* peer 同为 ^0.1.2-rc.1，全部保持不变）
+    "@deepseek-ai/dsh-api-session-controller": "^0.1.2-rc.1",
+    ...（**保持不变**，理由见 §5.4）
   },
   "devDependencies": {
-    "@deepseek-ai/dsh-client-ui-conversation": "0.1.2-rc.1",
-    "@deepseek-ai/dsh-client-ui-renderer": "0.1.2-rc.1",
-    "@deepseek-ai/dsh-client-ui-slots": "0.1.2-rc.1",
-    "@deepseek-ai/dsh-host-directory-picker": "0.1.2-rc.1",
-    "@deepseek-ai/dsh-session-persistence": "0.1.2-rc.1",
-    "@deepseek-ai/dsh-session-persistence-jsonl": "0.1.2-rc.1",
-    "@deepseek-ai/dsh-workspace": "0.1.2-rc.1",
+    "@deepseek-ai/dsh-client-ui-conversation": "0.1.7-rc.2",
+    "@deepseek-ai/dsh-client-ui-renderer": "0.1.7-rc.2",
+    "@deepseek-ai/dsh-client-ui-slots": "0.1.7-rc.2",
+    "@deepseek-ai/dsh-host-directory-picker": "0.1.7-rc.2",
+    "@deepseek-ai/dsh-session-persistence": "0.1.7-rc.2",
+    "@deepseek-ai/dsh-session-persistence-jsonl": "0.1.7-rc.2",
+    "@deepseek-ai/dsh-workspace": "0.1.7-rc.2",
   }
```

**peer 区间刻意不动**（`^0.1.2-rc.1`）：它是本插件"单包跑多代宿主"声明的**语义正确区间**
（`>=0.1.2-rc.1 <0.2.0`，含 0.1.3–0.1.7，不含 0.2.x），并已实测满足 0.1.7 的 peer preflight（§5.4）。
**devDeps 必须提到 `0.1.7-rc.2`**——它是 typecheck 与构建的**类型真相源**，用新名编译才能
在 0.1.7 宿主上取值（配合 §5.2 的兜底，旧宿主也能跑）。

### 4.2 图标：13 处改名（+ 建议加运行时兜底）

**最小改法**（只改名，放弃旧宿主）：按 §3.2 B1 的映射表改 5 个文件的 import 区即可，
`size={…}` 全部不动。

**推荐改法**（改名 **+** 兜底，换来单包多宿主）：新增 `src/client/icons.ts`：

```ts
/**
 * 跨 dsh 版本的图标取值层。
 *
 * 0.1.7-alpha.1（提交 4937343a5e）起，ui-primitives 的共享图标由
 * `Icon<Glyph><Size>` 改名为 `Icon<Glyph><Weight>`（Regular = 1px / Medium = 1.3px），
 * 旧名在同版本被**删除**（不存在两者并存的版本：0.1.6-alpha.2 只有旧名、0.1.7-alpha.1 只有新名）。
 * 由于 ui-primitives 是宿主 seed 模块表的 external，运行时按名取值可以在两代宿主上
 * 拿到正确实现——这正是"单包跑 0.1.2…0.1.7"的关键。
 * @module @hpyperry/dsh-ref-lib/src/client/icons
 */
import type { ComponentType } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** 图标组件的公共 props（`size` 缺省即该字形自带的绘制尺寸）。 */
export interface GlyphProps {
  readonly size?: number
  readonly className?: string
}

const table = primitives as unknown as Record<string, ComponentType<GlyphProps> | undefined>

/**
 * 按字形基名取图标：优先新版 `…Regular`，回退旧版 `…16` / `…14`。
 * @param base - 不含尺寸/字重后缀的导出基名，如 `'IconFolderOpen'`。
 * @returns 该字形的 Regular 权重组件。
 */
function glyph(base: string): ComponentType<GlyphProps> {
  const component = table[`${base}Regular`] ?? table[`${base}16`] ?? table[`${base}14`]
  if (component === undefined) throw new Error(`ref-lib: ui-primitives 缺少图标 ${base}`)
  return component
}

export const IconFolderOpen = glyph('IconFolderOpen')
export const IconFolderClose = glyph('IconFolderClose')
export const IconChevronRightOutline = glyph('IconChevronRightOutline')
export const IconEditOutline = glyph('IconEditOutline')
export const IconLoadingOutline = glyph('IconLoadingOutline')
export const IconWarningOutline = glyph('IconWarningOutline')
export const IconEllipsisOutline = glyph('IconEllipsisOutline')
export const IconPlusOutline = glyph('IconPlusOutline')
export const IconRefreshOutline = glyph('IconRefreshOutline')
export const IconSearchOutline = glyph('IconSearchOutline')
export const IconTrashOutline = glyph('IconTrashOutline')
export const IconCheckOutline = glyph('IconCheckOutline')
export const IconCopyOutline = glyph('IconCopyOutline')
```

5 个组件文件把 13 个图标 import 全部换成 `from './icons.ts'`（`Button` / `Modal` / `Input` /
`Menu` 等其余 primitives 继续直接从 ui-primitives 取——它们**跨版本完全兼容**，见 §3.3）。

> 说明：`import * as primitives` 是 **value import**，tsdown 会保留为
> `require('@deepseek-ai/dsh-client-ui-primitives')`（该模块在 `neverBundle` 且是 seed 词），
> 因此兜底在运行时才发生，构建产物一份即可跨宿主。
> 若**只**做改名不做兜底，则必须回到 v17 那种"每代宿主一份发布"的双轨模式（不推荐，见 §5.1）。

### 4.3 `tests/harness-roundtrip.spec.ts`：整条持久化契约迁移（**v18 已落地**）

> **落地修订**：初稿只给了导入改法。按 §3.2 B2 修订表，实际要改三处；下面是 v18 在
> `0.1.5-rc.2` 上跑通（231/231 全绿）的最终写法。

```diff
-import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
+import { SessionId, SessionStore, type SessionHeader } from '@deepseek-ai/dsh-session'
+import { SessionFormatUnsupportedError, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
+import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'   // 0.1.3-alpha.1 起仅默认导出

+/** 0.1.3-alpha.1 起：必须取写句柄才会落盘（生产由 agent-loop 取得）。 */
+async function claimWrite(
+  stack: { backend: JsonlSessionPersistence },
+  session: { header: SessionHeader },
+): Promise<SessionHandle> {
+  return await stack.backend.create(session.header)
+}

 // 写阶段
 const session = first.store.create(sessionId)
+const writer = await claimWrite(first, session)
 …
-await first.store.flush(session)
+expect(await first.store.flush(session)).toBe(true)   // false = 持久化链路没接上
+await writer.close()                                   // close 排空并落盘

 // 冷读阶段
-const inspection = await second.backend.load(sessionId)
-expect(inspection.events.map(…))…
+const handle = await second.backend.open(sessionId, 'read')
+const { events } = await handle.read()
+expect(events.map((event) => event.type)).toEqual(['turn/start', 'turn/end'])
+await handle.close()

 // 陷阱守卫
-await expect(second.backend.load(sessionId)).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
+await expect((async () => {
+  const handle = await second.backend.open(sessionId, 'read')
+  await handle.read()
+})()).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
```

要点：
1. **导入形态**：本轨（0.1.5/0.1.6）只支持默认导出，直接写默认导入即可；
   若想同时兼容 0.1.2 依赖族，用 `import * as m; (m.default ?? m)` 双形态夹层。
2. **写句柄**：不取写句柄时 `store.flush()` 返回 `false`、磁盘空白、冷读报
   `SessionPersistenceNotFoundError`——这是最容易被误判为"插件写坏了日志"的坑，
   故测试里显式断言 `flush() === true`。
3. **冷读**：`open(id,'read')` + `read()`；拒读（`SessionFormatUnsupportedError`）可能发生在
   `open` 或 `read`，两个调用一起包进 `expect(...).rejects` 才稳。

### 4.4 注释与文档纠正（**必做**，属"事实修正"而非美化）

1. `AGENTS.md` §5 附加约定 2：把"含 ignorable 标记的旧日志仍可读"改为——**在 ≤0.1.2-rc.1 的
   宿主上可读；≥0.1.3-alpha.2 的宿主上，v0 日志在 v0→v1 迁移边会拒绝未知事件（即使
   `ignorable`），因此 legacy 日志不可读、`foldRefLibs` 已是不可达路径**，并追加 v18 沿革。
2. `src/service.ts` 头部与 legacy 折叠处的注释（现述"rc.1 读取路径 ignorable 豁免与 rc.2 一致，
   含 ignorable 标记的旧日志仍可读"）：按第 1 条同步修正。
3. 决策：**legacy 折叠路径（`foldRefLibs` + 它唯一的 `snapshotEvents()` 调用）删除还是保留？**
   - 删除（推荐）：一并消掉 B4 的 `@deprecated` 用法，代码与文档同时变简单；
   - 保留：必须加豁免注释，且注释里明确"仅为 ≤0.1.2-rc.1 宿主保留"。
4. `tests/harness-roundtrip.spec.ts` 头部注释与 §3.2 B3 对齐（说明陷阱守卫只针对当前格式）。

### 4.5 `tsdown.config.ts` / client manifest hygiene

```diff
 const PLATFORM_EXTERNALS = [
   'react',
   'react/jsx-runtime',
   '@deepseek-ai/cordis',
-  '@deepseek-ai/dsh-client-locale/client',   // 不是 seed 词：万一变成 value import 会在运行时炸
   '@deepseek-ai/dsh-client-ui-primitives',
   '@deepseek-ai/dsh-client-ui-slots',
+  // 备忘：seed 表另有 react-dom、react-dom/client、dsh-client-store、dsh-client-ui-dockkit；
+  // 将来若引入它们的 value import，必须同时加入本表（dockkit 自述非稳定 API，勿依赖）。
 ]
```

`package.json` 的 `dsh.client` 建议显式写明（可选，语义等价于缺省）：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web", "external": [] } }
```

—— `external` 的语义是"**基线之外的** module-table 请求"（`packages/util/package-manifest/src/types.ts:88-93`：
"Type-only imports are erased and create no module request"）。我们 3 个运行时 require 全在基线内，
所以**空数组是当前正确值**；显式写出来是为了让将来误引非基线模块时，评审能立刻看见差异。

### 4.6 明确**不做**的事（防止过度重构）

| 不做 | 理由 |
| --- | --- |
| 不把 `systemPrompt.context` 迁到 `agent/pre-step` + durable message | 该 seam 在 0.1.2→0.1.7 全线**逐字未变、未废弃**，第一方 `sandbox-policy`/`user-approval`/`subagent:delegation` 仍在用；`order: 150` 不撞官方 `CONTEXT_ORDERS`。durable 化会引入"变更需发差量消息"的复杂度，而我们**每请求重算**正是想要的行为 |
| 不把 `/api/ref-lib/*` 迁到 Typert Remote | `docs/subsystems/web-server.md` 明确背书插件自注册路由；cookbook 全为 monorepo 口径、无第三方先例、CLI 无生成命令 |
| 不删自研面板/浏览器/命令卡片 | 平台没有等价的通用目录选择入口（官方 browse 只填 workspace 的 `directoryFlow` 槽位）；`GenericCommandCard` 到 HEAD 仍是 `nowrap + ellipsis` 与 `max-height: 260px`（`ui-chat/src/client/chat/GenericCommandCard.module.css:35-36, 51`），我们的全展开 + 复制按钮仍然必要 |
| 不迁 sidecar 到 `ctx.storageDomain` | 收益是"少写 30 行原子写"，代价是引入新服务依赖与新失效面；本插件 sidecar 已稳定运行 |
| 不动 `conversation.input.dock` 的 `order: 200` | 槽位契约逐字未变；dock 是"输入卡上方独立一行"，与 `conversation.input.left`（工具行内紧凑控件）语义不同，现位置仍正确 |

---

## 5. 多版本兼容：「单包多宿主」路线（本次取代 v17 的双轨）

> ### ⚠️ 落地决策（2026-09-25）：改走**双分支双轨**，本节方案降级为"未来可选精简"
>
> 评估完成后，项目决定**按宿主代分两条分支**，而不是本节建议的"单包 + 图标运行时兜底"：
>
> | 分支 | 版本 | 目标宿主 | peer 区间 | 图标 |
> | --- | --- | --- | --- | --- |
> | `main` | **0.18.0** | dsh **0.1.5 / 0.1.6**（npm `latest` 通道） | `>=0.1.5-rc.2 <0.1.7-alpha.1` | 旧名 `Icon*16`（0.1.7 前唯一存在） |
> | `next` | **0.19.0** | dsh **0.1.7+**（npm `next` 通道） | `^0.1.7-rc.2` | 新名 `Icon*<Weight>`（0.1.7 起的唯一名字） |
>
> 两条轨道**各自只声明自己真实支持的宿主**：`main` 的上界把 0.1.7+ 排除在外，于是装在
> 0.1.7 宿主上时会被 0.1.7-rc.1 起新增的 peer 兼容闸门**干净跳过并打印原因**（不是静默
> 白屏）——这正好替代了本节"图标兜底"要解决的问题，代价是用户需要按宿主选版本。
> 相比之下本节 §5.2 的兜底方案仍然成立，可作为将来"想合并回单包"时的现成做法保留。
>
> **上界是"安装期安全网"——已实测（2026-09-25）**：在一个 0.1.7-rc.2 宿主上安装一个
> peer 声明为 `>=0.1.5-rc.2 <0.1.7-alpha.1` 的插件，`dsh plugin add` **直接拒绝**并打印：
>
> ```
> dsh: installation rejected: Plugin <pkg>@<ver> is incompatible with dsh 0.1.7-rc.2:
> peerDependencies {"@deepseek-ai/dsh-session":">=0.1.5-rc.2 <0.1.7-alpha.1"}. Running it may
> cause crashes or data loss. Update the plugin or install a plugin version compatible with
> this dsh runtime. To accept this risk explicitly, grant the exact-version exemption …
> with `dsh plugin allow-version` …
> dsh: nothing was installed.
> ```
>
> 也就是说 0.18.x（`main`，0.1.5/0.1.6 轨）在 0.1.7+ 宿主上**装不上也起不来**——用户不会
> 静默拿到一个缺图标的半坏插件，而是拿到一条明确的"去装兼容版本"的提示（并留有
> `allow-version` 应急豁免）。运行时同样生效：boot 阶段的
> `prepareProfileEntries` 把不兼容行置 `disabled` 并写 stderr，profile 本身仍能启动。
>
> 下文 §5.1–§5.5 保留为**评估结论与备选方案**，其中 §5.3 的三列矩阵、§5.4 的 peer 区间
> 与闸门相互作用分析对两条轨道同样有效。

### 5.1 为什么这次不必双轨

v17 必须双轨的根因是：client half 的 **cordis fiber inject 服务名**在两侧宿主体系不同
（v16.1 inject `workspaces`、v17 inject `uiWorkspace`），**加载即失败**，无法兼容。

本次逐项复核后**不存在这种断层**：

| 判据 | 实测结论 |
| --- | --- |
| 我们 inject 的 client 服务（`slots` / `uiWorkspace` / `locale`） | 0.1.2-rc.1 与 0.1.7-rc.2 **都存在**（`uiWorkspace` 自 0.1.2 起） |
| bundle 的运行时 external（3 个） | 两代 seed 表**都包含** |
| 槽位键与 owner 契约（dock / commandview） | **逐字未变** |
| 其余 client 类型/服务 | 未变（§3.3） |
| node half 的全部服务与事件 | **未变**（§3.3），除 legacy 折叠用的 `snapshotEvents()` 已废弃 |
| 唯一真实差异 | **图标导出名**（0.1.7 线），且它在运行时取值 |

⇒ 一个 10 行的取值兜底 + 保留 `^0.1.2-rc.1` peer 区间，就能让**同一份 0.18.0** 在
0.1.2-rc.1 / 0.1.5-rc.3 / 0.1.7-rc.2 三代宿主上同时工作。

### 5.2 兼容性的两个"夹层"

1. **图标名兜底**（§4.2）：`primitives[base + 'Regular'] ?? primitives[base + '16'] ?? primitives[base + '14']`。
2. **测试依赖导入兜底**（§4.3）：`module.default ?? module`（只影响本仓库测试，不影响产物）。

### 5.3 版本矩阵（三列，全部在隔离环境）

| 层 | 0.1.2-rc.1（对照：本机现状） | 0.1.5-rc.3（npm `latest`） | 0.1.7-rc.2（HEAD / npm `next`） |
| --- | --- | --- | --- |
| L0 纯函数 | 全绿（现状） | 全绿（预期零改动） | 全绿（**已实测**：40+24+16+… 全过） |
| L1 装载/装配 | 全绿 | 全绿（预期） | 全绿（**已实测**：`loader.spec` 真装载通过） |
| L2 harness 边界 | 全绿（现状） | 绿（需 §4.3 默认导入，具名导出自 0.1.3-alpha.2 起消失） | 绿（同上） |
| L3 隔离宿主冒烟 | 现状对照 | 冒烟清单 | 冒烟清单 |
| 数据平面 | sidecar 可读 | 同 | 同；**升级前先跑 §6.3 的 legacy 日志扫描** |

**L3 冒烟清单**（每列都要过）：dock 胶囊渲染（图标**逐个可见**，不是空白/白屏）→ 面板
list/add/browse/手动路径/失效红标 → 跨会话导入（工作区分组 + 组懒加载 + 冲突页）→ `/ref-lib`
命令专属卡片 → `/ref-lib import` 命令输出 → 新会话注入可见（模型上下文里出现
`[Read-only Reference Libraries]`）→ 控制台零报错 → `/api/ref-lib/*` 全端点可达。

### 5.4 peer 区间与 0.1.7 新增 preflight 的相互作用（实测）

0.1.7-rc.1 起新增**安装/组装期的 peer 兼容闸门**：
`packages/boot/app-boot/src/plugin-compatibility.ts:61-88` 对每个 `@deepseek-ai/dsh` /
`@deepseek-ai/dsh-*` peer 做 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，
不满足则**拒绝该插件行**（可用 `dsh plugin allow-version` 按"包名@版本 + 运行时版本"精确豁免）。

用仓库自带 semver 7.8.5 实测我们的区间：

| 我方 peer 区间 | 运行时 0.1.7-rc.2 | 运行时 0.1.5-rc.3 | 运行时 0.2.0-rc.1 |
| --- | --- | --- | --- |
| `^0.1.2-rc.1`（现有） | ✅ **满足** | ✅ 满足 | ❌ 不满足（**这正是想要的边界**） |
| `^0.1.7-rc.2`（若改） | ✅ 满足 | ❌ 不满足 | ✅ 满足 |

⇒ **保留 `^0.1.2-rc.1`**：既通过新闸门，又精确表达"支持 0.1.2–0.1.7 全族、不支持 0.2.x"，
与 §5 的单包多宿主主张自洽。（`cordis` 与 `react` 不参与该闸门评估。）

### 5.5 何时必须回到双轨（边界条件）

出现下列任一情况，单包路线失效，需要回到 v17 式的"按宿主代发布 + 版本对矩阵"：

1. 平台再次改动 **client 服务名 / fiber inject 契约**（v16.1→v17 那种断层）；
2. 平台从 **seed 表删除**我们依赖的 external（`ui-primitives` / `ui-slots` / `react`）；
3. 我们消费的槽位键或 owner props 发生**语义级**变更（不只是加宽）；
4. peer 闸门收紧到"必须精确匹配宿主元组"（那时 `^0.1.x` 区间会被拒）。

---

## 6. 测试与验收（命令级）

### 6.1 探针复现（本文 §3.1 的证据来源）

```bash
cd /Users/hpy/dev/PROJECTS/dsh-plugins/ref-lib
rm -rf .probe-017 && mkdir .probe-017
for f in src tests scripts docs tsconfig.json .npmrc pnpm-workspace.yaml \
         vitest.config.ts eslint.config.js .prettierrc.json .editorconfig tsdown.config.ts; do
  cp -R "$f" .probe-017/
done
sed 's/\^0\.1\.2-rc\.1/^0.1.7-rc.2/g; s/0\.1\.2-rc\.1/0.1.7-rc.2/g' package.json > .probe-017/package.json
cd .probe-017 && pnpm install --ignore-scripts        # 约 4–5 分钟
./node_modules/.bin/tsc --noEmit                      # 预期：仅 23 条图标错误
./node_modules/.bin/vitest run                        # 预期：229 passed / 2 failed（L2）
```

> 注意：`.probe-017/` 必须在仓库内（`.npmrc` 的 `store-dir=.pnpm-store` 是相对路径，
> 依赖树与 lockfile 都落在探针目录内，删除即完全清理）。评估完成后**已删除**。

### 6.2 四道门禁 + L3 隔离冒烟

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build    # L0–L2 全绿
# L3：版本化本地宿主（不装全局、不动 PATH）
DSH_BIN_NEXT="$(DSH_VERSION=0.1.7-rc.2 ./scripts/dsh-local.sh)"
DSH_BIN_LATEST="$(DSH_VERSION=0.1.5-rc.3 ./scripts/dsh-local.sh)"
DSH_BIN_CUR="$(DSH_VERSION=0.1.2-rc.1 ./scripts/dsh-local.sh)"
DEV_HOME="$HOME/.dsh-dev-017" PROFILE=ref-lib-017 DSH_BIN="$DSH_BIN_NEXT" \
  PLUGIN=/Users/hpy/dev/PROJECTS/dsh-plugins/ref-lib ./scripts/dev-isolate.sh
```

（真实 `~/.dsh` 零接触；`rm -rf ~/.dsh-dev-017 ~/.dsh-tools` 即完全重置。）

### 6.3 数据平面检查：legacy `ref-lib/set` 日志扫描（**升级宿主前执行**）

会话日志是 **zstd 压缩**（`session.jsonl.zstd`），`grep` 直接扫会**假阴性**——必须解压后再扫：

```bash
cd /tmp && cat > scan.mjs <<'EOF'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'
const root = process.argv[2]
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    const buf = readFileSync(p)
    let text
    try {
      text = buf.subarray(0, 4).equals(Buffer.from([0x28,0xb5,0x2f,0xfd]))
        ? zlib.zstdDecompressSync(buf).toString('utf8') : buf.toString('utf8')
    } catch (e) { text = '<decompress-failed ' + e.message + '>' }
    const n = (text.match(/ref-lib\/set/g) ?? []).length
    const ig = (text.match(/"ignorable":true/g) ?? []).length
    if (n || ig) console.log(`${n} ref-lib/set | ${ig} ignorable | ${p}`)
  }
}
walk(root)
EOF
node scan.mjs "$HOME/.dsh/sessions"
```

**本次实测结果（2026-09-25，`--Users-hpy-*` 全部 11 个项目目录 / 81 个日志文件，
含 2026-08-17 事故当天的两个 `.bak-*` 备份）：零命中 `ref-lib/set`、零命中 `"ignorable":true`。**
⇒ 本机升级到 0.1.3+ 宿主**不存在**旧会话不可读风险（B3 只落到文档纠正）。
**换机器/换 profile 仍须先跑这段扫描。**

---

## 7. 决策与风险清单

### 7.1 待决决策（需要拍板）

| # | 决策 | 建议 |
| --- | --- | --- |
| D1 | 基线选 **0.1.5-rc.3（npm `latest`）** 还是 **0.1.7-rc.2（HEAD / `next`）** | **devDeps 用 0.1.7-rc.2**（最新类型真相源）+ **图标兜底**，于是两者**同时**被覆盖；不必二选一 |
| D2 | 图标用"直接改名"还是"运行时兜底" | **兜底**（§4.2）：多 1 个 40 行模块，换来单包多宿主，避免 v17 式双轨维护 |
| D3 | legacy `foldRefLibs` 路径删除还是保留 | **删除**（推荐）：它已不可达（B3），删掉同时消掉 `snapshotEvents()` 的 deprecated 用法（B4） |
| D4 | 是否顺带做右栏 tab / pinned 排序 / `createDirectory` | **不做进本次**：升级与增强分两次提交，先拿到 0.1.7 兼容性的净收益（§7.3 单独排期） |

### 7.2 风险清单

| 级别 | 风险 | 处置 |
| --- | --- | --- |
| **P0** | 旧日志不可读（B3）——他机若存在含 `ref-lib/set` 的 v0 日志，升级宿主后那些会话**永久打不开** | 升级宿主**前**跑 §6.3 扫描；命中则先备份（L4）并在旧宿主上处置；文档同步纠正 |
| **P1** | 图标改名导致白屏（B1） | 本次升级的**第一件事**；按 §4.2 落地后 L3 冒烟必须逐个确认图标可见 |
| **P1** | L2 防线失效（B2） | §4.3；L2 是 AGENTS §5 的硬性门禁，**不得以"只是测试"为由跳过** |
| **P2** | `snapshotEvents()` deprecated（B4） | §4.4-3 |
| **P2** | `SessionSummary.agentAvailable` 新增必填 | 生产只读 `origin`/`blank` 不受影响；`tests/service.spec.ts` 的 stub 目前有 `as never` 兜着，去掉断言时补字段 |
| **P3** | `PLATFORM_EXTERNALS` 漂移（B6） | §4.5 |
| **P3** | 我们自研 tsdown 配置**不受官方 purity gate 保护**（`packages/client/tsdown.client.ts:538-542` 的构建期校验只覆盖 monorepo 内部包） | 显式 `dsh.client.external: []` + 构建后断言 `require` 集合（可写成一条测试） |

### 7.3 后续增强排期（非本次升级范围）

1. **右栏 tab**：把 `RefLibPanel` 从 Modal 升级为 `ctx.sidebarRightTabs` + `sidebar.right.pane.tab`
   （0.1.5-alpha.1 起可用；照抄 `ui-sidebar-documentpreview` 的公开注册路径）。
2. **导入来源排序与侧边栏同口径**：`workspaceRegistry.pinnedSessionIds`。
3. **目录浏览器对齐原生**：`ctx.uiWorkspace.createDirectory`（"新建文件夹"）。
4. **`/ref-lib` 参数补全**：`ctx.inputTriggers.registerSource`（若确认对第三方开放）。
5. **瘦身评估**：把 sidecar 迁到 `ctx.storageDomain` 是否值得（见 §2.3）。

---

## 8. 附录：证据速查表

### 8.1 版本与发布（2026-09-25 实测）

| 项 | 值 |
| --- | --- |
| 评估对象 | deepseek-harness `HEAD` = `477b4f4205`，tag `dsh-v0.1.7-rc.2`（2026-09-25） |
| 本机宿主 | `dsh --version` = `0.1.2-rc.1` |
| npm `@deepseek-ai/dsh` | `latest` = `0.1.5-rc.3`；`next` = `0.1.7-rc.2`；`alpha` = `0.1.7-alpha.2` |
| 依赖族 | 消费的全部 19 个包均发布 `0.1.7-rc.2`（`next`）；`0.1.5-rc.3` 亦齐备 |
| cordis | 仓库 vendored 4.0.4；npm `latest` 4.0.4；我方 peer `^4.0.1` 覆盖 |
| 提交规模 | `dsh-v0.1.2-rc.1..dsh-v0.1.7-rc.2` = 3432 非 merge 提交 |
| 探针 | `.probe-017/`（已删）：`tsc` 23 错（全图标）、`vitest` 229/231 |

### 8.2 关键源码锚点（HEAD）

| 主题 | 锚点 |
| --- | --- |
| 图标改名决策 | `.agents/notes/implemented/architecture/2026-09-16-size-neutral-product-icon-weights.md`（提交 `4937343a5e`） |
| 图标新名与新权重 | `packages/client/ui-primitives/src/icons/index.tsx:1-34, 931-939` |
| peer 兼容闸门 | `packages/boot/app-boot/src/plugin-compatibility.ts:61-88`；`plugin-manager/src/index.ts:301, 546, 722` |
| module-table seed | `packages/client/web/src/platform.ts:8-18`；`seed.ts:28-38` |
| client manifest 契约 | `packages/util/package-manifest/src/types.ts:80-93`；`packages/client/modules/src/index.ts:195-205, 834-854` |
| 模块表未命中报错 | `packages/client/modules/src/client/system.ts:319-330` |
| `systemPrompt.context` | `packages/core/system-prompt/src/index.ts:489-498`；`CONTEXT_ORDERS` `:164-171` |
| `PromptContext` 语义（durable user-role 快照） | `docs/subsystems/system-prompt.md:70-86`（0.1.2-rc.1 与 HEAD **逐字相同**） |
| `commands.register` / `CommandResult` | `packages/interaction/commands/src/index.ts:285-292`；`types.ts:33-41` |
| `WebRoute` / `register` | `packages/host/webserver/src/index.ts:38-48, 166-173`；护栏责任见 `README.md:113` |
| `session/created` | `packages/core/session/src/index.ts:55`；同步抛错回滚语义 `:986-996, 1152-1163` |
| `snapshotEvents` deprecated | `packages/core/session/src/index.ts:639-655` |
| 会话格式版本与迁移链 | `packages/core/session/src/types.ts:89`；`packages/session/session-format-catalog/src/generated.ts:15-32` |
| v0→v1 拒绝未知事件（含 ignorable） | `packages/session/session-format-v0-to-v1/src/validation.ts:117-126`；测试 `tests/validation.spec.ts:329-333` |
| 同版本读取仍认 ignorable | `packages/session/session-format-v3-to-v4/src/validation.ts:59-62` |
| 白名单与 append 无 ignorable 通道 | `packages/core/session/src/known-event-types.ts:8-22`；`index.ts:715-733` |
| jsonl 持久化默认导出 | `@deepseek-ai/dsh-session-persistence-jsonl@0.1.7-rc.2` `lib/types/index.d.ts`（`export default` only） |
| dock / commandview 槽位 | `packages/client/ui-conversation/src/client/contract/slots.ts:195, 307-311`；`packages/client/ui-chat/src/client/contract/slots.ts:205-211, 274-277, 309` |
| 命令卡片仍受限（自研卡片仍有必要） | `packages/client/ui-chat/src/client/chat/GenericCommandCard.module.css:35-36, 51` |
| `useChat` 官方同款读法 | `packages/client/ui-chat/src/client/chat/StatsPills.tsx:318` |
| 右栏 tab 注册表 | `packages/client/ui-sidebar-right/README.md`（"Extension seats"）；`src/client/index.ts:89, 122` |
| pinned 排序 | `packages/workspace/workspace/src/index.ts:410-416, 426, 453` |
| `createDirectory` | `packages/client/ui-workspace/src/client/navigation.ts:105`（实现 `:277`）；`DirectoryBrowseError` `:116` |

### 8.3 本仓库受影响的锚点

| 项 | 位置 |
| --- | --- |
| 图标使用（13 个 / 51 处 / 5 文件） | `src/client/{RefLibBrowser,RefLibPanel,RefLibImport,RefLibCommandCard,RefLibDock}.tsx` |
| L2 具名导入 | `tests/harness-roundtrip.spec.ts:20`（`boot()` 在 `:32-37`） |
| legacy 折叠与 deprecated 调用 | `src/service.ts:702-710`（`foldRefLibs` / `snapshotEvents()`） |
| 注入 seam | `src/index.ts:141-150`（`reference-libs:policy`，`order: 150`） |
| 路由注册 | `src/index.ts:51-60`；护栏 `src/routes.ts:31-51` |
| 槽位注册 | `src/client/index.ts:128-154`；`inject` `:38` |
| 打包 externals | `tsdown.config.ts:15-22` |
| 需纠正的过期声明 | `AGENTS.md` §5 附加约定 2；`src/service.ts` 头部注释 |

---

## 附：一句话给未来的自己

> 0.1.2 → 0.1.7 平台改了 3432 个提交，但 ref-lib 的消费面只断了**一处图标改名**和
> **一处默认导出**。真正需要警惕的不是 API，而是**语义迁移**（格式版本升级让旧日志不可读）
> 和**认知漂移**（平台补齐机制层后，插件容易在高价值的产品层之外继续堆机制层代码）。
