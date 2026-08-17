# dsh-ref-lib · 只读参考库

> DeepSeek Harness（DSH）插件：给任意会话挂上**只读参考库**，agent 需要查证时
> **先在参考库里检索**——而不是凭空猜测或直接搜网。
>
> 安装：`dsh plugin --profile web add git+https://github.com/hpyperry/dsh-ref-lib.git`

## ✨ 特性

| | 能力 | 说明 |
| --- | --- | --- |
| 🚀 | **统一入口** | 输入卡正上方的「参考库」胶囊（hero / active 常显、带数量徽标）——纯 CSS 与输入卡左缘对齐，零测量、零竞态 |
| 🎨 | **可视化面板** | 基名 + 完整路径列表、悬停高亮、危险色移除、独立的空/加载/错误态 |
| 📂 | **三种添加方式** | 应用内目录浏览器 / 系统原生选择器（按宿主能力自动适配）/ 手动输入路径（`~` 与相对路径） |
| 🧠 | **上下文注入** | 仅向配置了参考库的会话注入：库清单 + **查询优先级**（先查参考库，未覆盖再查别的）+ 只读约束；空列表零 token |
| 🔒 | **per-session 隔离** | 每个会话独立维护，会话间互不可见；sidecar JSON 持久化，重启/恢复后仍在 |
| ⚡ | **静默数据通道** | client 读写走插件自注册的 `/api/ref-lib/*` HTTP 路由——不渲染命令卡片、不执行命令、不产生用户消息 |
| 🌐 | **双语界面** | zh/en 全量本地化，随界面语言实时切换 |
| ⌨️ | **命令入口** | `/ref-lib add <path> \| list \| remove <id>`，与 UI 数据一致 |
| 🛡️ | **安全** | loopback 护栏 + 路径消毒 + 只读保证分层（沙箱强制 / 上下文软约束） |

## 📦 安装

```bash
# 从 GitHub 安装（dsh plugin 负责维护 profile manifest 与依赖）
dsh plugin --profile web add git+https://github.com/hpyperry/dsh-ref-lib.git

# 本地开发期（改动即时生效）：指向仓库本地路径
# dsh plugin --profile web add /path/to/ref-lib

# 重启生效
dsh --profile web
```

卸载：`dsh plugin --profile web remove @hpyperry/dsh-ref-lib`

## 🚀 快速开始

1. 重启后在**输入卡正上方**看到「参考库」胶囊（新会话与具体对话均可见）；
2. 点开面板 → 添加目录（应用内浏览器 / 系统选择器 / 手动路径三选一）→ 列表出现 → 行尾垃圾桶移除；
3. 或对话内命令：`/ref-lib add <path>`、`/ref-lib list`、`/ref-lib remove <id>`；
4. 配置了参考库的会话，agent 会收到"先查参考库、禁止修改库内文件"的上下文指令——
   需要查证时它会先在参考库里检索。

## ⚙️ 行为与配置

开箱即用，无配置文件。几个可说明的行为：

| 项 | 说明 |
| --- | --- |
| 数据存储 | `<dshHome>/plugin-data/ref-lib/<sessionId>.json`（per-session sidecar，随 dsh home 持久化） |
| 目录选择后端 | 启动时自动探测：应用内目录浏览器（browse）或系统原生对话框（native）；可在 profile 的 `cordis.patch.yml` 切换 `directory-picker` 行为 |
| 上下文注入 | 仅向有参考库的会话注入（`systemPrompt.context`，空列表零 token） |
| 子会话 | 无自身配置时继承父会话的参考库列表 |

## 🛡️ 安全

- `/api/ref-lib/*` 走宿主 `ctx.webServer` 同源路由，loopback 护栏（源地址 + Host + Origin + `Sec-Fetch-Site`），恶意网页 CSRF 与 LAN 访问均被拒；
- 端点唯一的文件写入是**自己的 sidecar**（固定目录、session 隔离、原子写）；`add` 只把"已存在的目录路径"记入列表，不创建/修改目标路径文件；
- **只读保证分层**：库放在 workspace 之外 → 沙箱进程级强制只读（`read-only`/`workspace-write` 模式均只读）；上下文再注入软约束（"禁止创建、修改或删除库内文件"）。

## ⚠️ 已知限制

- **系统原生目录选择器可能卡顿且界面语言跟随 OS**：可用「手动输入路径」绕开；或在 profile 把 `directory-picker` 切换为 `@deepseek-ai/dsh-host-directory-picker-browse`（应用内浏览器，快速且 zh/en 本地化）；
- **settings 配置客户端白名单**（DSH rc.6 框架限制）：第三方插件 namespace 默认不可被浏览器端读写，官方标注为 deferred work；
- UI 添加暂不支持备注（note 字段已在类型中预留）；
- `/ref-lib add <path>` 的相对路径**基于当前会话工作区**解析，而非 dsh 进程启动目录。

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

## 📚 更多

- 项目开发约定（core 查证规则 / 测试标准 / 环境）：见仓库 `AGENTS.md`
- 仓库：<https://github.com/hpyperry/dsh-ref-lib>
