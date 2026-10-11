# dsh-ref-lib · 只读参考库

给 DeepSeek Harness 的每个会话挂一个「只读参考库」：把本地目录（比如你的项目源码、内部文档）登记为参考库后，agent 回答前会**先去这些目录里查证**，查不到才允许走外部途径——而不是凭空猜或者直接上网搜。

> 装法见 [📦 安装](#安装)——一条命令装进 profile。**npm 上还没发新版**，当前从 GitHub Release 取 tarball。

## 它解决什么问题

- **答案有依据**：agent 查的是你指定的真实目录，涉及你的代码、接口、配置时，回答会更贴合实际。
- **每个会话独立**：这个会话配了参考库，不影响其他会话；分支会话（fork）会自动继承父会话的参考库。
- **只读、安全**：参考库目录对 agent 只读——能查、能引用，但不能创建或修改库里的文件。

## 安装

**当前用 GitHub Release 的 tarball 安装**（npm 上还没有新版，原因见下）：

```bash
# 1) 取最新 Release 的 tarball（不带 tag 就是 latest；也可以直接在浏览器打开 releases 页面下载）
gh release download --repo hpyperry/dsh-ref-lib --pattern '*.tgz'

# 2) 装进 profile
dsh plugin --profile web add ./hpyperry-dsh-ref-lib-*.tgz

# 卸载
dsh plugin --profile web remove @hpyperry/dsh-ref-lib
```

**一个插件版本通吃多代宿主**：插件自己按语义化版本号发布，能装在哪些 dsh 上由它的
`peerDependencies` 声明——当前是 `>=0.1.5-rc.2 <0.3.0-0`，也就是 **dsh 0.1.5 / 0.1.6 / 0.1.7 / 0.2.x 都能用同一份包**。

> 为什么能这样：到目前只有过一次客户端破坏，就是图标改名（0.1.7 起 `Icon*16` → `Icon*Regular`，
> 且两代名字不共存）。插件在取值处做了一次运行时回退（新名优先、旧名兜底），所以同一份
> bundle 在多代宿主上都能正确渲染，不必按宿主分版本发布。

**声明范围不等于每次都真机验过的范围**：`devDependencies` 只能钉一代（当前钉 `0.2.0-rc.2`），
每次升级做真机冒烟的就是这一代；区间里更早的宿主靠"代码与该世代最后一次真机验证的版本相同"背书，
而不是每个版本都重新回归一遍。

宿主不在这个范围里时，dsh 的兼容闸门会拒绝它：`plugin add` 直接报不兼容、不安装；按路径装进去的
则留在盘上，但 profile 启动时该插件会被禁用（stderr 打印 `disabling profile plugin …`）。
闸门只检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 这两类 peer 区间（`@deepseek-ai/cordis`、
`react` 不在其中），唯一豁免是
`dsh plugin --profile <profile> allow-version <包@版本> --dsh-version <宿主版本> --accept-risk`。

> ⚠️ **npm 上暂时不要裸装**：这个包在 npm 上只发布到历史的 **`0.17.0`**（目标宿主是 dsh
> 0.1.1-rc.2 那一代），而它的 peer 区间 `^0.1.2-rc.1` **能通过** 0.1.7 的兼容闸门——
> 装得上、闸门放行，但 bundle 里是 0.1.7 起已被删除的旧图标名，结果是**白屏**。
> 新版（`0.18.0` 及以后）**尚未发布到 npm**（账号仍锁着，`npm whoami` 返回 401），请用上面的 tarball 方式装。

安装完成后重启 `dsh web` 生效。本地开发期想改动即时生效，也可以直接指向仓库本地路径：`dsh plugin --profile web add /path/to/ref-lib`。

> **桌面端（Electron 应用）走应用内安装**：`desktop` profile 由应用独占，`dsh plugin --profile desktop …`
> 会被直接拒绝（`profile "desktop" is managed exclusively by the Electron application`）。请在应用的插件管理
> 界面里安装——它接受包名、本地路径、git 地址和 `.tgz` 直链，直链形如
> `https://github.com/hpyperry/dsh-ref-lib/releases/download/v<版本>/hpyperry-dsh-ref-lib-<版本>.tgz`。

## 快速上手

1. 重启后，**输入框正上方**会出现一个「参考库」胶囊，点开即见管理面板。
2. 添加目录，三种方式任选：
   - **应用内目录浏览器**：在面板里点开浏览选择（界面随语言本地化）；
   - **系统原生选择器**：走操作系统自带的目录对话框（界面语言跟随系统；启动时自动探测你的环境支持哪种，想手动切换可在 profile 的 `cordis.patch.yml` 里改 `directory-picker` 配置）；
   - **手动输入路径**：直接粘贴路径，支持 `~` 和相对路径（相对路径基于当前会话工作区解析）。
3. 可选：给每个库写一句**用途说明**（比如「xx 项目 API 文档」），不写也没关系——插件会自动从目录 README 的首个标题提取，实在没有就留空。
4. 开始对话。配置了参考库的会话，agent 会收到一份"查证规则"：涉及你的项目时**必须先查参考库**，查不到再走外部来源并说明；同时被要求不修改库内文件。

想验证效果，在对话里输入 `/ref-lib list`，应能看到你刚添加的库。

## 常用命令

UI 面板和命令操作的是同一份数据，按习惯用哪个都行。

| 命令 | 作用 |
| --- | --- |
| `/ref-lib add <path>` | 添加一个目录作为参考库 |
| `/ref-lib add <path> --note <用途>` | 添加时附上用途说明 |
| `/ref-lib list` | 列出当前会话的参考库（含失效标记） |
| `/ref-lib remove <id>` | 删除某个参考库 |
| `/ref-lib import [会话] [路径...]` | 从其他会话导入参考库（详见下文） |

命令结果以专属卡片展示，完整文本直接可见，并带一键复制。

## 跨会话导入

想把别的会话里配好的参考库搬过来，用面板里的「从会话导入」或 `/ref-lib import`。流程分三步：

1. **选会话**：只列出配过参考库的会话，按工作区分组显示（组头可折叠，默认收起；未归属工作区的归入「未分组」）。会话多也不卡——列表默认只显示概览，展开某组时才加载该组的会话。
2. **勾条目**：勾选要搬的条目，可全选（默认反选起步）。
3. **处理冲突**：当前会话里已有相同路径时，会并排对比两边差异（用途说明、可用状态的不同会按侧高亮），逐条决定「保留现有」还是「采用导入」。

几个要点：

- 导入是**快照副本，不回流**——导入后源会话的改动不会同步过来，两边从此各自独立。
- 已归档的会话不会出现在导入来源里；空白会话（从未开始过对话）和对话中分发的子代理会话同样不列出——和宿主侧边栏的展示口径一致。
- 命令模式 `/ref-lib import` 语义相同，只是遇到冲突会直接跳过该条目。

## 它是怎么工作的

| 你想知道的 | 答案 |
| --- | --- |
| 数据存在哪 | `<dshHome>/plugin-data/ref-lib/<sessionId>.json`，每个会话一个文件，随 dsh home 一起持久化，重启不丢 |
| 怎么注入给 agent | 只给配了参考库的会话注入（走 `systemPrompt.context`）；参考库为空时不注入，零 token 开销。注入内容为定稿英文规则：库清单（含用途说明作为路由元数据）+ 强制查证流程 + 权威性/冲突处理 + 只读约束 |
| 用途说明 | 添加时可选填写；自动提取目录 README 首标题兜底。它帮助 agent 判断"这个库和当前问题相不相关"，之后可在面板条目详情里随时改 |
| 分支会话 | fork 出的新会话在创建那一刻复制父会话的参考库快照，条目独立成新身份；两边之后各改各的 |
| 失效检测 | 每次读取都实时探测目录是否还在（被删除或换成了普通文件即判失效）。失效库不再注入上下文，并在面板状态行、胶囊角标、`/ref-lib list` 里红色标出；失效条目只能移除，不能编辑或重新打开 |
| UI 刷新 | 面板数据由交互驱动：执行 `/ref-lib` 命令、发消息、面板操作后即时刷新，没有后台轮询；外部改动了文件，下次界面交互时同步 |

## 安全

- 所有读写走插件自注册的 `/api/ref-lib/*` 路由，带 loopback 护栏（校验源地址、Host、Origin 等），恶意网页和局域网访问都会被拒。
- 插件唯一会写入的文件是它自己的 sidecar（固定目录、会话隔离、原子写）；「添加」只是把"已存在的目录路径"记进列表，不会创建或修改目标目录里的任何文件。
- 只读保证有两层：参考库目录在 workspace 之外时，沙箱从进程层面强制只读；上下文注入再补一层软约束（要求 agent 禁止修改库内文件）。

## 已知限制

- **系统原生目录选择器可能卡顿，界面语言跟随操作系统**：嫌它难用就手动输路径，或在 profile 的 `cordis.patch.yml` 里把 `directory-picker` 切到 `@deepseek-ai/dsh-host-directory-picker-browse`（应用内浏览器）。
- **settings 配置客户端白名单**（DSH 框架限制）：第三方插件的 namespace 默认不能被浏览器端读写，官方标注为 deferred work。
- **相对路径的基准**：`/ref-lib add` 的相对路径基于当前会话工作区解析，不是 dsh 进程的启动目录。
- **导入是单向的**：导入后源会话的改动不会回流；同路径再次导入仍走冲突处理，不会自动合并。
- **部分会话不在导入来源里**：归档会话、空白会话、子代理会话都不列出（见上文），需要时先在 GUI 里取消归档。
- **同一个 home 不要同时开两个 dsh 实例**：会话在进程内是**独占**的（谁先打开谁持有 `session.lock`），
  另一个实例拿不到它，面板会提示「该会话正在另一个 dsh 实例中运行」。参考库按会话管理，请固定在
  拥有该会话的那个实例里操作；两个实例共写同一个 sidecar 也会互相覆盖（整文件写入，没有锁）。

## 开发

```bash
pnpm typecheck   # 类型检查（tsc --noEmit）
pnpm lint        # eslint（门禁之一）
pnpm format      # prettier --write（可选，不进 CI；仓库现有代码未全量 prettier 化）
pnpm test        # vitest：L0 纯函数 / L1 装配与真实语义 / L2 harness 边界回归
pnpm build       # 构建 node half（tsc）+ client bundle（tsdown）→ lib/
```

- **测试分三档**（L0 纯函数 / L1 装配与真实语义 / L2 harness 边界回归）：每个测试文件的第一行都标了自己属于哪档，完整定义、文件归属与那道事故防线见 [`docs/agents/testing.md`](docs/agents/testing.md)。
- **代码结构**：`src/` 是 node half（服务、`/api/ref-lib/*` 路由、`/ref-lib` 命令、上下文注入），`src/client/` 是 web half（dock 胶囊、管理面板、目录浏览器、本地化），`tests/` 是测试。
- **一条命令起联调环境**：`scripts/dev-isolate.sh` 会自动做四件事——按通道拉一份**临时** dsh（不装全局）、把 sk 从真实 home 复制进隔离 home、**重装插件**（吃到当前源码最新构建）、启动 web。真实 `~/.dsh` 全程零写入。

  ```bash
  ./scripts/dev-isolate.sh              # 跟本插件所跟踪的通道（dsh npm next），home=.dsh-dev/next，端口 3090
  TRACK=main ./scripts/dev-isolate.sh   # 测别的 dist-tag（main = latest，0.1.5/0.1.6 线），端口 3091
  ```

  - 隔离 home 放在**仓库内**（`.dsh-dev/<track>`，**已 gitignore**）——这样 agent/CI 也能直接起环境，不依赖 `$HOME` 写权限。home 里有从真实 home 复制来的 sk 与会话副本，脚本启动时用 `git check-ignore` **实测**它确实被忽略，没被忽略就直接报错退出（删掉 `.gitignore` 里那行会立刻失败）。
  - **每次运行只重装插件**；home 里的 `sessions/`、`storages/`、`.credentials.yaml`、`settings.yaml` **一律保留**（想清插件自身数据才用 `RESET_PLUGIN_DATA=1`）。
  - 脚本会校验**宿主范围**——dsh 版本是否落在插件 `package.json` 声明的 `dsh-*` peer 区间内，不在范围内会警告；`STRICT_VERSION=1` 直接报错。
  - 其余开关（`BUILD` / `SEED_CREDENTIALS` / `KEEP_TOOLS` / `DSH_CACHE_DIR` / `PORT` / `DSH_VERSION`）见脚本头注释。想彻底重置：`rm -rf .dsh-dev/next`（**会连会话与 sk 一起删**）。`TRACK` 可传任意 npm dist-tag（默认 `next` = 本插件所跟踪的通道，端口 3090；`main` = `latest`，端口 3091）。
  - **默认是 link 安装**：profile 指向仓库目录，改代码能热更新。要一份不受仓库影响的冻结副本：`INSTALL_MODE=pack`（先 `pnpm pack` 再装，自带构建产物；tarball 打在仓库根，已 gitignore）。
- **把真实环境升到新通道**（不是联调）：`scripts/upgrade-host.sh` —— 升全局 dsh + 把插件重装成 tarball 冻结副本。它会动真实 `~/.dsh`，所以**默认先整目录备份、打印计划并要求输入 `yes`**，也不碰你正在跑的 `dsh web`（只打印重启命令）。先 `--check` 干跑：

  ```bash
  ./scripts/upgrade-host.sh --check      # 干跑：只看现状与计划
  ./scripts/upgrade-host.sh              # 升到 npm next + 换插件（备份 → 确认 → 执行）
  SKIP_HOST=1 ./scripts/upgrade-host.sh  # 只换插件，宿主不动
  ```

- **只想拿一个指定版本的 dsh**：`scripts/dsh-local.sh`（stdout 只打印 bin 路径，非全局安装）。

  ```bash
  ./scripts/dsh-local.sh --print-version                       # 该通道当前版本号
  DSH_BIN="$(./scripts/dsh-local.sh)"                          # 装到临时目录并打印 bin
  DSH_CACHE_DIR=~/.dsh-tools ./scripts/dsh-local.sh            # 缓存复用，不重复下载
  ```
- **热更新**：改 `src/client/*` 后跑 `pnpm build:client`，浏览器约 0.5 秒内生效；改 node half 需要重启 `dsh web`。

### 发布（维护者）

插件按**自己的语义化版本号**发布（当前 `0.18.0`），不再跟 dsh 版本号绑定；能装在哪代 dsh
由 `package.json` 的 `dsh-*` peer 区间决定。dsh 发新版时只需要复核这个区间，不必改版本号。

**打 tag 即自动打包并挂 Release（推荐）**——把 `package.json` 的 `version` 改成目标版本并提交，然后：

```bash
git tag -a v0.20.0 -m "0.20.0" && git push origin v0.20.0
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) 会跑门禁 → 构建 → `pnpm pack`，
再把 tar 挂到同名 Release（不存在则用 `--generate-notes` 创建，已存在则覆盖同名 asset）。
**版本号带 `-rc` / `-alpha` / `-beta` 时自动创建为 pre-release**（与 dsh 的命名节奏一致）。
**tag 名必须等于 `v<package.json 的 version>`**，不一致工作流直接失败（防止发错版）。
只想拿一个 tar 而不发版：在 Actions 页手动触发同一个工作流，tar 作为 artifact 下载。

**npm —— dist-tag 与 dsh 同构**：预发布进 `next`，正式版进 `latest`。**目前尚未发布**
（npm 账号锁定，`npm whoami` 返回 401；registry 上这个包只有历史的 `0.11.0 / 0.14.0 / 0.15.0 / 0.17.0`，
`latest = 0.17.0`，那版是 0.1.1-rc.2 时代的产物，见「安装」节的警告）。解锁后：

```bash
npm publish --tag latest    # 例：0.20.0（正式版，同时把 latest 从 0.17.0 挪过来）
npm publish --tag next      # 例：0.21.0-rc.1（预发布）
```

同一个 workflow 里已有「发布到 npm」一步，**只在仓库配置了 `NPM_TOKEN` secret 时才执行**；
配好后打 tag 即自动按版本号选 `next` / `latest`，不需要本地 npm 登录。

另外两件**只有账号解锁后才能做**的事（`0.17.0` 无法删除——见
[npm unpublish 政策](https://docs.npmjs.com/policies/unpublish)：超过 72 小时只能走 deprecation，
且 `name@version` 永久不可复用）：

```bash
# ① 废弃所有会白屏的旧版本
npm deprecate "@hpyperry/dsh-ref-lib@<=0.17.0" "旧版本基于 dsh 0.1.1-rc.2；在 0.1.7+ 宿主上会白屏，请升级"
# ② 确认 latest 指向新稳定版（正常发布时会自动指过去，可用这条兜底/核对）
npm dist-tag add @hpyperry/dsh-ref-lib@0.20.0 latest
```

- 发布包只含 `lib/` 与 `cordis.patch.yml`（`pnpm build` 先清空 `lib/` 再构建，不会带历史残留）；
  用户也可直接装打出的 tarball：`dsh plugin --profile web add ./hpyperry-dsh-ref-lib-<版本>.tgz`。
- CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在 push `main` 与所有 PR 上跑同样的四道门禁。

## License

[MIT](LICENSE)，与 DeepSeek Harness 一致。

## 更多

- 开发规范与硬性约束：见仓库 `AGENTS.md`
- 测试分档与每个测试文件的归属：见 [`docs/agents/testing.md`](docs/agents/testing.md)
- 联调 / 升级 / 取指定版本 dsh 的脚本与护栏：见 [`docs/agents/dev-env.md`](docs/agents/dev-env.md)
- 仓库：<https://github.com/hpyperry/dsh-ref-lib>
