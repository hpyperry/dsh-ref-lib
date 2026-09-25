# AGENTS.md — ref-lib（@hpyperry/dsh-ref-lib）

本文件是 `ref-lib/` 插件项目的**核心开发约定**，任何 agent（含本 session 及后续 session）
在动手前必须先读并遵守。`ref-lib/` 是**独立 git 仓库**；外层 `dsh-plugins/` 仅作容器目录，
不是 git 仓库。

## 1. 项目定位与版本约定

- **`@hpyperry/dsh-ref-lib`**：只读参考库插件（node half + client UI，per-session 隔离）。
  自包含工程：`package.json` / `tsconfig.json` / `src/` / `tests/` / `scripts/` / 构建配置与
  `README.md` 齐全，可独立安装、构建、验证（安装见 `README.md`「📦 安装」，开发见「🧑‍💻 开发」）。
- **版本号约定（v20 起）**：**插件 `version` 是插件自己的 semver**（当前 `0.18.0`），
  **不再跟 dsh 版本号绑定**。能跑在哪些宿主由 `peerDependencies` 声明：14 条 dsh-* 统一
  `>=0.1.5-rc.2 <0.2.0-0`（`-0` 是 semver 惯用法，顺带把 `0.2.0` 的预发布也挡在外面）。
  **为什么现在能解耦**：两代宿主唯一的 client 破坏是图标改名，而 `src/client/icons.ts`
  做了一次运行时取值回退（`…Regular ?? …16 ?? …14`，纯逻辑在 `src/client/glyph.ts`，
  L0 见 `tests/glyph.spec.ts`）⇒ **一份 bundle 同时支持 0.1.5 / 0.1.6 / 0.1.7+**。
  历史包袱（**不要再回去**）：v18–v19 让 `version` 跟随 dsh（`0.1.5-rc.3`、`0.1.7-rc.2`），
  代价是①版本号数值倒退（npm 上早有 `0.17.0`，`0.1.x` 永远"低于"它，`latest` 只能靠
  `dist-tag add` 硬指）②插件被迫继承 dsh 的 `-rc` 后缀，永远没有自己的稳定版。
  给用户看的说明见 `README.md`「📦 安装」。
- **devDeps 必须显式 pin 整族**（2026-09-25 实测踩坑）：peer 区间放宽到 `>=0.1.5-rc.2` 之后，
  **不再能靠区间把 dev/test 依赖树钉在同一代**——pnpm 会按其他依赖者的约束把 peer 解析成
  `0.1.5-rc.3`，于是出现 `dsh-session`（格式 v3）与 `dsh-session-persistence-jsonl`
  （目录 v4）**混装**，L2 直接红：`format catalog v4 does not match Session v3`。
  所以 `devDependencies` 现在把 **14 个 dsh-* peer 全部 pin `0.1.7-rc.2`**（加上原本的
  ui-renderer / host-directory-picker / session-persistence 共 18 个 dsh 包 + cordis 插件 2 个）。
  加新 dsh 包时**同时**加 peer 与 devDep pin；升级基线时整族一起升。
- **单轨（2026-09-25 起）**：不再维护并行分支，`main` 只跟一条通道（现为 `next`）。v19 的适配
  工作（图标改名 `Icon*<Size>` → `Icon*<Weight>` 等）原在归档 tag `archive/next-0.1.7-rc.2` 上，
  已**取回并入 `main`**（tag 仅作历史）。理由：两条轨会让 `package.json`（version / `dsh-*`
  peer 与 devDeps）、`pnpm-lock.yaml`、`README.md` 安装表、`AGENTS.md` 轨道措辞在同一批文件里
  分叉 ⇒ 每次互相同步都要手工解冲突（实测：裸 `git merge` 必在这 4 个文件冲突；`git merge
  -X ours` 会把两边字段混在一起，并把对侧 75 行共享内容静默丢掉）。**不要重新引入第二条分支**
  ——要试别的 dsh 版本，用 `TRACK=<dist-tag>`（或 `DSH_VERSION=<版本>`）在隔离环境里钉住即可（§6）。
- **发布**：打 `v<版本>` tag 即触发 `.github/workflows/release.yml` → 四道门禁 + `pnpm pack`
  → 挂同名 GitHub Release；版本号带 `-rc` / `-alpha` / `-beta` 时**自动建为 pre-release**。
  同一 workflow 的「发布到 npm」一步**只在仓库配置了 `NPM_TOKEN` secret 时执行**（当前未配置：
  npm 账号仍锁定，`npm whoami` 返回 401），dist-tag 与 dsh 同构——预发布 → `next`、正式版 →
  `latest`（带 `-rc` 的版本 npm 不会自动设成 `latest`，必须显式 `--tag`）。
  **npm 上现存的最新版是遗留的 `0.17.0`**（0.1.1-rc.2 时代的产物，`npm view` 实测只有
  `0.11.0 / 0.14.0 / 0.15.0 / 0.17.0`，`latest = 0.17.0`）——它的 peer 区间 `^0.1.2-rc.1`
  **能通过** 0.1.7 的兼容闸门，但 bundle 里是 0.1.7 已删除的旧图标名 ⇒ 谁裸装谁白屏。
  所以：**别让用户 `dsh plugin add @hpyperry/dsh-ref-lib`（不带版本号）**；正式发布时先发一个
  稳定号把 `latest` 顶掉（用户侧安装见 `README.md`「📦 安装」，当前以 Release tarball 为准）。
- **安装与分发**：`dsh plugin add` 本质是转发 pnpm，所以本地路径、`pnpm pack` 打出的 tarball、
  git/npm 版本都能装。要"冻结副本"用 `INSTALL_MODE=pack`（§6），tarball 默认打在**仓库根**
  （`<repo>/hpyperry-dsh-ref-lib-<版本>.tgz`，`.gitignore` 已排除 `*.tgz`）。
- **真实环境现状**：全局 `dsh` = `0.1.5-rc.3`；profile `web` 里装的是 **0.1.5-rc.3 的冻结
  tarball 副本**（`file:` 规格，不指向仓库）——因此本仓库改到 0.1.7-rc.2 **不影响**正在跑的那台
  GUI。要用上 0.1.7-rc.2 需先升全局宿主（`npm i -g @deepseek-ai/dsh@0.1.7-rc.2`）再打新 tarball
  重装，且**用户需在自己终端执行**（agent 沙箱无仓库外写权限）。历史落地过程（L4 备份、按升级
  文档 §6.3 扫描并处置 2 个含 `ref-lib/set` 的旧日志等）见 `docs/upgrade-dsh-0.1.7-rc.2.md` §9。
  **联调环境不受此限**：隔离 home 现在就在仓库内（`.dsh-dev/<track>`，已 gitignore），
  agent/CI 可以直接跑 `scripts/dev-isolate.sh`，不需要 `$HOME` 写权限（见 §6）。

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
- 门禁：`pnpm typecheck`（`tsc --noEmit`）/ `pnpm lint`（**只跑 eslint**，见
  `eslint.config.js`）/ `pnpm test`（必须含 L0–L2 全部层，见 §5）/ `pnpm build`
  （`tsc` + `tsdown`）。另有 `pnpm format`（`prettier --write .`）——**可选、不进 CI**：
  prettier 只作编辑器格式化配置（`.prettierrc.json`），仓库现有代码**未全量 prettier 化**
  （实测 30 个文件不合规），所以不要声称门禁含 prettier，也不要在改无关文件时顺手 `--write`。
  CI 兜底同样四道：`.github/workflows/ci.yml`（push `main` / PR）；
  发版走 `.github/workflows/release.yml`（`v*` tag → 门禁 + `pnpm pack` + 挂 Release，
  **tag 名必须 = `v<package.json version>`**，不一致会失败；`workflow_dispatch` 则只出 artifact）。
- 单轨维护（见 §1「单轨」）：不要在 `main` 之外开长期分支，也不要为"另一条轨"改
  `package.json` 的 version / `dsh-*` 区间——试别的 dsh 版本用 `DSH_VERSION=<版本>` 钉住。
- **GitHub 一律用 `gh`**：release / PR / workflow / API / 登录检查都用 `gh`（remote 保持
  HTTPS + gh 凭据，`gh auth status` 可查）；**不要**把 remote 换成 `git@github.com` 的 SSH、
  也不要开 ssh 隧道。**代理不用管**——不为 `git push` / `gh` 去改代理或绕过代理；真失败就把
  原始报错贴出来，别自己发明绕行方案。

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
| L3 开发环境隔离 | **开发/联调一律用隔离 `DSH_HOME`**（`<repo>/.dsh-dev/<track>`，**在仓库内但已 gitignore**，脚本用 `git check-ignore` 实测防 sk 入库）+ 独立 profile，真实 `~/.dsh` 零接触 | `scripts/dev-isolate.sh`（用法与全部开关见 §6） |
| 通道 | client↔node 数据通道**首选 `ctx.webServer` 自注册 HTTP 路由**（`@deepseek-ai/dsh-host-webserver`，`/api/<plugin>/*`，loopback 护栏，参照 dsh-ssh / dsh-persona-memory 先例）；命令/投影仅在无 webServer 的组合兜底 | `src/routes.ts` + `tests/routes.spec.ts` |
| L4 实验前备份 | 任何要动真实 `~/.dsh/sessions` 的操作前先**整目录备份**（`cp -R ~/.dsh ~/.dsh.bak-<时间戳>`），操作后确认无误再清理备份 | — |

附加约定：

1. **不要往会话日志写白名单外事件**（自定义事件类型无法标记 `ignorable`，会让日志被
   整体拒读）。插件 per-session 状态存 dsh home 下 sidecar（`dshHomePath()`）。
2. v1/v2 事故日志的收尾（**两处事实订正**）：
   - 当时给旧日志补 `ignorable: true` 的修补/验证脚本已删除（2026-09-05，确认无残留）；
     **v1/v2 的 `ref-lib/set` 折叠迁移路径也已删除**——在受支持的宿主上它根本无从触达（见下条）。
   - **订正 1**：`SESSION_FORMAT_VERSION` 在 ≤0.1.2-rc.1 为 0、0.1.3-alpha.2 起为 2、
     0.1.5 起为 3、0.1.7 起为 4；而 **v0→v1 历史迁移边拒绝未知事件类型——即使事件带
     `ignorable: true`**（`packages/session/session-format-v0-to-v1/src/validation.ts`，
     有测试钉死）。所以"补过 ignorable 的旧日志仍可读"只对 **≤0.1.2-rc.1 的宿主**成立：
     在 ≥0.1.3-alpha.2 宿主上，含 `ref-lib/set` 的 v0 日志**读取阶段就被整体拒读**——
     这类旧会话的参考库列表无法迁移，只能重新添加。
   - **订正 2（扫描脚本的假阴性）**：`docs/upgrade-dsh-0.1.7-rc.2.md` §6.3 第一版脚本用
     node `zlib.zstdDecompressSync` 整文件解压，**只解第一帧**，而会话日志是**多帧 zstd
     （每行一帧，实测单文件最多 18,132 帧）** ⇒ 恒报"零命中"。必须用 `zstd -d -c` 重扫：
     真实 `~/.dsh` 当时确有 2 个日志命中 `ref-lib/set`（共 7 个事件，见 §6.3 表格），
     已在升级宿主前按 L4 整目录备份后删除。**升级宿主到 0.1.3+ 之前，先按 §6.3 重扫一遍。**
   - 命中后的两条出路：删除该会话，或按 §6.3 末尾"离线重编码为 `session.v3.jsonl.zstd`"
     保留（已在临时安装里验证：干净 0.1.5-rc.3 冷读通过）。
3. 每个插件交付时，`pnpm test` 必须包含 L0–L2 全部层（L3/L4 是开发流程约定，写入
   插件 README）。

## 6. 开发环境速查（2026-09-25：临时版本 + 插件重装但保留 sk/会话）

```bash
./scripts/dev-isolate.sh              # 跟插件所跟踪的通道（dsh npm next），home=<repo>/.dsh-dev/next，端口 3090
TRACK=main ./scripts/dev-isolate.sh   # 测别的 dist-tag（main = latest，0.1.5/0.1.6 线）；端口 3091
```

**`scripts/dev-isolate.sh` 每次运行固定做六件事**（全部实现在脚本里，无需手工步骤）：

1. **解析版本**：`TRACK=<npm dist-tag>`（默认 `next` = 插件所跟踪的通道；`main` = `latest`）→ 该 tag 当前版本
   （可用 `DSH_VERSION=<版本>` 钉死；也可 `DSH_CACHE_DIR=<目录>` 复用已下载版本，省去每次下载）。
2. **校验宿主范围**：dsh 版本必须落在插件 `package.json` 声明的 `@deepseek-ai/dsh-session`
   peer 区间内（见 §1 版本号约定）；不落在区间内只警告，`STRICT_VERSION=1` 直接报错退出。
3. **构建插件**（`BUILD=1` 默认）：先 `pnpm build`，避免吃到过期 `lib/`（改完源码忘了构建是最常见的假故障）。
4. **准备隔离 home**：`<repo>/.dsh-dev/<track>`（**在仓库内，已 gitignore**）；**sk 自动就位**（隔离 home 缺
   `.credentials.yaml` 时从真实 home 只读复制，权限 600；`SEED_CREDENTIALS=0|force` 可调），
   顺带补一份非密钥 `settings.yaml`。**home 里的 sessions/storages/settings/凭证一律不删。**
5. **重装插件**（每次运行都 `plugin remove` + `plugin add`）：确保 profile 指向当前源码的最新构建；
   插件自身数据（sidecar）默认保留，`RESET_PLUGIN_DATA=1` 才清。
6. **启动 web**：`--port` 按轨道默认（next=3090，即插件所跟踪的通道；`TRACK=main` 时为 3091），
   退出时删除本次临时下载的 dsh（`KEEP_TOOLS=1` 保留）。

**插件怎么装（`INSTALL_MODE`，默认 `link`）**——这决定"切分支会不会影响正在跑的环境"：

| 模式 | 装的是什么 | 切分支/改代码 | 热更新 |
| --- | --- | --- | --- |
| `link`（默认） | profile 里 link 到仓库目录 | **会影响正在跑的环境**（切分支=换实现） | 有（`pnpm build:client` 后刷新即生效） |
| `pack` | 先 `pnpm pack` 打成 tarball 再装，profile 里是**独立副本**（自带 `lib/`） | 不影响，删仓库都不影响 | 无 |

```bash
INSTALL_MODE=pack ./scripts/dev-isolate.sh   # 冻结副本：切分支/改源码都不影响这个环境
```
tarball 落在 **插件目录（仓库根）本身**：`<repo>/hpyperry-dsh-ref-lib-<版本>.tgz`（2026-09-25
起默认，**不建任何子目录**；文件名自带版本号，多版本共存不撞名；`PKG_ROOT` 仍可改成别处）。
`.gitignore` 已排除 `*.tgz`；`package.json` 的 `files` 只有 `lib/` + `cordis.patch.yml`，
不会被 pack 进 tarball 自身（实测 tar 列表里 `.tgz` 命中 0 条）。
profile 清单里记的是 tarball 路径，所以**建议保留这个 tarball**（删了当前安装仍能用，但之后
该 profile 再跑 `pnpm install` 会缺源）；反过来，删仓库根那个 `.tgz` 之前先确认没有 profile
还依赖它（`pack` 模式下会）。

**"两条轨同时跑"的做法已废弃**（`git worktree add ../ref-lib-next next` + `PLUGIN=… TRACK=next`）：
单轨不需要 worktree。要试别的 dsh 版本，用 `TRACK=<dist-tag>`（或 `DSH_VERSION=<版本>` 钉死）即可；
宿主不在 peer 区间内只会警告，`STRICT_VERSION=1` 才报错。

> **只看不启**：`./scripts/dev-isolate.sh --check`（任意轨道）只解析版本、做一致性校验并打印
> "会装什么/装到哪/哪个端口"，不下载 CLI、不装插件、不启动 web——改脚本或换轨道后先干跑一遍最省事。

**安全护栏（硬性）**：`DEV_HOME` 必须是绝对路径、不能等于真实 home 或仓库根本身；默认放
`<repo>/.dsh-dev/<track>`（**在仓库内，但 `.gitignore` 已排除**）。脚本不靠口头约定防泄漏：
只要 DEV_HOME 落在仓库内，就 `git check-ignore` **实测**它确实被忽略，没被忽略直接报错退出
（home 里有 sk 与真实会话副本）；确需放仓库外（如临时目录）设 `DEV_HOME_ANYWHERE=1` 跳过校验。
脚本内 `export DSH_HOME` 一次，避免"某条命令漏带 DSH_HOME → 静默打到真实 `~/.dsh`"这类事故
（初版就踩过：启动 server 那条漏了）。

**升级真实环境（与联调分离）**：`scripts/upgrade-host.sh` —— 把真实 `~/.dsh` 的宿主升到指定通道，
并把本插件以 tarball 冻结副本重装进真实 profile。**它动的是真实 home**，所以设计上偏保守：
默认先 `cp -R` 整目录备份（L4）、打印计划并要求输入 `yes`（`--yes` 跳过）、**不碰你正在跑的
`dsh web`**（只打印重启命令）。改脚本/换通道后先 `--check` 干跑。
开关：`TRACK`（默认 `next`）/`DSH_VERSION` 钉版本 / `SKIP_HOST=1`、`SKIP_PLUGIN=1` 分开做 /
`BACKUP=0` / `FORCE=1`（跳过兼容拒绝）/ `SCAN_LEGACY=1`（§6.3 的旧日志扫描，**默认关**——
那道坎早已过：命中的 2 个会话当时已删，之后插件只写 sidecar 不写事件，新日志不可能含
`ref-lib/set`；真不放心就开一次）。
升级前它会校验"**目标宿主 ∈ 插件声明的 peer 区间**"，不满足直接拒绝（`FORCE=1` 才继续）——
避免升完宿主才发现插件装不上。
**执行顺序刻意是「先打包校验 → 备份 → 升宿主 → 换插件」**：打包是最容易出岔子的一步，必须排在
动真实环境之前——2026-09-25 首版把打包排在升宿主之后，pack 一失败就把宿主留在"已升级、插件没换"
的半升级状态。另外打包**不要解析 `pnpm pack` 的 stdout**（它会跑 `prepare`=build，构建输出混进
stdout 后 `tail -1` 会抓到 `$ rm -rf lib` 这类噪音，首版就是这么翻的）：按包名+版本自己算出文件名，
再校验"文件存在 + 包内 version == package.json version"。换插件时先 remove 再 add，
**add 失败会把原插件装回去**（回滚），并核对装上的版本号。

**只想拿一个指定版本的 dsh**：`scripts/dsh-local.sh`（stdout 只打印 bin 路径；默认装到
`mktemp` 临时目录 = 用完即弃，`DSH_CACHE_DIR` 改成按版本缓存；**永不 `npm i -g`**）。
版本解析与安装逻辑在共用库 `scripts/dsh-track.sh`（**刻意与 `dsh-local.sh` 平级**：
  `.gitignore` 的 `lib/` 会匹配任意层级的 `lib/` 目录，放 `scripts/lib/` 会被静默忽略而漏提交）。

- 彻底重置隔离环境：`rm -rf .dsh-dev/next`（**会话与 sk 会一起删**，所以脚本平时不自动删）。
- 热更新：`src/client/*` 改动 `pnpm build:client` 后浏览器 ≤0.5s 自动更新；node half
  改动 `pnpm build:node` 后必须重启 `dsh web`。
- shell 注意：macOS 自带 bash 3.2 把多字节字符当变量名字符，变量后紧跟中文标点必须写
  `${VAR}`（写成 `$VAR（` 会报 unbound variable）；同一 `local` 语句里也不能引用本句刚声明的变量。

## 7. 版本沿革（v3 → v20）

> 每版做了什么、当时什么约束。v19 已并入 `main`；**v20 起版本号与 dsh 解耦**（见 §1）。

- **v3**（sidecar 存储，2026-08-17 事故修复）
- **v4**（`ctx.webServer` 路由通道）
- **v5**（UI 重构：dock 入口/设计令牌面板/zh-en 本地化）
- **v6**（目录选择能力自适应）
- **v7**（**dock 行内胶囊、零测量**：取消 hero 相位测量/绝对定位，纯 CSS 与输入卡左缘
  对齐，根除与模式按钮的重叠竞态）
- **v8**（**用途说明 note + 定稿英文注入模板**：
  add 支持 `--note`/UI 输入框/自动 README 首标题兜底；注入升级为 MUST/ALWAYS 强制
  查证流程、note 作 routing metadata、权威性/冲突处理/外部来源自报条款）
- **v9**（**参考库可用性状态**：sidecar v3 条目带 `status`/`checkedAt`；每次读取（含每次
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
  见设计文档 §16）
- **v10**（**fork 分支会话参考库继承物化**：dsh「分支会话」在宿主创建新会话（新 id +
  `header.parentSession`）；`session/created` 钩子（`{ global: true }`，与
  core/tools seed 钩子同款）在 fork 时把父会话有效列表复制到子会话自身 sidecar
  ——**条目 id 重新铸造**（副本独立身份）、继承时机提前到 fork 时刻（确定性快照）、
  修复纯惰性继承的链式断口（每级落盘）；UI 无新通道（dock 挂载现有 load() 一次
  刷新即读到，不新增 webServer 接口）；legacy 子会话惰性兜底同语义（重新铸造
  id + 落盘，重启后 id 稳定）；设计文档 §17）
- **v11**（**依赖基线升级 dsh 0.1.0-rc.7 → 0.1.1-rc.2**：v9 预留的"等新版本稳定后升级"
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
  `~/.dsh-dev` + 3090 端口验证插件加载与 `/api/ref-lib/*` 路由）
- **v12**（**跨会话导入（手动挑选）**：与 v10 fork 自动继承互补——从其他会话挑选
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
  命令同语义（id 精确 → 标题模糊匹配，多候选列清单；冲突在命令模式一律跳过）
- **v13**（**导入流程定稿 + 官方会话类型**：`@deepseek-ai/dsh-session-query` peer
  （`^0.1.1-rc.2`）声明合并 `ctx.sessionQuery`，`attachSessionMeta` 改吃官方
  `SessionTitleObservationResult`，`SessionId()` 官方工厂替换本地 `as` 断言——cwd
  三源兜底逻辑不变（③ 观测 → ① live `sessions.get()?.header.cwd` → ②
  `listSessions()` 记录，最终回退"新会话"），宿主结构变化从此走 typecheck 而非
  被断言掩盖；冲突页视觉对齐原型（note 标签国际化"用途说明："、diff 高亮按侧
  红/绿、主面板状态行/详情编辑打磨）；195 测试全过，`docs/prototype-session-
  import.html` 为 v12 候选原型基准）
- **v14**（**跨会话导入排除已归档会话**：宿主 `ctx.workspaceRegistry.archivedSessionIds`
  （`@deepseek-ai/dsh-workspace` 展示层归档集合——归档只隐藏工作区树、会话仍在
  live/persistence，sidecar 枚举原本会包含它们）在 `listSessions` **单点过滤**，
  UI 面板（`/api/ref-lib/sessions`）与 `/ref-lib import` 命令同享；宿主无
  workspaceRegistry（非 web 组合）或缺省时原样保留不阻断；纯函数
  `excludeArchivedSources`（L0 钉死缺省/空集合/部分/全归档行为）+ 服务层 stub
  集成测试；peer/dev 新增 `@deepseek-ai/dsh-workspace ^0.1.1-rc.2`（与 v11 基线
  同元组，声明合并经 typecheck 而非断言）；200 测试全过）
- **v15**（**跨会话导入按工作区分组 + 懒加载**：跨工作区平铺难选——`listSessions` 经
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
  0.12.0 → 0.13.0）
- **v16.1**（**导入来源与宿主侧边栏同口径**：跨会话导入排除子代理
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
  残留）被正确剔除）
- **v17**（**依赖基线升级 dsh 0.1.1-rc.2 → 0.1.2-rc.1（2026-09-03 正式发布）+ v16.1
  apiProxy 迁移**：node half 仅 `service.ts`：
  `ctx.apiProxy.sessions.list()`（`dsh-host-apiproxy` 删除）→
  `ctx.sessionController.list({}, signal)` 直接 `{ items }`
  （`@deepseek-ai/dsh-api-session-controller`，`hiddenSessionIds` 降级分支保留）；
  v1/v2 旧日志折叠曾改用 `session.snapshotEvents()`（rc.1 起 `Session` 无 `.events`）；
  该折叠路径后来**删除**——按 v18 订正，≥0.1.3-alpha.2 宿主上含 `ref-lib/set` 的 v0
  日志读取阶段即被整体拒读，折叠无从触达。详见 §5 附加约定 2 与
  `docs/upgrade-dsh-0.1.7-rc.2.md` §3.2 B3。原修补/验证脚本也已删除，见 §5 附加约定 2）。
  client half：`dsh-client-runtime` 删除（6 个类型迁出）——`ClientContext`→cordis
  `Context`、`SessionId`→`dsh-session/types`、`CommandNode/ConversationNode`→
  `dsh-client-ui-conversation/client`、`DirectoryEntry/DirectoryListing`→
  `dsh-host-directory-picker/types`（npm rc.1 的 `dsh-api-remotes` 无 ./client 类型
  产物，故未走 remotes 收口）；`ctx.workspaces` → `ctx.uiWorkspace`（inject
  `'uiWorkspace'`）；dock 的 `session.nodes`→ui-chat 标准
  hook `useChat(s => s.legacy.nodes)`、`sessionId` 取自 `InputZone.session.sessionId`；
  `ctx.slots` 类型来源为 `@deepseek-ai/dsh-client-ui-renderer/client`（经 client 入口
  import type {} 收口，非 ui-conversation 传递）；tsdown `PLATFORM_EXTERNALS` 移除
  `dsh-client-runtime/client`。peer **16** 包（删 runtime/apiproxy + 增
  session-controller/ui-chat/ui-workspace；api-remotes 因 npm 缺 client 类型不加）、
  dev 新增 ui-renderer/host-directory-picker；version 0.15.0 → 0.17.0（v17 发布号定版，
  落地代码先经 0.16.0））
- **v18**（**依赖基线升级 dsh 0.1.2-rc.1 → 0.1.5-rc.2（npm `latest`）+ 双分支轨道建立**：
  评估与迁移方案见 `docs/upgrade-dsh-0.1.7-rc.2.md`（该文档本次评估同时覆盖 0.1.7-rc.2 线）。
  实测结论：0.1.2-rc.1 → 0.1.7-rc.2 共 3432 提交，但落到本插件消费面的破坏**只有两处**
  ——① ui-primitives 图标改名（`Icon*<Size>` → `Icon*<Weight>`，**0.1.7-alpha.1 起**；
  0.1.5/0.1.6 尚无此改动，故本轨不受影响）；② `dsh-session-persistence-jsonl`
  自 **0.1.3-alpha.2** 起**只提供默认导出**（0.1.2-rc.1 及以前两者都有）——本轨据此改
  `tests/harness-roundtrip.spec.ts` 的导入为 `default ?? namespace` 双形态兼容写法
  （2026-09-25 探针实测：旧写法在 0.1.5-rc.2 依赖族上 `JsonlSessionPersistence is not a
  constructor`，L2 两道防线整体失效）。
  peer 由 `^0.1.2-rc.1` 改为 **`>=0.1.5-rc.2 <0.1.7-alpha.1`**（14 条 dsh-* peer 同值）：
  上界排除 0.1.7+，使插件在 0.1.7+ 宿主上被 harness 的 peer 兼容闸门**干净跳过并在 stderr
  打印原因**，而不是静默加载后因图标名缺失白屏——闸门见
  `packages/boot/app-boot/src/plugin-compatibility.ts`（不满足的插件行置 `disabled`，
  非致命，profile 仍可启动；可用 `dsh plugin allow-version` 精确豁免）。
  devDeps 7 包精确 pin `0.1.5-rc.3`；peer 集合与 cordis `^4.0.1`（0.1.5 线 vendored
  4.0.2，npm latest 4.0.4，均在范围内）不变。新增 `dsh.client.external: []`
  （显式声明"基线之外无额外 module-table 请求"）；tsdown `PLATFORM_EXTERNALS` 移除
  从不在宿主 seed 表里的 `dsh-client-locale/client`（此前仅因 type-only 擦除而无害）。
  **事实修正（重要）**：`SESSION_FORMAT_VERSION` 在 ≤0.1.2-rc.1 为 0、0.1.3-alpha.2 起为 2、
  0.1.5 起为 3、0.1.7 起为 4；而 v0→v1 **历史迁移边拒绝未知事件类型——即使带
  `ignorable: true`**，故"补过 ignorable 的旧日志仍可读"自 0.1.3-alpha.2 起不再成立
  （v17 沿革相应表述与 §5 附加约定 2 已订正）；legacy `foldRefLibs` 折叠路径当时即判定不可靠，
  **现已删除**（在 ≥0.1.3-alpha.2 宿主上无从触达）。
  version 0.17.0 → **`0.1.5-rc.3`**（自 v18 起版本号跟 dsh 走，见 §1 版本号约定）；
  本轨跟 dsh npm `latest`，适用 0.1.5/0.1.6 宿主。**v19（next 轨，版本 `0.1.7-rc.2`，
  适配 dsh 0.1.7+ 的图标改名等）当时归档为 tag `archive/next-0.1.7-rc.2`**
  ——**同日稍后又被取回并入 `main`（见下条 v19），所以"收敛到 latest 单轨"只描述了中间状态**。
  依赖族先按 `0.1.5-rc.2` 落地并通过四道门禁 + L3，
  随后在 `latest` 的 `0.1.5-rc.3` 上复跑同样全绿（devDeps 与 CLI 均已对齐 rc.3）。
- **v19**（**依赖基线升级 dsh 0.1.5 → 0.1.7-rc.2（npm `next`）+ 单轨改跟 `next`**：
  原为 `next` 轨（归档 tag `archive/next-0.1.7-rc.2`），2026-09-25 取回并入 `main`，
  支持面从 `latest` 切到 `next`（见 §1）。评估全文见 `docs/upgrade-dsh-0.1.7-rc.2.md`。
  本插件在 0.1.2-rc.1 → 0.1.7-rc.2 的 3432 个提交里只被**两处**破坏，且都已落地：
  - **① 图标改名（client 唯一破坏，白屏级）**：ui-primitives 自 **0.1.7-alpha.1** 起把共享
    图标由 `Icon<Glyph><Size>` 改为 `Icon<Glyph><Weight>`，**两代名字不共存**
    （0.1.6-alpha.2 及以前只有旧名，0.1.7-alpha.1 起只有新名）。13 个图标 / 52 处 /
    5 个 client 文件全部改为 `*Regular`（1px 描边 = 旧 `*16`/`*14` 的等价视觉；
    `Medium` 是 1.3px 强调，不要用），`size={…}` 调用点不动。精确映射：
    `IconFolderOpen16→IconFolderOpenRegular`（**无** `Outline` 中缀）、
    `IconFolderClose16→IconFolderCloseRegular`、`IconChevronRightOutline14→
    IconChevronRightOutlineRegular`、`Icon{Edit,Loading,Warning,Ellipsis,Plus,Refresh,
    Search,Trash,Check,Copy}Outline16→+Regular`。图标是 **value import** 且
    ui-primitives 是宿主 seed 词 ⇒ 旧名在 0.1.7 上解析为 `undefined`，React 渲染即崩。
  - **② `dsh-session-persistence-jsonl` 自 0.1.3-alpha.1 起整条持久化契约重写**
    （仅默认导出 + `open(id, access)→SessionHandle.read()` + **必须持写句柄才落盘**，
    产物为多帧 zstd 的 `session.v<格式版本>.jsonl.zstd`）。影响面只在
    `tests/harness-roundtrip.spec.ts`（v18 已改为 `default ?? namespace` 双形态导入），
    **生产代码零改动**——插件不直接读写会话日志，这正是 v3 事故修复的设计目的。
  - `package.json`：version → **`0.1.7-rc.2`**、14 条 dsh-* peer → **`^0.1.7-rc.2`**、
    devDeps 7 包 pin `0.1.7-rc.2`；`dsh.client.external: []` 维持。peer 上界语义随之
    从"排除 0.1.7+"翻转为"0.1.7+ 专属"：`^0.1.7-rc.2` **不**满足 0.1.5/0.1.6 宿主，
    所以老宿主上装这个版本会被 peer 闸门干净拒绝（`plugin add` 直接报不兼容、
    不安装；运行时该行置 `disabled` 并写 stderr），不会白屏。
    `pnpm-workspace.yaml` 由 pnpm 自动补 `minimumReleaseAgeExclude`（0.1.7-rc.2 全族，
    新发布版本需豁免才能解析），保留以保持安装可复现。
  - **未采用**的备选：`src/client/icons.ts` 运行时图标兜底（`…Regular ?? …16 ?? …14`，
    见升级文档 §4.2/§5.2）——单包可同时跑 0.1.5/0.1.6/0.1.7，但需放宽 peer 区间、
    放弃安装期上界安全网；本次按"跟 dsh 版本走"的既定约定选择直接改名。
  - 门禁：typecheck / lint / test（**226**，含 L2 在新持久化契约下） / build 四绿；
    `lib/client.js` 内 13 个新图标名齐备、`require` 仅 3 个且全在宿主 seed 表内
    （`react` / `react/jsx-runtime` / `dsh-client-ui-primitives`）。
  - `.github/workflows/release.yml`：tag 推 `v<version>` → 门禁 + `pnpm pack` + 挂
    Release，**预发布版本号自动建为 pre-release**；内置「发布到 npm」步骤（按版本号
    选 `next`/`latest` dist-tag），配置 `NPM_TOKEN` secret 后自动生效。
  - `scripts/dev-isolate.sh`：默认 `TRACK` 由 `main`(=latest) 改为 **`next`**（= 插件
    所跟踪通道）；隔离 home 从 `~/.dsh-dev-<track>` 改为仓库内 **`.dsh-dev/<track>`**（已
    gitignore，脚本用 `git check-ignore` 实测）——这样 agent/CI 也能直接起这个环境；
    端口 3090；测老线用 `TRACK=main`（3091）。
- **v20**（**版本号与 dsh 解耦 + 一份 bundle 通吃 0.1.5 / 0.1.6 / 0.1.7+**：
  v18–v19"让 version 跟随 dsh"的两条代价（版本号数值倒退到 `0.1.x`、插件永远只有 `-rc`
  预发布）已经开始影响发布语义，本次把耦合解开：
  - **图标运行时兜底**：新增 `src/client/glyph.ts`（纯逻辑 `pickGlyph`：
    `…Regular ?? …16 ?? …14`，两代都缺就抛错）+ `src/client/icons.ts`
    （`import * as primitives` 后按名取值）；5 个 client 文件改为从 `./icons.ts` 取图标，
    其余 primitives（`Button`/`Modal`/`Input`/`Menu`）照旧直取。**这是"一份 bundle 支持
    两代宿主"的关键**——v19 的直接改名把插件钉死在 0.1.7+ 上。L0 见 `tests/glyph.spec.ts`
    （7 条：新名优先 / 旧 16 / 旧 14 / 都不在时抛错 / 裸名不算合法旧名 / 无中缀字形同规则）。
  - **版本与 peer**：`version` `0.1.7-rc.2` → **`0.18.0`**（插件自己的线，且 > npm 上的
    遗留 `0.17.0`，不再倒挂）；14 条 dsh-* peer → **`>=0.1.5-rc.2 <0.2.0-0`**
    （`-0` 是 semver 惯用法，把 `0.2.0` 的预发布也排除在外）。
  - **`scripts/dsh-track.sh`** 新增 `dsh_version_in_range`（约 30 行手写比较器，预发布感知：
    `0.1.7-rc.2 < 0.1.7-rc.3 < 0.1.7 < 0.2.0-0`；仓库不依赖 semver 包）；
    `dev-isolate.sh` 的 `STRICT_VERSION` 语义由"版本号必须等于 dsh 版本"改为
    "dsh 版本必须落在 peer 区间内"，`--check` 会打印校验结果。
  - **实测**：13 个新图标名在 0.1.7-rc.2 的 types + js 里齐备、旧名 0 命中；0.1.5-rc.3
    反之（13 个旧名齐备、`Regular` 0 命中）⇒ **两代确实不共存，兜底两条路都真的在用**。
    产物 `lib/client.js`：13 个基名以字面量出现、取值函数原样保留（动态拼 key），
    `require` 仍只有 3 个且全在宿主 seed 表内。
  - 门禁：typecheck / lint / **test 233**（+7）/ build 四绿。
  - **遗留**：npm 账号仍锁定（`whoami` 401），"发布到 npm"未发生；旧 GitHub Release
    `v0.1.5-rc.3` / `v0.1.7-rc.2` 已删除（**git tag 保留**，需要时可从 tag 重新生成产物），
    `v0.18.0` 是当前唯一 Release。
