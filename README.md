# dsh-ref-lib · 只读参考库

> DeepSeek Harness（DSH）插件：给任意会话挂上**只读参考库**，agent 需要查证时
> **先在参考库里检索**——而不是凭空猜测或直接搜网。
>
> 安装：`dsh plugin --profile web add @hpyperry/dsh-ref-lib`

## ✨ 特性

| | 能力 | 说明 |
| --- | --- | --- |
| 🚀 | **统一入口** | 输入卡正上方的「参考库」胶囊（hero / active 常显、带数量徽标）——纯 CSS 与输入卡左缘对齐，零测量、零竞态 |
| 🎨 | **可视化面板** | 基名 + 完整路径列表、用途说明、悬停高亮、危险色移除、独立的空/加载/错误态 |
| 📂 | **三种添加方式** | 应用内目录浏览器 / 系统原生选择器（按宿主能力自动适配）/ 手动输入路径（`~` 与相对路径），可附**用途说明**（自动提取 README 标题兜底） |
| 🧠 | **上下文注入** | 仅向配置了参考库的会话注入定稿英文规则：库清单（含用途 routing metadata）+ **强制查证流程**（先查参考库，未覆盖才外部）+ 权威性/冲突处理 + 只读约束；空列表零 token |
| 🔒 | **per-session 隔离** | 每个会话独立维护，会话间互不可见；**分支会话（fork）自动继承父列表**（fork 时刻快照、条目 id 独立）；sidecar JSON 持久化，重启/恢复后仍在 |
| 🔁 | **跨会话导入** | 从其他会话挑选参考库条目导入当前会话（快照副本、不回流）：三步流程（选会话 → 勾条目 → 冲突项处理），来源会话**按工作区分组**（组头可折叠、**默认全折叠**；未归属工作区的会话归入「未分组」）；**按组懒加载**（会话多也不卡——组概览轻量不读标题，展开某组才加载该组会话并缓存）；重复项并排 diff 对比（用途说明/可用状态差异高亮）逐条选择「保留现有/采用导入」；命令 `/ref-lib import [会话] [路径...]` 同语义（输出同样分组）；**已归档会话自动排除**（host 工作区归档集合过滤） |
| 📡 | **失效检测** | 每次读取实时探测库目录可用性（删除 / 被替换为文件即标记），失效库自动跳过注入并红色提示（面板状态行 + dock 失效角标 + `/ref-lib list` 标记）；UI 同步**交互驱动**（命令完成 / 发消息 / 面板操作即时刷新，零后台请求） |
| ⚡ | **静默数据通道** | client 读写走插件自注册的 `/api/ref-lib/*` HTTP 路由——不渲染命令卡片、不执行命令、不产生用户消息 |
| 🌐 | **双语界面** | zh/en 全量本地化，随界面语言实时切换 |
| ⌨️ | **命令入口** | `/ref-lib add <path> [--note <用途>] \| list \| remove <id> \| import [会话] [路径...]`，与 UI 数据一致；结果走专属卡片（全展开完整文本 + 一键复制，规避官方卡片的截断显示） |
| 🛡️ | **安全** | loopback 护栏 + 路径消毒 + 只读保证分层（沙箱强制 / 上下文软约束） |

## 📦 安装

```bash
# 使用npm
dsh plugin --profile web add @hpyperry/dsh-ref-lib

# 本地开发期（改动即时生效）：指向仓库本地路径
# dsh plugin --profile web add /path/to/ref-lib

# 重启生效
dsh --profile web
```

卸载：`dsh plugin --profile web remove @hpyperry/dsh-ref-lib`

## 🚀 快速开始

1. 重启后在**输入卡正上方**看到「参考库」胶囊（新会话与具体对话均可见）；
2. 点开面板 → 添加目录（应用内浏览器 / 系统选择器 / 手动路径三选一）→ 列表出现 → 行尾垃圾桶移除；
3. 或对话内命令：`/ref-lib add <path> [--note <用途>]`、`/ref-lib list`、`/ref-lib remove <id>`、`/ref-lib import [会话] [路径...]`；
4. 想把别的会话里配好的参考库搬过来：面板「从会话导入」或 `/ref-lib import`——三步挑选，重复项逐条决定保留现有还是采用导入；
5. 配置了参考库的会话，agent 会收到定稿英文的"参考库规则"上下文指令——查证规范/API/项目事实时**必须先查参考库**（未覆盖才允许外部途径并自报），且禁止修改库内文件。

## ⚙️ 行为与配置

开箱即用，无配置文件。几个可说明的行为：

| 项 | 说明 |
| --- | --- |
| 数据存储 | `<dshHome>/plugin-data/ref-lib/<sessionId>.json`（per-session sidecar，随 dsh home 持久化） |
| 用途说明（note） | 添加时可选填写；未填写时自动提取目录 README 首个 H1 标题兜底（无 README 则为空）。note 作为 routing metadata 注入，帮助 agent 判断库的相关性；可在面板条目详情中随时编辑 |
| 跨会话导入 | 导入为**快照副本、不回流**——新条目重新铸造 id、note 保持源值；「采用导入」仅以导入侧 note 替换现有条目（保留现有 id）。重复判定按规范化绝对路径；源会话读取实时探测可用性、不写回；**按工作区分组**（经 host `workspaceRegistry` 按 sessionId 精确映射，组顺序按组内最近活跃；未归属工作区的会话归入「未分组」、行内附 cwd 基名）；**懒加载**（`groups=1` 组概览不读标题，展开组 `group=<key>` 才加载该组会话——标题冷读随会话总量增长被消解）；**已归档会话不列**——来源清单经 host `workspaceRegistry.archivedSessionIds` 过滤（归档只隐藏工作区树，会话仍在，取消归档后自动恢复可导入）；无标题会话显示"新会话"（分组后不再拼"工作区名 · "前缀） |
| 目录选择后端 | 启动时自动探测：应用内目录浏览器（browse）或系统原生对话框（native）；可在 profile 的 `cordis.patch.yml` 切换 `directory-picker` 行为 |
| 上下文注入 | 仅向有参考库的会话注入（`systemPrompt.context`，空列表零 token；注入文本为定稿英文模板） |
| 子会话 | 分支会话（fork）创建时**复制继承**父会话的参考库列表（fork 时刻快照、条目 id 独立）；legacy 子会话（升级前创建）首次读取时同语义物化 |

## 🛡️ 安全

- `/api/ref-lib/*` 走宿主 `ctx.webServer` 同源路由，loopback 护栏（源地址 + Host + Origin + `Sec-Fetch-Site`），恶意网页 CSRF 与 LAN 访问均被拒；
- 端点唯一的文件写入是**自己的 sidecar**（固定目录、session 隔离、原子写）；`add` 只把"已存在的目录路径"记入列表，不创建/修改目标路径文件；
- **只读保证分层**：库放在 workspace 之外 → 沙箱进程级强制只读（`read-only`/`workspace-write` 模式均只读）；上下文再注入软约束（"禁止创建、修改或删除库内文件"）。

## ⚠️ 已知限制

- **系统原生目录选择器可能卡顿且界面语言跟随 OS**：可用「手动输入路径」绕开；或在 profile 把 `directory-picker` 切换为 `@deepseek-ai/dsh-host-directory-picker-browse`（应用内浏览器，快速且 zh/en 本地化）；
- **settings 配置客户端白名单**（DSH rc.6 框架限制）：第三方插件 namespace 默认不可被浏览器端读写，官方标注为 deferred work；
- `/ref-lib add <path>` 的相对路径**基于当前会话工作区**解析，而非 dsh 进程启动目录；
- 导入只做**单向快照**：导入后源会话的变化不会回流；同路径再次导入仍是重复项处理（保留现有 / 采用导入），不会自动合并。
- **已归档会话不在导入来源中**：host「归档会话」把会话从工作区树隐藏，导入来源清单同样过滤（不显示、不可选、命令也无法解析到）；需要时先在 GUI 取消归档。
- **分组口径与宿主工作区树一致**：只按**注册工作区**精确映射（cwd 是工作区子目录、或未注册的临时目录会话归入「未分组」；两个工作区同名时合并为一组）。

## 🧑‍💻 开发

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint（typescript-eslint recommended）+ prettier
pnpm test        # vitest（L0–L2：纯函数 / 装载 / harness 边界回归）
pnpm build       # tsc（node half）+ tsdown（client bundle）→ lib/
```

- **结构**：`src/`（node half：服务 / `/api/ref-lib/*` 路由 / `/ref-lib` 命令 / 上下文注入）+ `src/client/`（web half：dock 胶囊 / 管理面板 / 目录浏览器 / 本地化）+ `tests/`；
- **隔离开发环境**：`scripts/dev-isolate.sh`（独立 `DSH_HOME`，默认 `~/.dsh-dev`，真实 `~/.dsh` 零接触；`rm -rf` 即重置）——启动/安装/热更新/重置的完整用法见仓库 `AGENTS.md`；
- **热更新**：`src/client/*` 改动 `pnpm build:client` 后浏览器 ≤0.5s 自动热更新；node half 改动需重启 `dsh web`。

## 📄 License

[MIT](LICENSE)，与 DeepSeek Harness 一致。

## 📚 更多

- 项目开发约定（开发规范 / 测试标准 / 开发环境）：见仓库 `AGENTS.md`
- 仓库：<https://github.com/hpyperry/dsh-ref-lib>
