# AGENTS.md — ref-lib（@hpyperry/dsh-ref-lib）

本文件是 `ref-lib/` 插件项目的**核心开发约定**，任何 agent（含本 session 及后续 session）
在动手前必须先读并遵守。`ref-lib/` 是**独立 git 仓库**（历史自 v3 起完整保留）；
外层 `dsh-plugins/` 仅作容器目录，不是 git 仓库。

## 1. 项目定位

- **`@hpyperry/dsh-ref-lib`**：只读参考库插件（node half + client UI，per-session 隔离）。
- **自包含工程**：`package.json` / `tsconfig.json` / `src/` / `tests/` / `scripts/` /
  构建配置与 `README.md` 齐全，可独立安装/构建/验证（安装见 `README.md`「📦 安装」、
  构建/验证见「🧑‍💻 开发」）。
- 版本沿革：v3（sidecar 存储，2026-08-17 事故修复）→ v4（`ctx.webServer` 路由通道）→
  v5（UI 重构：dock 入口/设计令牌面板/zh-en 本地化）→ v6（目录选择能力自适应）→
  v7（**dock 行内胶囊、零测量**：取消 hero 相位测量/绝对定位，纯 CSS 与输入卡左缘
  对齐，根除与模式按钮的重叠竞态）。

## 2. 只读参考库 `core`（最高优先级参考来源）

- **`core`**：DeepSeek Harness 官方源码仓库的**本地克隆**（下文简称 `core`；路径因开发机而异，以本机实际克隆位置为准）。
- `core` 是**只读库**：**任何情况下都不得修改、新建、删除 `core` 中的任何文件**，也不得
  向其中提交代码；所有在 `core` 中的操作仅限于**读取/查询**（read、grep、glob 等）。
- 开发遇到任何不确定的问题，**优先到 `core` 中查证**，而不是凭空猜测：
  - 根目录 `AGENTS.md`：仓库全局约定、命令、布局；
  - `docs/`：架构与文档（`docs/user/develop/` 插件开发教程、`docs/cookbook/` 实战配方、
    `docs/subsystems/` 子系统说明）；
  - `packages/`：各能力包源码（插件 API 的权威实现）；
  - `examples/`：可运行的 cordis.yml 示例。

## 3. 开发规范（必须遵守）

- 所有插件开发必须**符合 DeepSeek Harness 的开发规范**（"everything is a plugin" 的
  Cordis 插件模型）。
- 规范来源优先级：1. `core` 仓库内文档与源码（§2 所列路径）；2. 官方开发文档
  <https://deepseek-harness.github.io/deepseek-harness/develop/basic/>。
- 基本形态（`core/docs/user/develop/basic/index.zh.md` 的"第一个插件"）：

  ```ts
  import type { Context } from '@deepseek-ai/cordis'

  export const name = 'my-plugin'

  export function apply(ctx: Context) {
    // 在此注册能力（服务、工具、指令等）
  }
  ```

- 插件通过 `cordis.yml` 覆盖层注册，插件路径必须是**绝对路径**；不确定时查 `core` 中的
  `cordis.yml` 与 `docs/cordis-primer.md`。
- **client 插件（提供 Web UI 的浏览器端插件）**：除 node 端形态外，还须在 `package.json`
  声明 `dsh.client`（`platform: 'web'`，可带 `inject`）与 `exports["./client"]`
  （指向构建好的 bundle），并**以 host 可解析的包名加载**——client 扫描按包名解析
  package.json（`core/packages/client/modules`），绝对路径 entry 不会被识别为 client
  插件；插件集变更需重启 `dsh web` 才生效（生产构建无 HMR）。UI 挂载优先使用现有 slot
  （本插件使用 `conversation.input.dock` 等官方 slot）。
- 不要凭空发明 API 或约定：新能力、新工具、新配置项必须以 `core` 中的既有实现/文档为准，
  必要时先在 `core` 中 grep 验证签名与用法（本仓库的 /api/ref-lib/* 路由、locale 字典、
  CSS 对齐令牌等均按此查证实现）。
- 门禁：`pnpm typecheck`（`tsc --noEmit`）/ `pnpm lint`（eslint + prettier，见
  `eslint.config.js`）/ `pnpm test`（必须含 L0–L2 全部层，见 §6）/ `pnpm build`
  （`tsc` + `tsdown`）。

## 4. 参考速查

| 目的 | 位置 |
| --- | --- |
| 首个插件教程 | `core/docs/user/develop/basic/index.zh.md` |
| 编写 tool | `core/docs/user/develop/basic/tool.zh.md` |
| 插件配置项 | `core/docs/user/develop/basic/config.zh.md` |
| 插件发布 | `core/docs/user/develop/basic/publish.zh.md` |
| 实战配方（加工具/加包/LLM 适配器等） | `core/docs/cookbook/` |
| Cordis 加载器/覆盖层 | `core/docs/cordis-primer.md` |
| 官方在线文档 | <https://deepseek-harness.github.io/deepseek-harness/develop/basic/> |

## 5. 硬性约束

1. **`core` 只读**：禁止写操作；违反即视为严重错误。
2. **先查证、后实现**：不确定的 API/约定必须先查 `core` 或官方文档，禁止臆造。
3. **结果可复现**：本仓库可独立运行/验证（`pnpm build` + `scripts/dev-isolate.sh`），
   运行方式见 `README.md`「🧑‍💻 开发」节。
4. 本文件是仓库核心记忆；后续新增约定时直接维护本文件，并同步 `README.md`。

## 6. 插件开发测试标准（2026-08-17 事故后确立，本工作区所有插件必须遵守）

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
| 通道 | client↔node 数据通道**首选 `ctx.webServer` 自注册 HTTP 路由**（`@deepseek-ai/dsh-host-webserver`，`/api/<plugin>/*`，loopback 护栏，参照 dsh-ssh / dsh-persona-memory）；命令/投影仅在无 webServer 的组合兜底 | `src/routes.ts` + `tests/routes.spec.ts` |
| L4 实验前备份 | 任何要动真实 `~/.dsh/sessions` 的操作前先整目录备份 | 参考 `scripts/patch-ref-lib-logs.mjs` 的备份步骤 |

附加约定：

1. **不要往会话日志写白名单外事件**（自定义事件类型无法标记 `ignorable`，会让日志被
   整体拒读）。插件 per-session 状态存 dsh home 下 sidecar（`dshHomePath()`），旧
   日志事件仅做一次性迁移折叠。
2. 已中招的旧日志用 `scripts/patch-ref-lib-logs.mjs` 修补（补 `ignorable: true`），
   用 `scripts/verify-ref-lib-logs.mjs` 以 GUI 同款加载器验证。
3. 每个插件交付时，`pnpm test` 必须包含 L0–L2 全部层（L3/L4 是开发流程约定，写入
   插件 README）。

## 7. 开发环境速查

- 隔离开发环境：`scripts/dev-isolate.sh`（启动/插件安装卸载/补丁覆盖/热更新/重置的
  完整命令见 `README.md`「🧑‍💻 开发」节）。
- 热更新：`src/client/*` 改动 `pnpm build:client` 后浏览器 ≤0.5s 自动更新；node half
  改动 `pnpm build:node` 后必须重启 `dsh web`。
