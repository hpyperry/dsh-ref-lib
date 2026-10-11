# 开发环境与升级脚本

这个仓库有四个 shell 脚本。**用法和全部开关写在脚本头部注释里，README「开发」节有面向人的
说明**——这里只写「什么时候用哪个」和「为什么这么设计」，尤其是踩过的坑。

## 四个脚本的分工

| 脚本 | 什么时候用 | 动到什么 |
| --- | --- | --- |
| `scripts/dev-isolate.sh` | 日常联调：起一个**隔离**的 `dsh web`，装当前源码构建的插件 | 只在 `<仓库>/.dsh-dev/<通道>` 这个隔离 home 里动手 |
| `scripts/upgrade-host.sh` | 把**真实** `~/.dsh` 的宿主升到指定通道，并把插件以冻结 tarball 重装进真实 profile | 真实 `~/.dsh`（所以默认先备份 + 要求确认） |
| `scripts/dsh-local.sh` | 只想拿一份指定版本、非全局的 dsh CLI（stdout 只打印 bin 路径） | 临时目录或按版本缓存目录 |
| `scripts/dsh-track.sh` | 共用库：把 npm dist-tag 解析成版本号、比较版本是否落在区间内；被上面两个 `source`，不直接执行 | 不读不写任何 home |

常用法（完整开关见脚本头部）：

```bash
./scripts/dev-isolate.sh              # 跟插件所跟踪的通道（默认 next），隔离 home=.dsh-dev/next，端口 3090
TRACK=main ./scripts/dev-isolate.sh   # 测别的 dist-tag（main = npm latest），端口 3091
INSTALL_MODE=pack ./scripts/dev-isolate.sh   # 冻结副本：切分支/改源码都不影响这个环境（代价：没有热更新）
./scripts/dev-isolate.sh --check      # 干跑：只打印"会装什么/装到哪/哪个端口"
./scripts/upgrade-host.sh --check     # 干跑：只看现状与计划，不动任何东西
```

## 硬性护栏（脚本自己会拦，不要绕过）

- **隔离 home 必须在仓库内、且确实被 gitignore。** 默认 `.dsh-dev/<通道>`（里面有从真实 home
  复制来的凭证与会话副本）。脚本用 `git check-ignore` **实测**这条规则生效，没被忽略就直接报错
  退出——删掉 `.gitignore` 里那行会立刻失败。确需放仓库外（如临时目录）才设 `DEV_HOME_ANYWHERE=1`。
- **绝不安装全局 dsh、不改 PATH、不碰 `which dsh` 那份。** 一律 `npm install --prefix <目录>`，
  默认装进用完即删的临时目录（`DSH_CACHE_DIR` 可改成按版本缓存复用）。
- **联调对真实 `~/.dsh` 零写入**：不删、不改真实 home 的会话、storages、settings、凭证。
- **动真实 home 之前先整目录备份并显式确认。** `upgrade-host.sh` 默认
  `cp -R ~/.dsh ~/.dsh.bak-<时间戳>`，备份失败即中止；`--yes` 才能跳过交互确认。会话格式升级是
  不可逆的——旧宿主事后打不开新宿主写过的会话。
- **典型环境变量后面紧跟中文标点要写 `${VAR}`。** macOS 自带 bash 3.2 会把多字节字符当成变量名
  的一部分，`$VAR（` 会报 unbound variable；同一条 `local` 语句里也不能引用本句刚声明的变量。

## 踩过的坑（结论，不要再踩）

- **先打包，再动真实环境。** `upgrade-host.sh` 的执行顺序刻意是「构建并打包 → 校验产物 → 备份 →
  升宿主 → 换插件」。打包是最容易出岔子的一步，必须排在动真实环境之前；反过来的话，打包一失败
  就会把人留在「宿主升上去了、插件没换」的半升级状态（2026-09-25 真实翻车）。
- **不要解析 `pnpm pack` 的 stdout。** `pack` 会触发 `prepare`（= build），构建输出混进 stdout 后
  `tail -1` 抓到的可能是 `$ rm -rf lib` 这类噪音。改为按包名 + 版本号自己算出文件名，再校验
  「文件存在」且「包内 version == package.json 的 version」。
- **换插件先 remove 再 add，add 失败要把原插件装回去。** 脚本已经实现了回滚，并会核对装上的版本号。
- **别用 git worktree 开第二条轨。** 单轨就是单轨：要试别的 dsh 版本用 `TRACK` / `DSH_VERSION`
  在隔离环境里钉住即可（见 `AGENTS.md` 的「硬约束」第 5 条）。
- **`STRICT_VERSION=1` 校验的是宿主范围，不是版本号相等。** 插件版本是自己的 semver，与 dsh 版本
  无关；脚本比较的是「dsh 版本 ∈ 插件声明的 `dsh-*` peer 区间」，不落在区间内默认只警告。
- **`desktop` profile 不能由 CLI 管理。** `dsh plugin --profile desktop …` 会被按 profile 名直接拒绝：
  `error: profile "desktop" is managed exclusively by the Electron application`（宿主 `lib/bin.js` 里的硬拦，
  与插件无关）。桌面端 profile 只能走**应用内的插件管理界面**，它的安装目标支持四类：包名（registry）、
  本地路径（path）、git 地址、`.tgz` 直链（tarball）。所以 `upgrade-host.sh` 只服务 CLI 可管的 profile
  （默认 `web`）；要装进桌面端，就在那个界面里填**本地**仓库路径或本地 `.tgz` 路径。
  ⚠️ `tarball` 那一类**填 Release 直链在本仓库必然 404**：private 仓库的
  `/releases/download/…` 对匿名请求（pnpm 不带 Authorization 头）一律 404，带 token 也一样；
  只有 API 资产端点认 token。要远程取产物先 `gh release download` 落本地。
- **热更新分两半**：改 `src/client/*` 跑 `pnpm build:client`，浏览器秒级生效；改 node half
  必须重启 `dsh web`。改完源码忘了构建、吃到过期的 `lib/`，是最常见的"假故障"（`BUILD=1` 默认会
  先构建一次）。

## dsh 换线时先查闸门，再查 API

宿主发新线时，断点通常不是 API 而是 peer 区间：宿主的兼容闸门把插件每条 `@deepseek-ai/dsh` /
`@deepseek-ai/dsh-*` peer 与**单一** runtimeVersion 比对（`includePrerelease: true`），
不在区间里的插件装不上（`plugin add` 直接拒绝），按路径装的则在 profile 启动时被禁用。
所以顺序是：

1. **先确认目标宿主落在区间内**：`DSH_VERSION=<目标版本> ./scripts/dev-isolate.sh`
   （要硬失败就加 `STRICT_VERSION=1`）。这一步不需要改任何代码。
2. **不在区间里就改 `package.json` 的 dsh-* peer**：通常只动上界。上界写成下一条线的
   `-0` 形式（如 `<0.3.0-0`）可以让一份 bundle 继续通吃整条线。
3. **再去读 API 差异**。0.1.7-rc.2 → 0.2.0-rc.2 那次，插件用到的 API 逐字节未变，
   唯一断点就是区间上界——结论与取舍见 `docs/adr/0001-host-version-compatibility.md`。
4. **`devDependencies` 跟着钉到要真机验的那一代**，并把 `pnpm-workspace.yaml` 的
   `minimumReleaseAgeExclude` 白名单同步重建，否则 `pnpm install` 会被 pnpm 11 的
   最小发布年龄拦下。

区间是"声明范围"，`devDependencies` 钉的那一代才是"每次升级真机冒烟的范围"，两者不必相等，
但 README 要如实写明这个区别。

## `SCAN_LEGACY`（默认关，只对 0.1.2 时代的老 home 有意义）

2026-08-17 事故期的 v1/v2 插件把状态写成会话事件 `ref-lib/set`；含该事件的旧日志在
≥0.1.3-alpha.2 宿主上会被**整体拒读**（原因见 `docs/agents/testing.md` 的「L2 这道防线」）。
那道坎早已过去：本机当时已把命中的 2 个会话删除，之后插件只写 sidecar，新日志不可能含它。

所以要扫就得注意两点：

1. **必须用 `zstd -d -c` 解，不要直接 grep 压缩流**。会话日志是**多帧** zstd（每行一帧，实测单
   文件最多上万帧），用 node 的 `zlib.zstdDecompressSync` 整文件解压**只解第一帧**，会恒报
   「零命中」——第一版扫描脚本就是这么得出假阴性的。
2. **命中后先停手处置，再升级宿主**。此时真实 home 还没被改动：先按上面的护栏做整目录备份，再把
   命中的会话文件移走（或离线重编码），然后才升级。脚本在命中且未加 `--yes` 时会直接退出。
