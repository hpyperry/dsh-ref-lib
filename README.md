# ref-lib — 只读参考库插件

> **@hpyperry/dsh-ref-lib** · DeepSeek Harness 插件 · node half + client UI
> 状态：**已交付**
>
> 入口为输入卡正上方的「参考库」胶囊（`conversation.input.dock` 独立一行）：纯 CSS 与
> 输入卡左缘对齐、零测量，根除与"标准模式"按钮的重叠竞态。

---

## ✨ 插件能力

在任意会话上维护**多个只读参考库**（如 `core`），让 agent 自动感知这些库的存在、
用途与只读约束——需要查证时**先在参考库检索**，而不是凭空猜测或直接搜网。

| | 能力 | 说明 |
| --- | --- | --- |
| 🚀 | **统一入口** | 输入卡正上方的「参考库」胶囊（`conversation.input.dock` 独立一行）：hero 与 active 统一可见，纯 CSS 与输入卡左缘对齐（零测量、零竞态）；带当前会话的库数量徽标 |
| 🎨 | **可视化面板** | 设计令牌风格：**基名 + 完整路径**列表、悬停高亮、危险色移除、独立的空/加载/错误态；窄视口自适应 |
| 📂 | **三种添加方式** | 应用内目录浏览器（browse 后端，面包屑/路径编辑/子目录，zh/en）/ 系统原生选择器（native 后端）——**按宿主能力自动适配**；另支持**手动输入路径**（`~` 与相对路径） |
| 🧠 | **上下文注入** | 仅向配置了参考库的会话注入：库清单 + **查询优先级**（先查参考库，未覆盖再查别的）+ 只读约束；空列表零 token |
| 🔒 | **per-session 隔离** | 每个会话独立维护，会话间互不可见；sidecar JSON 持久化，重启/恢复后仍在 |
| ⚡ | **静默数据通道** | client 读写走插件自注册的 `/api/ref-lib/*` HTTP 路由——不渲染命令卡片、不执行命令、不产生用户消息 |
| 🌐 | **双语界面** | zh/en 全量本地化（`ctx.locale`），随界面语言实时切换 |
| ⌨️ | **命令入口** | `/ref-lib add <path> | list | remove <id>`，与 UI 数据一致 |
| 🛡️ | **安全** | loopback 护栏 + 路径控制字符过滤 + 只读保证分层（沙箱强制 / 上下文软约束） |

## 🚀 快速开始

```sh
# 1. 安装（dsh plugin 负责维护 profile manifest 与依赖）
#    从 GitHub 安装：
dsh plugin --profile web add git+https://github.com/hpyperry/dsh-ref-lib.git
#    或本地开发路径：
#   dsh plugin --profile web add /path/to/ref-lib

# 2. 重启 dsh web 生效
dsh --profile web
```

- 重启后在**输入框上方**看到「参考库」胶囊（新会话与具体对话均可见）；
- 点开面板 → 添加目录（应用内浏览器/系统选择器/手动路径三选一）→ 列表出现 → 行尾垃圾桶移除；
- 或对话中 `/ref-lib add <path>`、`/ref-lib list`、`/ref-lib remove <id>`；
- 配置了参考库的会话，agent 会收到"先查参考库、禁止修改"的上下文指令。

## ⚙️ 机制

| 机制 | 参照 | ref-lib（本插件） |
| --- | --- | --- |
| 上下文注入 | `dsh-sandbox-policy`：`ctx.systemPrompt.context({ name, order, text })`（动态上下文，durable 快照，空文本零 token） | `reference-libs` 贡献：`ctx.inject(['systemPrompt'], ...)` + `context({ name: 'reference-libs', order: 150, text })`——**仅向配置了参考库的会话**注入库清单、查询优先级与只读约束（按 `context.agent?.session` 折叠） |
| UI 管理 | `ui-conversation` 的 `conversation.input.dock`（list 型 slot，per-session；输入框上方，hero 与 active 均渲染） | client 注册 **`conversation.input.dock`**「参考库」胶囊（order 200 排最后；**独立一行**，左缘经 `--dsh-composer-side-clearance`/`--dsh-composer-card-max-width` 官方令牌纯 CSS 与输入卡左缘对齐——**取消 hero 相位测量/绝对定位**，零 JS 测量、零竞态；数量徽标 + 管理面板） |
| 命令入口 | `/plan`（`ctx.commands.register`，经 `command/run` 事件） | `/ref-lib add <path>`、`/ref-lib list`、`/ref-lib remove <id>`——操作 `invocation.agent.session` |
| 状态存储 | plan-mode 的 per-session 事件 + 折叠 | **sidecar JSON**（`<dshHome>/plugin-data/ref-lib/<sessionId>.json`，`dshHomePath()` 解析）：随 dsh home 持久化/恢复，天然 session 隔离；旧日志 `ref-lib/set` 事件仅冷读折叠迁移一次（`foldRefLibs`），子会话无自身状态时继承 `parentSession` 的列表 |

### 数据通道

- **读/写**（打开面板/刷新/添加/移除）：client 经**普通同源 fetch** 访问插件在宿主
  `ctx.webServer`（`@deepseek-ai/dsh-host-webserver`）上自注册的 `/api/ref-lib/*`
  HTTP 路由（`GET /list`、`POST /add`、`POST /remove`），node 端读写 sidecar——
  **静默双向，不渲染命令卡片、不执行命令**（参照 dsh-ssh / dsh-persona-memory 先例）；
- **目录选择（能力自适应）**：browse 后端 → 应用内目录浏览器 `RefLibBrowser`
  （`ctx.workspaces.listDirectory()`，面包屑/路径编辑/子目录列表）；native 后端 →
  `ctx.workspaces.pickDirectory()` 系统原生对话框；探测一次并缓存，两种后端均可工作；
- `/ref-lib` 命令仍保留（对话内管理），与 UI 数据一致（同一 sidecar）。

> 注：plan-mode 的 `systemPrompt.section` 有"唯一 complete section"语义（多个会导致
> assembly 失败），不适合附加信息，故采用 `context`（与 `sandbox:policy` 一致）。

### 安全模型（/api/ref-lib/*）

与 harness 自身（api-proxy / dsh-ssh）同一信任模型——仅回环可访问（默认绑 127.0.0.1），
路由层再做 loopback 护栏（源地址 + Host + Origin 同源 + `Sec-Fetch-Site`，见
`src/routes.ts`），恶意网页 CSRF 与 LAN 访问均被拒。端点唯一的文件写入是**自己的
sidecar**（固定目录、session 隔离、原子写），`add` 只把"已存在的目录路径"记入列表，
不创建/修改目标路径文件；路径含控制字符会被拒绝（`RefLibPathError reason: 'unsafe'`），
渲染层再消毒一次（`render.ts`）。

### 只读保证（分层）

- **L1 沙箱天然只读（零代码）**：`read-only`/`workspace-write` 模式均全盘可读、
  仅 session workspace root 可写。**推荐用法：库放在 workspace 之外**，则 bash/fs
  进程级强制只读。
- **L2 上下文软约束（已实现）**：注入"禁止创建、修改或删除库内文件；如需改动先复制
  到工作区"。
- **L3 fs 写守卫（预留）**：`fs/write-intent` 单槽被 core 占用，拦截点应在
  `tools/execute`；暂不实现。

## 📁 目录结构（自包含工程）

```
ref-lib/
  package.json          # @hpyperry/dsh-ref-lib；dsh.bundle + dsh.client（双面插件）；运行时依赖为 peerDependencies
  .npmrc                # auto-install-peers=false；store-dir 指向工作区内 .pnpm-store
  tsconfig.json         # moduleResolution: bundler + rewriteRelativeImportExtensions + jsx: react-jsx + DOM lib
  tsdown.config.ts      # client bundle 构建（CJS + ModuleLoader.load 包装 + 平台模块 external）
  vitest.config.ts      # node 环境
  AGENTS.md             # 项目开发约定（core 查证/开发规范/测试标准 L0-L4/开发环境）
  src/
    spec.ts             # RefLibEntry 类型 + 旧 `ref-lib/set` 事件声明（仅迁移折叠用）
    logic.ts            # 折叠/列表变换纯函数（foldRefLibs/upsert/remove）
    render.ts           # 上下文注入文本（查询优先级 + 只读约束）/ list 输出渲染纯函数
    commands.ts         # /ref-lib 参数解析 + 路径解析（~ 展开 / 相对会话工作区）纯函数
    service.ts          # RefLibService（ctx.refLibs）：per-session add（realpath+目录校验）/ remove / list
    index.ts            # node 插件入口（Service 类）：服务 + 命令 + systemPrompt.context（按会话注入）
    client/
      index.ts          # client 插件入口：注册 dock 胶囊 + locale 字典
      RefLibDock.tsx    # 胶囊入口（数量徽标）+ 面板状态持有 + 能力探测（零测量，纯 CSS 对齐）
      RefLibPanel.tsx   # 管理面板（Modal）：列表/空态/加载态/错误态/添加表单
      RefLibBrowser.tsx # 应用内目录浏览器（browse 后端）：面包屑/路径编辑/子目录列表
      data.ts           # 路由响应/错误码解析纯函数（parseLibsPayload/parseApiErrorPayload/libBasename）
      locales.ts        # zh/en 字典（zh 为键集唯一来源，en 编译期逐键对齐）
      styles.ts         # 运行时样式注入（--dsw-* 设计令牌，随主题适配）
      validate.ts       # 共享校验/消毒纯函数（isRefLibEntry + 控制字符集合，node/client 共用）
  tests/                # vitest：logic/commands/render/service/plugin/loader/client-data/locales/routes/harness-roundtrip/validate（77 项）
  scripts/              # 事故修复/验证工具 + 隔离开发环境脚本（dev-isolate.sh）
  lib/                  # 构建产物：lib/index.js（node half, tsc）+ lib/client.js（client bundle, tsdown）
  README.md             # 本文件
```

依赖解析（无需 pnpm install 拉取运行时依赖）：`node_modules` 内 `@deepseek-ai`（含
cordis、dsh-commands、dsh-system-prompt 等）经 symlink 指向 npm -g 的
dsh 依赖树（`.../installation/lib/node_modules/@deepseek-ai/dsh/node_modules`），版本
与运行时一致（0.1.0-rc.6 / cordis 4.0.1）；dev 工具（typescript/vitest/@types/node）由
pnpm 安装。

## 📦 安装方式（npm -g dsh 环境）

本插件是标准 **组合包（bundle）**：`package.json` 声明 `dsh.bundle`（指向包内
`cordis.patch.yml`），用官方 `dsh plugin` 命令安装进 profile。

**正规安装**（推荐，`dsh plugin` 负责维护 profile manifest 与依赖）：

```sh
# 从 GitHub 安装
dsh plugin --profile web add git+https://github.com/hpyperry/dsh-ref-lib.git

# 本地开发期（改动即时生效）：指向仓库本地路径
# dsh plugin --profile web add /path/to/ref-lib
```

- 该命令在 `~/.dsh/profiles/web` 内转发给 pnpm：安装包（git / `file:` 依赖）并把本
  bundle 追加到 profile 的 `dsh.profile.bundles` 层列表；
- 重启 `dsh web` 生效（会话历史在 `~/.dsh/sessions` 不丢，当前对话会中断）；
- 卸载：`dsh plugin --profile web remove @hpyperry/dsh-ref-lib`。

**开发期替代**（等效，文档承认的 `--patch` overlay 方式，适合快速迭代）：

1. `~/.dsh/profiles/web/cordis.patch.yml` 追加：
   ```yaml
   - insert:
       - id: ref-lib
         name: '@hpyperry/dsh-ref-lib'
   ```
2. 让宿主可解析包名（二选一）：
   - `~/.dsh/profiles/web/package.json` 加 `"@hpyperry/dsh-ref-lib": "file:<ref-lib 仓库路径>"`，在该目录 `pnpm install`；
   - 或 `mkdir -p ~/.dsh/profiles/web/node_modules/@hpyperry && ln -s <ref-lib 仓库路径> ~/.dsh/profiles/web/node_modules/@hpyperry/dsh-ref-lib`
3. 重启 `dsh web`。

层顺序（`core/docs/user/develop/basic/publish.zh.md`）：profile 的 `dsh.profile.bundles`
（含本 bundle）→ profile 级 `cordis.patch.yml` → `--patch` overlays。

## ✅ 验证

```sh
cd ref-lib
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint（typescript-eslint recommended）+ prettier 风格（.prettierrc.json）
pnpm test        # vitest run（含 loader 级装载、client 数据、harness 边界回归（L2，事故防线）与路由/单测）
pnpm build       # tsc（node half）+ tsdown（client bundle）→ lib/
```

挂载后的手工验证：
1. 重启 `dsh web`（node half 变更必须重启），在**输入框上方**看到「参考库」胶囊
   （hero 与 active 均可见；已有参考库时带数量徽标）；
2. 添加：路径输入 + 「添加」，或「选择目录」（应用内浏览器 / 系统选择器按宿主自适应），
   或 `/ref-lib add <path>`；目录出现在列表（基名 + 完整路径）；行尾垃圾桶图标移除；
3. **新会话即可注入**：新建会话（hero）胶囊即在输入卡正上方，无需先进入对话；
4. 切换界面语言（设置 → General → Language），面板/胶囊/添加表单随 zh/en 切换；
5. **会话隔离**：A 会话添加的库在 B 会话看不到（数据在各自 sidecar，重启/恢复后仍在）；
6. 配置了参考库的会话，其上下文出现库清单、查询优先级与只读约束（未配置的会话不注入）；
7. 库在 workspace 外时，尝试写库内文件被沙箱拒绝。

## ⚠️ 已知限制

- **系统原生目录选择器可能卡顿且界面语言跟随 OS**：`pickDirectory()` 由
  host 原生 OS 对话框实现，打开慢且文案不可由插件控制。**缓解**：面板提供路径输入直加
  （绝大多数场景不必打开对话框）；若在 profile 的 `cordis.patch.yml` 把
  `directory-picker` 行切换为 `@deepseek-ai/dsh-host-directory-picker-browse`（含 client
  流 `dsh-client-ui-directory-picker-browse`），则使用**应用内目录浏览器**（快速、zh/en
  本地化，工作区选择与参考库选择都受益）。
- **settings 配置客户端白名单**（DSH rc.6 框架限制）：`api-proxy` 只允许硬编码白名单内
  的 namespace 被浏览器端读写（`exposedNamespaces()`），第三方插件 namespace 默认不可、
  无扩展点（官方标注为 deferred work）。
- UI 添加暂不支持备注（note 字段已在类型中预留）。
- **命令路径解析**：`/ref-lib add <path>` 支持绝对路径、`~`/`~/` 展开与相对路径——
  相对路径**基于当前会话工作区**（`agent.session.header.cwd`）解析，而非 dsh 进程启动目录。
- 版本注意：npm -g dsh 为 0.1.0-rc.6，core 源码为 0.1.0-rc.5，联调以运行时（npm-g）为准。

## 🧪 测试与开发环境（2026-08-17 事故后确立）

分层测试标准见本仓库 `AGENTS.md` §6（工作区所有插件的参考实现）：

- **L2 harness 边界回归** `tests/harness-roundtrip.spec.ts`：真实 `SessionStore` +
  `JsonlSessionPersistence` + 临时根，验证会话日志可冷加载且不含
  `ref-lib/set`；「陷阱守卫」用例固化事故行为（写白名单外事件 → 冷加载必须抛
  `SessionFormatUnsupportedError`）；
- **L3 隔离开发环境** `scripts/dev-isolate.sh`：`DSH_HOME`（默认 `~/.dsh-dev`）+
  独立 profile 启动 dsh web，真实 `~/.dsh` 零接触；`rm -rf ~/.dsh-dev` 即重置；
- **L4 事故修复工具** `scripts/patch-ref-lib-logs.mjs`（补 `ignorable: true`）与
  `scripts/verify-ref-lib-logs.mjs`（GUI 同款加载器验证），见「已知限制」。

### 隔离开发环境使用速查（dev-isolate）

> 隔离环境 = 独立 `DSH_HOME`（默认 `~/.dsh-dev`）里一套独立的 profile/会话/设置，
> 与真实 `~/.dsh` 完全隔离，`rm -rf` 即重置。开发/联调一律在这里跑，绝不碰真实数据。
> 关键点：所有管理命令加 `DSH_HOME=<隔离目录>` 前缀；不加前缀就操作真实环境。

**启动隔离 web**（首次运行自动把插件装进隔离 profile，之后是纯启动）：

```sh
# 在 ref-lib 目录下（默认 PLUGIN=ref-lib 自身、DEV_HOME=~/.dsh-dev、PROFILE=web）
./scripts/dev-isolate.sh

# 自定义插件/隔离目录/端口（真实 dsh web 占着 3080 时务必换端口）
PLUGIN=/path/to/plugin DEV_HOME=/tmp/dsh-dev ./scripts/dev-isolate.sh --port 3090
```

**插件的安装 / 卸载 / 查看**（`dsh plugin` 是 pnpm 薄转发器：参数原样转给隔离 profile
目录里的 pnpm，装完/卸完自动对账 `dsh.profile.bundles`）：

```sh
DEV_HOME="${DEV_HOME:-$HOME/.dsh-dev}"

DSH_HOME="$DEV_HOME" dsh plugin --profile web add /path/to/ref-lib   # 或 git+https://github.com/hpyperry/dsh-ref-lib.git
DSH_HOME="$DEV_HOME" dsh plugin --profile web remove @hpyperry/dsh-ref-lib
DSH_HOME="$DEV_HOME" dsh plugin --profile web list
```

- 安装本地插件前先 `cd ref-lib && pnpm build`（`main` 指向 `lib/index.js`，缺产物会
  加载失败）；改完插件集需**重启**隔离 web 生效；
- **配置覆盖**：`$DEV_HOME/profiles/web/cordis.patch.yml` 是隔离 profile 的补丁层；
  `DSH_HOME="$DEV_HOME" dsh --profile web --dump-config` 查看组合后的完整树。

**热更新与重置**：

| 场景 | 做法 |
| --- | --- |
| 只改 `src/client/*`（UI） | `cd ref-lib && pnpm build:client` → 浏览器 ≤0.5s 热更新，无需重启 |
| 改 node half（服务/路由/注入） | `pnpm build:node` 后**重启**隔离 web |
| 完全重置 | `rm -rf "$DEV_HOME"`，下次 `dev-isolate.sh` 重新初始化 |

**真实环境对照**：同样的命令去掉 `DSH_HOME=` 前缀即作用于真实 profile
（真实补丁在 `~/.dsh/profiles/web/cordis.patch.yml`）。

## 🔄 热重载

`dsh-client-hmr` 在 web profile 中无条件挂载（每 500ms 轮询 client bundle 文件，经 SSE
热替换）：

| 改动 | 生效方式 |
| --- | --- |
| `src/client/*`（UI） | `pnpm build:client`（或 `pnpm build`）后浏览器最多 0.5s 自动热更新——**无需重启、无需刷新**（样式经运行时注入，随 bundle 一起热替换） |
| `src/` 其余（node half：服务/命令/注入） | `pnpm build:node` 后**必须重启 `dsh web`**（会话历史不丢，当前对话中断） |
| 插件集变更（新增 client 包、改 `dsh.client` 声明） | 必须重启（clientModules 元数据按包名缓存） |
