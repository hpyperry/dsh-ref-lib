# AGENTS.md — ref-lib（@hpyperry/dsh-ref-lib）

本文件是 `ref-lib/` 插件仓库的核心开发约定，任何 agent（含本 session 及后续 session）
在动手前必须先读并遵守。`ref-lib/` 是**独立 git 仓库**；外层 `dsh-plugins/` 仅作容器目录，
不是 git 仓库。

## 文档导航

| 想知道什么 | 看哪里 |
| --- | --- |
| 怎么装、怎么用、命令清单、已知限制 | `README.md`（面向使用者，首次接触本项目的入口） |
| 测试分几档、每个测试文件属于哪档、那道事故防线是什么 | `docs/agents/testing.md` |
| 联调 / 升级 / 取指定版本 dsh 的脚本、护栏与踩过的坑 | `docs/agents/dev-env.md` |
| issue 怎么提、怎么分派，`gh` 用哪些命令 | `docs/agents/issue-tracker.md` |
| 五个 triage 标签的字符串 | `docs/agents/triage-labels.md` |
| 术语表与决策记录（ADR）放在哪 | `docs/agents/domain.md` |

术语表 `GLOSSARY.md` 与决策记录目录 `docs/adr/` 是**约定的存放位置，目前都还是空的**：
缺失不算错，等真有术语要固定、真有决策要留档时再建，不要为了"补齐"提前造文件。

## 1. 项目定位

- **`@hpyperry/dsh-ref-lib`**：只读参考库插件（node half + client UI，per-session 隔离）。
  给每个会话挂一组本地只读目录：agent 回答前先去这些目录查证，查不到才允许走外部来源。
- 自包含工程：`package.json` / `tsconfig.json` / `src/` / `tests/` / `scripts/` / 构建配置与
  `README.md` 齐全，可独立安装、构建、验证。

## 2. 能力地图

这张表是"插件对外提供什么"的索引；**改能力时必须同步本表**。

| 能力 | 入口 / 名字 | 代码 |
| --- | --- | --- |
| 参考库服务（按会话增删改查） | `ctx.refLibs` | `src/service.ts` |
| 插件本体（服务名 `refLibPlugin`，组装下面各项） | `RefLibPlugin` | `src/index.ts` |
| HTTP 路由（client 的静默读写通道，仅本机回环可访问，body ≤ 64KB） | `GET /api/ref-lib/list`、`/sessions`、`/source`；`POST /add`、`/remove`、`/note`、`/import` | `src/routes.ts` |
| 斜杠命令 | `/ref-lib list` \| `add <path> [--note <用途>]` \| `remove <id>` \| `import [会话] [路径...]` | `src/commands.ts` + `src/index.ts` |
| 上下文注入（只给有可用库的会话；无库时注入空串＝零 token） | `reference-libs:policy`（order 150） | `src/render.ts` |
| 分支会话继承（子会话创建时物化父列表，条目重新铸 id） | `session/created`（`{ global: true }`） | `src/service.ts` |
| 纯逻辑（列表变换 / 可用性判定 / 导入计划 / 会话归组） | — | `src/logic.ts`、`src/validate.ts`、`src/spec.ts` |
| 存储 | `<dshHome>/plugin-data/ref-lib/<sessionId>.json`，`{ version: 3, libs }`，临时文件 + rename 原子写 | `src/service.ts` |
| 条目结构 | `id`(uuid) / `path`(realpath 绝对路径) / `note?`(≤120) / `status?`(available \| missing \| not-directory) / `checkedAt?` | `src/spec.ts` |
| UI：输入框胶囊 + 管理面板 + 目录浏览器 + 导入/冲突弹窗 | 槽位 `conversation.input.dock`（id `ref-lib`） | `src/client/RefLibDock.tsx` 等 |
| UI：`/ref-lib` 结果卡片（完整文本 + 一键复制） | 槽位 `conversation.chat.commandview`（key `ref-lib`） | `src/client/RefLibCommandCard.tsx` |
| UI 取数（单一 `fetch('/api/ref-lib/*')`；无后台轮询，刷新由交互驱动） | — | `src/client/index.ts`、`refresh-*.ts` |
| 本地化 / 样式 | `zh` + `en`（zh 是键的基准）；运行时注入 `reflib-` 前缀样式 | `src/client/locales.ts`、`styles.ts` |
| 图标跨代兜底 | 必须从 `./icons.ts` 取（`Regular ?? 16 ?? 14`） | `src/client/glyph.ts`、`icons.ts` |
| 构建产物 | `lib/index.js`（node half，tsc）+ `lib/client.js`（client，tsdown 打包进 `window.__ModuleLoader__`） | `tsconfig.json`、`tsdown.config.ts` |

## 3. 硬约束（不写就会出事）

1. **绝不向会话日志写自定义事件。** 2026-08-17 那次事故就是这么来的：harness 的会话加载器只认
   白名单 `KNOWN_SESSION_EVENT_TYPES` 内的事件类型，白名单外的必须带 `ignorable: true` 信封标记，
   而 `session.append()` 没有写入该标记的途径——写进去会让**整条会话日志被拒读**。per-session
   状态一律写 sidecar（`ctx.refLibs`）；`tests/harness-roundtrip.spec.ts` 用陷阱守卫钉死这条。
2. **client 图标必须从 `src/client/icons.ts` 取**，不要直接从 `ui-primitives` import：0.1.7 起图标
   由 `Icon*16` 改名为 `Icon*Regular` 且两代名字不共存，直连会把插件钉死在一代宿主上。
3. **client bundle 的外部依赖表是契约**：新增来自宿主 seed 模块的 value import 时，必须**同时**
   加进 `tsdown.config.ts` 的 `PLATFORM_EXTERNALS` 与 `package.json` 的 `dsh.client.external`。
4. **门禁四道**：`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` 全过才算完成；其中
   `pnpm test` 必须含三档测试（定义见 `docs/agents/testing.md`）。
5. **单轨维护**：只在 `main` 上开发，不开长期分支；要试别的 dsh 版本，用 `TRACK=<dist-tag>` 或
   `DSH_VERSION=<版本>` 在隔离环境里钉住（见 `docs/agents/dev-env.md`）。
6. **版本号与 dsh 解耦**：插件 `version` 是插件自己的 semver；能装在哪代 dsh 只由 `package.json`
   里的 `dsh-*` peer 区间决定。dsh 发新版时复核这个区间，**不要改 version**，也不要为"另一条轨"
   去动 version / peer 区间。
7. **GitHub 一律用 `gh`**（release / PR / workflow / API 查询 / 登录检查）：remote 保持 HTTPS +
   gh 凭据。不要把 remote 换成 `git@github.com` 的 SSH，不要开 ssh 隧道，也不要为了 `git push` /
   `gh` 去改代理或绕过代理——真失败就把原始报错贴出来，别自己发明绕行方案。

## 4. 开发规范

- **文档与注释**：不要乱用黑话，要写成人类能看懂的话；不记录无意义的版本号和黑历史，只记录
  关键问题的解决方案。引用其他文件时写「文件名 + 章节标题」，**不要写 `§N`**——章节一重排，
  编号就漂了。
- **以官方文档为准**：所有插件开发必须符合 DeepSeek Harness 的开发规范（"everything is a plugin"
  的 Cordis 插件模型）。规范来源见下方「参考速查」；遇到不确定的 API/约定，先查官方文档或
  harness 既有实现，**禁止臆造**。
- 基本形态（官方教程的"第一个插件"）：

  ```ts
  import type { Context } from '@deepseek-ai/cordis'

  export const name = 'my-plugin'

  export function apply(ctx: Context) {
    // 在此注册能力（服务、工具、指令等）
  }
  ```

- 插件通过 `cordis.patch.yml` 覆盖层注册，插件行**按包名**引用。
- **client 插件**（提供 Web UI 的浏览器端）除 node 端形态外，还须在 `package.json` 声明
  `dsh.client`（`platform: 'web'`）与 `exports["./client"]`（指向构建好的 bundle），并以 host
  可解析的**包名**加载——client 扫描按包名解析 package.json，绝对路径 entry 不会被识别为
  client 插件；插件集变更需重启 `dsh web` 才生效（生产构建无 HMR）。UI 挂载优先使用现有 slot
  （本插件用 `conversation.input.dock`、`conversation.chat.commandview`）。
- **`pnpm format` 是 `prettier --write`，可选、不进 CI**：prettier 只作编辑器格式化配置
  （`.prettierrc.json`），仓库现有代码**未全量 prettier 化**。不要声称门禁含 prettier，
  也不要在改无关文件时顺手 `--write`。
- **CI**：`.github/workflows/ci.yml`（push `main` / PR 跑同样四道门禁）；发版走
  `.github/workflows/release.yml`（`v*` tag → 门禁 + `pnpm pack` + 挂 Release，**tag 名必须等于
  `v<package.json version>`**，不一致直接失败；`workflow_dispatch` 只出 artifact）。

## 5. 参考速查

| 目的 | 位置 |
| --- | --- |
| 官方插件开发文档（首个插件 / tool / config / publish） | <https://deepseek-harness.github.io/deepseek-harness/develop/basic/> |
| 官方文档首页 | <https://deepseek-harness.github.io/deepseek-harness/> |
| 仓库 | <https://github.com/hpyperry/dsh-ref-lib> |

本文件是仓库核心记忆：新增约定时直接维护本文件，并同步 `README.md`；测试分档与环境脚本的操作
细节写进 `docs/agents/` 对应文件，不要在这里堆步骤。
