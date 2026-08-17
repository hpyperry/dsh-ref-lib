# AGENTS.md — ref-lib（@hpyperry/dsh-ref-lib）

本文件是 `ref-lib/` 插件项目的**核心开发约定**，任何 agent（含本 session 及后续 session）
在动手前必须先读并遵守。`ref-lib/` 是**独立 git 仓库**；外层 `dsh-plugins/` 仅作容器目录，
不是 git 仓库。

## 1. 项目定位

- **`@hpyperry/dsh-ref-lib`**：只读参考库插件（node half + client UI，per-session 隔离）。
- **自包含工程**：`package.json` / `tsconfig.json` / `src/` / `tests/` / `scripts/` /
  构建配置与 `README.md` 齐全，可独立安装/构建/验证（安装见 `README.md`「📦 安装」、
  构建/验证见「🧑‍💻 开发」）。
- 版本沿革：v3（sidecar 存储，2026-08-17 事故修复）→ v4（`ctx.webServer` 路由通道）→
  v5（UI 重构：dock 入口/设计令牌面板/zh-en 本地化）→ v6（目录选择能力自适应）→
  v7（**dock 行内胶囊、零测量**：取消 hero 相位测量/绝对定位，纯 CSS 与输入卡左缘
  对齐，根除与模式按钮的重叠竞态）。

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
- 门禁：`pnpm typecheck`（`tsc --noEmit`）/ `pnpm lint`（eslint + prettier，见
  `eslint.config.js`）/ `pnpm test`（必须含 L0–L2 全部层，见 §5）/ `pnpm build`
  （`tsc` + `tsdown`）。

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
| L3 开发环境隔离 | **开发/联调一律用隔离 `DSH_HOME`**（默认 `~/.dsh-dev`）+ 独立 profile，真实 `~/.dsh` 零接触；`rm -rf` 即可重置 | `scripts/dev-isolate.sh`（通用用法：`PLUGIN=<插件目录> DEV_HOME=<任意目录> ./scripts/dev-isolate.sh`） |
| 通道 | client↔node 数据通道**首选 `ctx.webServer` 自注册 HTTP 路由**（`@deepseek-ai/dsh-host-webserver`，`/api/<plugin>/*`，loopback 护栏，参照 dsh-ssh / dsh-persona-memory 先例）；命令/投影仅在无 webServer 的组合兜底 | `src/routes.ts` + `tests/routes.spec.ts` |
| L4 实验前备份 | 任何要动真实 `~/.dsh/sessions` 的操作前先整目录备份 | 参考 `scripts/patch-ref-lib-logs.mjs` 的备份步骤 |

附加约定：

1. **不要往会话日志写白名单外事件**（自定义事件类型无法标记 `ignorable`，会让日志被
   整体拒读）。插件 per-session 状态存 dsh home 下 sidecar（`dshHomePath()`），旧
   日志事件仅做一次性迁移折叠。
2. 已中招的旧日志用 `scripts/patch-ref-lib-logs.mjs` 修补（补 `ignorable: true`），
   用 `scripts/verify-ref-lib-logs.mjs` 以 GUI 同款加载器验证。
3. 每个插件交付时，`pnpm test` 必须包含 L0–L2 全部层（L3/L4 是开发流程约定，写入
   插件 README）。

## 6. 开发环境速查

- 隔离开发环境：`scripts/dev-isolate.sh`（启动/插件安装卸载/补丁覆盖/热更新/重置的
  完整命令见 `README.md`「🧑‍💻 开发」节）。
- 热更新：`src/client/*` 改动 `pnpm build:client` 后浏览器 ≤0.5s 自动更新；node half
  改动 `pnpm build:node` 后必须重启 `dsh web`。
