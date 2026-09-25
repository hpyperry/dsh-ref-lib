#!/usr/bin/env bash
# dev-isolate.sh —— 启动**隔离**的 dsh web 联调环境（默认跟插件所跟踪的 dsh 通道 `next`）。
#
# 设计目标（2026-09-25 修订；插件当前跟 dsh `next` = 0.1.7-rc.2，见 AGENTS.md §1）：
#
#   1) **跟 dsh dist-tag 走**：`TRACK` 给 npm dist-tag（默认 `next` = 插件所跟踪的通道，
#      也可传 `main`/`latest` 等）。版本由 registry 实时解析（也可 DSH_VERSION 显式钉），并校验被测插件的
#      package.json version 是否与之一致（不一致只警告；STRICT_VERSION=1 则报错退出）。
#   2) **CLI 用临时下载**：每次运行 `npm install --prefix <mktemp 临时目录>` 拉一份该版本的
#      dsh，**不装全局、不动 PATH、不碰 `which dsh` 那份**；退出时自动删除该临时目录
#      （KEEP_TOOLS=1 保留，DSH_CACHE_DIR=… 改成按版本缓存复用）。
#   3) **home 隔离在用户目录**：默认 `$HOME/.dsh-dev-<TRACK>`（main ⇒ `~/.dsh-dev-main`）；
#      **拒绝**落在代码库内的 home——home 里有 sk（`.credentials.yaml`）与真实会话，绝不能进仓库。
#   4) **每次重装插件、其余一律保留**：每次运行都 `plugin remove` + `plugin add`（吃到当前
#      源码最新构建），但**从不删除** home 里的 sessions / storages / settings.yaml /
#      `.credentials.yaml` / `.anonymous-user-id`；插件自身数据默认也保留，只有显式
#      RESET_PLUGIN_DATA=1 才清。
#   5) **sk 自动就位**：隔离 home 缺凭证时，从真实 home 只读复制 `.credentials.yaml`
#      （权限 600）过去，让隔离环境也能真的对话；文件始终留在用户目录，不进代码库。
#
# 用法：
#   ./scripts/dev-isolate.sh                          # 默认：跟插件所跟踪的 dsh 通道 next，home=~/.dsh-dev-next，端口 3090
#   TRACK=main ./scripts/dev-isolate.sh               # 任意 npm dist-tag（如 main = latest，0.1.5/0.1.6 线）→ 端口 3091
#   PORT=4000 ./scripts/dev-isolate.sh --no-open      # 自定义端口 + 透传 dsh 参数
#   RESET_PLUGIN_DATA=1 ./scripts/dev-isolate.sh      # 顺带清插件自身数据（会话/sk 不动）
#
# 环境变量：
#   TRACK=<npm dist-tag>    跟哪个 dsh dist-tag（默认 next = 插件所跟踪的通道；main = latest）
#   DSH_VERSION=<版本>      显式钉 dsh 版本（覆盖 TRACK 解析）
#   DEV_HOME=<目录>         隔离 home（默认 ~/.dsh-dev-<TRACK>；必须在 $HOME 下）
#   PROFILE=web             profile 名
#   PORT=<端口>             web 端口（默认 next=3090、其他 dist-tag=3091）
#   PLUGIN=<目录>           被测插件目录（默认本仓库根；相对路径会转成绝对路径）
#                           单轨用不上；留给"在别处 checkout 测同一插件"的场景
#   BUILD=1|0               启动前构建插件（默认 1，避免吃到过期 lib/）
#   SEED_CREDENTIALS=1|0|force  复制真实 home 的 sk 进隔离 home（默认 1=仅缺失时）
#   SEED_SETTINGS=1|0       顺带复制非密钥 settings.yaml（默认 1=仅缺失时）
#   INSTALL_MODE=link|pack  插件安装方式（默认 link）：
#       link —— 把仓库目录 link 进 profile：改源码 + `pnpm build:client` 浏览器即时生效，
#               但**该环境与当前工作区绑定**（切分支/改代码会影响它）。
#       pack —— 先 `pnpm pack` 打成 tarball 再安装：profile 里是**冻结副本**，
#               之后切分支、甚至删掉仓库都不影响这个环境（代价：没有热更新）。
#   PKG_ROOT=<目录>         pack 模式的 tarball 存放目录（默认 = 插件目录，即仓库根；
#                           文件名自带版本号，多版本可共存；已 gitignore）
#   RESET_PLUGIN_DATA=1     清空插件自身数据目录（默认 0）
#   KEEP_TOOLS=1            保留本次临时下载的 dsh（默认 0=退出即删）
#   DSH_CACHE_DIR=<目录>    改成按版本缓存复用（不再每次重新下载）
#   REAL_HOME=<目录>        真实 dsh home（默认 ~/.dsh，只读用于取 sk）
#   STRICT_VERSION=1        插件版本 ≠ dsh 版本时直接报错（默认只警告）
#
# 清理：彻底重置 = `rm -rf ~/.dsh-dev-main`（**会话与 sk 会一起没**，所以本脚本平时不自动删）。
#       真实 `~/.dsh` 全程零写入。
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/dsh-track.sh
. "${SELF_DIR}/dsh-track.sh"

PLUGIN_RAW="${PLUGIN:-$(cd "${SELF_DIR}/.." && pwd)}"
PLUGIN="$(cd "${PLUGIN_RAW}" 2>/dev/null && pwd)" || { echo "dev-isolate: ✖ PLUGIN 目录不存在：${PLUGIN_RAW}" >&2; exit 1; }
TRACK="${TRACK:-next}"
PROFILE="${PROFILE:-web}"
BUILD="${BUILD:-1}"
SEED_CREDENTIALS="${SEED_CREDENTIALS:-1}"
SEED_SETTINGS="${SEED_SETTINGS:-1}"
INSTALL_MODE="${INSTALL_MODE:-link}"
# 默认就打在**插件目录本身**（仓库根），不建任何子目录：tarball 名字自带版本号
# （`hpyperry-dsh-ref-lib-<版本>.tgz`），多版本共存不会撞名；已在 .gitignore 排除（*.tgz）。
PKG_ROOT="${PKG_ROOT:-${PLUGIN}}"
RESET_PLUGIN_DATA="${RESET_PLUGIN_DATA:-0}"
KEEP_TOOLS="${KEEP_TOOLS:-0}"
REAL_HOME="${REAL_HOME:-${HOME}/.dsh}"
STRICT_VERSION="${STRICT_VERSION:-0}"

die() { echo "dev-isolate: ✖ $*" >&2; exit 1; }
case "${INSTALL_MODE}" in
  link|pack) ;;
  *) echo "dev-isolate: ✖ 未知 INSTALL_MODE '${INSTALL_MODE}'（只支持 link / pack）" >&2; exit 2 ;;
esac
CHECK_ONLY=0
for a in "$@"; do
  if [ "$a" = "--check" ]; then CHECK_ONLY=1; fi
done
note() { echo "dev-isolate: $*"; }

# 端口：默认通道（next，即插件所跟踪的线）用 3090；测别的 dist-tag 用 3091，避免与默认实例撞端口。
case "${TRACK}" in
  next) PORT="${PORT:-3090}" ;;
  *) PORT="${PORT:-3091}" ;;
esac
# 版本解析库读的是 DSH_TRACK：这里同步一次并 export，两个名字永远一致。
DSH_TRACK="${TRACK}"
export DSH_TRACK
DEV_HOME="${DEV_HOME:-${HOME}/.dsh-dev-${TRACK}}"

# ── 0) home 安全护栏：绝对路径 + 在 $HOME 下 + 绝不在代码库里（sk/会话防泄漏）──
case "${DEV_HOME}" in
  /*) ;;
  *) die "DEV_HOME 必须是绝对路径（收到 '${DEV_HOME}'）" ;;
esac
case "${DEV_HOME}" in
  "${PLUGIN}"|"${PLUGIN}"/*)
    die "DEV_HOME 落在被测插件目录内（${DEV_HOME}）——隔离 home 含 sk 与真实会话，绝不能进代码库" ;;
esac
if [ "${DEV_HOME_ANYWHERE:-0}" != "1" ]; then
  case "${DEV_HOME}" in
    "${HOME}"/*) ;;
    *) die "DEV_HOME 必须在 ${HOME} 下（收到 ${DEV_HOME}）；确需放别处设 DEV_HOME_ANYWHERE=1" ;;
  esac
fi
if [ "${DEV_HOME}" = "${REAL_HOME}" ]; then
  die "DEV_HOME 不能等于真实 home（${REAL_HOME}）"
fi

# 关键：在脚本层面 export，而不是逐条命令加前缀——任何一条漏加都会静默打到真实 home
# （本脚本 2026-09-25 的初版就踩过：plugin remove/add 带了 DSH_HOME，最后启动 server 那条漏了）。
export DSH_HOME="${DEV_HOME}"

# ── 1) 解析 dsh 版本 + 校验插件版本（"版本号跟 dsh 一致"约定）────────────────
if ! VERSION="$(dsh_resolve_version)"; then
  die "解析 dsh 版本失败（registry 不通？可设 DSH_VERSION=<版本> 显式指定，或用 DSH_CACHE_DIR=<已有目录> 复用已下载的版本）"
fi
PLUGIN_NAME="$(node -p 'require(process.argv[1]).name' "${PLUGIN}/package.json" 2>/dev/null || true)"
[ -n "${PLUGIN_NAME}" ] || die "读不出插件包名：${PLUGIN}/package.json"
PLUGIN_VERSION="$(node -p 'require(process.argv[1]).version' "${PLUGIN}/package.json" 2>/dev/null || true)"
# pnpm/npm 的 tarball 命名：去 scope 的 `@`，`/` 换成 `-`（@scope/name → scope-name-<版本>.tgz）
PKG_BASENAME="$(printf '%s' "${PLUGIN_NAME}" | sed 's|^@||; s|/|-|g')-${PLUGIN_VERSION}.tgz"
if [ "${PLUGIN_VERSION}" != "${VERSION}" ]; then
  msg="插件版本 ${PLUGIN_VERSION} ≠ dsh ${TRACK} 解析出的 ${VERSION}（约定：插件 version = 它所跟踪的 dsh 版本号；故意测别的 dist-tag 时可忽略）"
  if [ "${STRICT_VERSION}" = "1" ]; then die "${msg}"; fi
  note "⚠️  ${msg}"
fi

# ── 2) 构建插件（避免吃到过期 lib/）──────────────────────────────────────────
if [ "${BUILD}" = "1" ]; then
  command -v pnpm >/dev/null 2>&1 || die "需要 pnpm 构建插件（或设 BUILD=0 跳过）"
  build_log="$(mktemp "${TMPDIR:-/tmp}/reflib-build-XXXXXX.log")"
  if ! (cd "${PLUGIN}" && pnpm build) >"${build_log}" 2>&1; then
    echo "dev-isolate: 插件构建失败，日志尾部：" >&2
    tail -20 "${build_log}" >&2
    rm -f "${build_log}"
    die "构建失败（修好后重试，或 BUILD=0 复用现有 lib/）"
  fi
  rm -f "${build_log}"
  note "插件已构建（${PLUGIN_VERSION}）"
fi
if [ "${CHECK_ONLY}" = "1" ]; then
  note "干跑结束（--check）：不装 CLI、不装插件、不启动 web"
  note "  通道=${TRACK}  dsh 版本=${VERSION}  插件版本=${PLUGIN_VERSION}"
  note "  隔离 home=${DEV_HOME}  端口=${PORT}  profile=${PROFILE}"
  note "  构建=${BUILD}  安装方式=${INSTALL_MODE}  重装插件=每次  清插件数据=${RESET_PLUGIN_DATA}"
  if [ "${INSTALL_MODE}" = "pack" ]; then
    note "  打包目录=${PKG_ROOT}（tarball：${PKG_BASENAME}）"
  fi
  exit 0
fi

[ -f "${PLUGIN}/lib/index.js" ] || die "缺少 ${PLUGIN}/lib/index.js（先构建，或 BUILD=1）"
[ -f "${PLUGIN}/lib/client.js" ] || die "缺少 ${PLUGIN}/lib/client.js（先构建，或 BUILD=1）"

# ── 3) 隔离 home：只创建、只补全，绝不删除既有数据 ───────────────────────────
mkdir -p "${DEV_HOME}"
note "隔离 home：${DEV_HOME}（真实 ${REAL_HOME} 全程零写入）"

# sk 凭证：默认仅在缺失时从真实 home 复制（600 权限）；force 则覆盖。
if [ "${SEED_CREDENTIALS}" = "0" ]; then
  note "跳过 sk 凭证（SEED_CREDENTIALS=0）"
elif [ -f "${DEV_HOME}/.credentials.yaml" ] && [ "${SEED_CREDENTIALS}" != "force" ]; then
  note "sk 凭证已存在，保留不动（要覆盖用 SEED_CREDENTIALS=force）"
elif [ -f "${REAL_HOME}/.credentials.yaml" ]; then
  install -m 600 "${REAL_HOME}/.credentials.yaml" "${DEV_HOME}/.credentials.yaml"
  note "sk 凭证已就位（从 ${REAL_HOME} 只读复制，权限 600；留在用户目录，不进代码库）"
else
  note "⚠️  ${REAL_HOME} 没有 .credentials.yaml，隔离环境可能无法对话（可手工放一份到 ${DEV_HOME}）"
fi

# settings.yaml：非密钥，仅缺失时复制，省去每次重配 UI 偏好。
if [ "${SEED_SETTINGS}" = "1" ] && [ ! -f "${DEV_HOME}/settings.yaml" ] && [ -f "${REAL_HOME}/settings.yaml" ]; then
  install -m 600 "${REAL_HOME}/settings.yaml" "${DEV_HOME}/settings.yaml"
  note "settings.yaml 已就位（仅缺失时复制）"
fi

# ── 4) CLI：临时下载（非全局），退出即删 ─────────────────────────────────────
TOOLS_TEMP=0
if [ -n "${DSH_CACHE_DIR:-}" ]; then
  TOOLS_DIR="${DSH_CACHE_DIR}/${VERSION}"
  KEEP_TOOLS=1
else
  TOOLS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dsh-${VERSION}-XXXXXX")"
  TOOLS_TEMP=1   # 只删我们自己 mktemp 出来的目录，绝不碰缓存目录
fi
cleanup() {
  # 只删 mktemp 建的目录；缓存模式（KEEP_TOOLS=1）与 DSH_CACHE_DIR 一律保留。
  # 删不掉也只提示、不改退出码（SIGKILL 不会进 trap，属已知边界，下方给出路径提示）。
  if [ "${KEEP_TOOLS}" = "1" ] || [ "${TOOLS_TEMP}" != "1" ]; then
    note "保留本次 dsh 安装（缓存/显式保留）：${TOOLS_DIR}"
    return 0
  fi
  if rm -rf "${TOOLS_DIR}" 2>/dev/null; then
    note "已删除本次临时 dsh：${TOOLS_DIR}"
  else
    note "⚠️  临时 dsh 目录未能删除，请手工清理：rm -rf ${TOOLS_DIR}"
  fi
  return 0
}
trap cleanup EXIT INT TERM

DSH_BIN="$(dsh_install_cli "${VERSION}" "${TOOLS_DIR}")"
note "dsh CLI：${DSH_BIN}（版本 ${VERSION}；临时目录 ${TOOLS_DIR}）"

run_dsh() { "${DSH_BIN}" "$@"; }   # DSH_HOME 已 export

# ── 5) 每次重装插件；其余数据（会话/sk/设置）一律保留 ────────────────────────
INSTALL_SPEC="${PLUGIN}"
if [ "${INSTALL_MODE}" = "pack" ]; then
  # 冻结安装：先打包（`pnpm pack` 会跑 prepare=构建，tarball 内含 lib/），再装 tarball。
  # 之后 profile 里是独立副本，切分支/改源码/删仓库都不影响这个环境。
  # 直接打在 PKG_ROOT（默认 = 插件目录本身），不再套 <版本>/ 子目录。
  PKG_DIR="${PKG_ROOT}"
  mkdir -p "${PKG_DIR}"
  note "打包：pnpm pack → ${PKG_DIR}"
  if ! INSTALL_SPEC="$(cd "${PLUGIN}" && pnpm pack --pack-destination "${PKG_DIR}" 2>/dev/null | tail -1)"; then
    die "打包失败（先跑 pnpm build 确认能构建）"
  fi
  [ -f "${INSTALL_SPEC}" ] || die "打包产物不存在：${INSTALL_SPEC}"
  actual_basename="$(basename "${INSTALL_SPEC}")"
  if [ "${actual_basename}" != "${PKG_BASENAME}" ]; then
    note "⚠️  tarball 名与预期不同（预期 ${PKG_BASENAME}，实际 ${actual_basename}）"
  fi
  note "tarball：${INSTALL_SPEC}（$(du -h "${INSTALL_SPEC}" | cut -f1)）"
fi

note "重装插件：${PLUGIN_NAME} ← ${INSTALL_SPEC}（模式 ${INSTALL_MODE}）"
if ! run_dsh plugin --profile "${PROFILE}" remove "${PLUGIN_NAME}" >/dev/null 2>&1; then
  note "（此前未安装或移除失败，继续安装）"
fi
if ! run_dsh plugin --profile "${PROFILE}" add "${INSTALL_SPEC}" >/dev/null 2>&1; then
  die "插件安装失败——手工复现：DSH_HOME=${DEV_HOME} ${DSH_BIN} plugin --profile ${PROFILE} add ${INSTALL_SPEC}"
fi
if [ "${INSTALL_MODE}" = "pack" ]; then
  installed_path="$(cd "${DEV_HOME}/profiles/${PROFILE}/node_modules/${PLUGIN_NAME}" 2>/dev/null && pwd -P || echo '')"
  note "插件已安装（冻结副本）：${installed_path}"
else
  note "插件已安装（link 到仓库，切分支会影响它；要冻结请用 INSTALL_MODE=pack）"
fi

PLUGIN_DATA_DIR="${DEV_HOME}/plugin-data/$(basename "${PLUGIN}")"
if [ "${RESET_PLUGIN_DATA}" = "1" ]; then
  if [ -e "${PLUGIN_DATA_DIR}" ]; then
    rm -rf "${PLUGIN_DATA_DIR}"
    note "已清空插件数据：${PLUGIN_DATA_DIR}"
  fi
else
  note "插件数据保留（要清用 RESET_PLUGIN_DATA=1）：${PLUGIN_DATA_DIR}"
fi
note "home 顶层未删除任何内容：$(ls -1 "${DEV_HOME}" 2>/dev/null | tr '\n' ' ')"

# ── 6) 启动（用户显式给了 --port 就不覆盖）───────────────────────────────────
has_port=0
for a in "$@"; do
  if [ "${a}" = "--port" ]; then has_port=1; fi
done
extra=()
if [ "${has_port}" = "0" ]; then extra=(--port "${PORT}"); fi

note "启动：DSH_HOME=${DSH_HOME} profile=${PROFILE} 端口=${PORT}（Ctrl-C 退出）"
note "自检：本进程能看到 DSH_HOME=${DSH_HOME}；隔离 home 已装插件 = $(ls -1 "${DEV_HOME}/profiles/${PROFILE}/node_modules/@hpyperry" 2>/dev/null | tr '\n' ' ')"
"${DSH_BIN}" --profile "${PROFILE}" "${extra[@]+"${extra[@]}"}" "$@"
