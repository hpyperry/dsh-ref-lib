#!/usr/bin/env bash
# upgrade-host.sh —— 把**真实** dsh 宿主升到指定通道，并把本插件（以 tarball 冻结副本的形式）
# 重装进真实 profile。和 dev-isolate.sh 的区别：**这个脚本动的是真实 `~/.dsh`**。
#
# 设计目标：
#   1) **先备份再动手**：默认 `cp -R ~/.dsh ~/.dsh.bak-<时间戳>`（见 docs/agents/dev-env.md）。
#      备份失败即中止——会话格式升级（v3 → v4）是不可逆的，旧宿主之后打不开写过的会话。
#   2) **非交互也要显式确认**：把"要做什么"先打印清楚，`--yes` 才跳过确认。
#   3) **两个动作可分开**：`SKIP_HOST=1` 只换插件；`SKIP_PLUGIN=1` 只升宿主（默认都做）。
#   4) **升级前先做兼容判断**：目标 dsh 版本必须落在插件声明的 dsh-* peer 区间内，
#      否则直接拒绝（`FORCE=1` 才继续）——避免升完发现插件装不上。
#   5) **不替你重启**：`dsh web` 需要手动重启才生效（client 扫描无 HMR），脚本只打印命令。
#
# 用法：
#   ./scripts/upgrade-host.sh                    # 升到 npm `next` 通道的 dsh + 重装插件（会先备份+确认）
#   ./scripts/upgrade-host.sh --check            # 干跑：只打印现状/计划，不动任何东西
#   ./scripts/upgrade-host.sh --yes              # 跳过交互确认（CI/脚本里用）
#   TRACK=latest ./scripts/upgrade-host.sh       # 跟别的 npm dist-tag
#   DSH_VERSION=0.1.7-rc.2 ./scripts/upgrade-host.sh   # 显式钉宿主版本
#   SKIP_HOST=1 ./scripts/upgrade-host.sh        # 只把插件换成本仓库当前构建
#   SKIP_PLUGIN=1 ./scripts/upgrade-host.sh      # 只升宿主，插件不动
#
# 环境变量：
#   TRACK=<npm dist-tag>   目标通道（默认 next）
#   DSH_VERSION=<版本>     显式钉宿主版本（覆盖 TRACK 解析）
#   PROFILE=web            真实 profile 名
#   REAL_HOME=<目录>       真实 dsh home（默认 ~/.dsh；必须在 $HOME 下且不在代码库里）
#   PLUGIN=<目录>          插件目录（默认本仓库根）
#   BACKUP=1|0             升级前整目录备份真实 home（默认 1）
#   SCAN_LEGACY=1|0        升级前扫旧日志里的 `ref-lib/set`（默认 0，见下）
#   FORCE=1                跳过"宿主不在插件 peer 区间内"的拒绝
#   PKG_ROOT=<目录>        打 tarball 的位置（默认 = 插件目录，即仓库根）
#
# 关于 SCAN_LEGACY（默认关，只对 0.1.2 时代的老 home 有意义）：2026-08-17 事故期的 v1/v2 插件把
# 状态写成会话事件 `ref-lib/set`，而含该事件的旧日志在 ≥0.1.3-alpha.2 宿主上会被**整体拒读**
# （v0→v1 迁移边拒绝未知事件类型，补 `ignorable` 标记也没用）。**那道坎早已过了**：本机当时已把
# 命中的 2 个会话删除，之后插件只写 sidecar（不再写会话事件），新日志不可能含它，所以默认不扫。
# 真要扫就 `SCAN_LEGACY=1`（必须用 `zstd -d -c`：会话日志是**多帧** zstd，直接 grep 压缩流或只解
# 第一帧都会恒报"零命中"）。命中后**先停手处置、再升级**：此时真实 home 还没被改动——先做整目录
# 备份，再把命中的会话文件移走（或离线重编码），然后才升级宿主。理由见 docs/agents/dev-env.md。
#
# 全程按这个顺序做，**顺序不能换**（理由见下面第 5 步的注释）：
#   构建并打包 → 校验产物 → 备份 → 升宿主 → 换插件 → 打印后续步骤。
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/dsh-track.sh
. "${SELF_DIR}/dsh-track.sh"

PLUGIN_RAW="${PLUGIN:-$(cd "${SELF_DIR}/.." && pwd)}"
PLUGIN="$(cd "${PLUGIN_RAW}" 2>/dev/null && pwd)" || { echo "upgrade-host: ✖ PLUGIN 目录不存在：${PLUGIN_RAW}" >&2; exit 1; }
TRACK="${TRACK:-next}"
PROFILE="${PROFILE:-web}"
REAL_HOME="${REAL_HOME:-${HOME}/.dsh}"
BACKUP="${BACKUP:-1}"
SCAN_LEGACY="${SCAN_LEGACY:-0}"
FORCE="${FORCE:-0}"
SKIP_HOST="${SKIP_HOST:-0}"
SKIP_PLUGIN="${SKIP_PLUGIN:-0}"
PKG_ROOT="${PKG_ROOT:-${PLUGIN}}"
CHECK_ONLY=0
ASSUME_YES=0

die() { echo "upgrade-host: ✖ $*" >&2; exit 1; }
note() { echo "upgrade-host: $*"; }

# 构建 + 打包 + 校验产物，成功时 stdout 打印 tarball 绝对路径。
#
# **刻意不解析 `pnpm pack` 的 stdout**：`pack` 会触发 `prepare`（= build），构建输出会混进
# stdout，`| tail -1` 抓到的可能是 `$ rm -rf lib` 这类噪音（2026-09-25 真实翻车：脚本因此
# 判定"产物不存在"，而当时宿主**已经升上去了**，把人留在半升级状态）。这里改为按包名/版本
# 自己算出文件名，跑完再校验两件事：① 文件确实存在；② 包内 version == 插件目录的 version。
# 任何一步不过就返回非 0——调用点在动真实环境**之前**，所以失败不会留下烂摊子。
pack_plugin() {
  local name version basename out inner log
  name="$(node -p 'require(process.argv[1]).name' "${PLUGIN}/package.json" 2>/dev/null || true)"
  version="$(node -p 'require(process.argv[1]).version' "${PLUGIN}/package.json" 2>/dev/null || true)"
  if [ -z "${name}" ] || [ -z "${version}" ]; then echo "upgrade-host: 读不出包名/版本" >&2; return 1; fi
  basename="$(printf '%s' "${name}" | sed 's|^@||; s|/|-|g')-${version}.tgz"
  out="${PKG_ROOT}/${basename}"
  mkdir -p "${PKG_ROOT}"
  rm -f "${out}"   # 清掉同名旧产物，避免拿上一次的包糊弄过去
  log="$(mktemp "${TMPDIR:-/tmp}/reflib-pack-XXXXXX.log")"
  if ! ( cd "${PLUGIN}" && pnpm pack --pack-destination "${PKG_ROOT}" ) >"${log}" 2>&1; then
    echo "upgrade-host: pnpm pack 失败，日志尾部：" >&2
    tail -15 "${log}" >&2
    rm -f "${log}"
    return 1
  fi
  rm -f "${log}"
  if [ ! -f "${out}" ]; then echo "upgrade-host: 打包后找不到 ${out}" >&2; return 1; fi
  inner="$(tar -xzOf "${out}" package/package.json 2>/dev/null | node -p 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).version' 2>/dev/null || true)"
  if [ "${inner}" != "${version}" ]; then echo "upgrade-host: 产物版本 '${inner}' ≠ package.json '${version}'" >&2; return 1; fi
  printf '%s\n' "${out}"
}

for a in "$@"; do
  case "${a}" in
    --check) CHECK_ONLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "未知参数 '${a}'（可用：--check / --yes / --help）" ;;
  esac
done

# ── 0) 真实 home 护栏：绝对路径 + 在 $HOME 下 + 不在代码库里 ──────────────────
case "${REAL_HOME}" in
  /*) ;;
  *) die "REAL_HOME 必须是绝对路径（收到 '${REAL_HOME}'）" ;;
esac
case "${REAL_HOME}" in
  "${PLUGIN}"|"${PLUGIN}"/*) die "REAL_HOME 不能落在插件目录内（${REAL_HOME}）" ;;
esac
case "${REAL_HOME}" in
  "${HOME}"/*) ;;
  *) die "REAL_HOME 必须在 ${HOME} 下（收到 ${REAL_HOME}）——本脚本操作真实环境，不提供绕行" ;;
esac
[ -d "${REAL_HOME}" ] || die "真实 home 不存在：${REAL_HOME}"
command -v npm >/dev/null 2>&1 || die "需要 npm（用来升级全局 dsh）"
command -v dsh >/dev/null 2>&1 || die "PATH 里没有 dsh——先确认全局 CLI 装在哪（npm prefix -g）"

# ── 1) 目标版本 + 插件声明 ──────────────────────────────────────────────────
TARGET="$(dsh_resolve_version)" || die "解析目标版本失败（registry 不通？可用 DSH_VERSION=<版本> 钉死）"
PLUGIN_VERSION="$(node -p 'require(process.argv[1]).version' "${PLUGIN}/package.json" 2>/dev/null || true)"
[ -n "${PLUGIN_VERSION}" ] || die "读不出插件版本：${PLUGIN}/package.json"
HOST_RANGE="$(node -p 'require(process.argv[1]).peerDependencies["@deepseek-ai/dsh-session"] ?? ""' "${PLUGIN}/package.json" 2>/dev/null || true)"
[ -n "${HOST_RANGE}" ] || die "读不出插件声明的宿主区间（peerDependencies['@deepseek-ai/dsh-session']）"

# ── 2) 现状 ────────────────────────────────────────────────────────────────
CURRENT_HOST="$(dsh --version 2>/dev/null | tail -1 || true)"
PROFILE_PKG="${REAL_HOME}/profiles/${PROFILE}/package.json"
CURRENT_SPEC="$(node -p 'require(process.argv[1]).dependencies?.["@hpyperry/dsh-ref-lib"] ?? "(未安装)"' "${PROFILE_PKG}" 2>/dev/null || echo "(无 profile)")"

note "宿主：${CURRENT_HOST:-未知}  →  目标：${TARGET}（通道 ${TRACK}）"
note "插件：${PLUGIN_VERSION}  安装方式：${CURRENT_SPEC}"
note "profile：${PROFILE}（${PROFILE_PKG}）"

# ── 3) 兼容判断：目标宿主必须在插件声明的区间里 ───────────────────────────────
if dsh_version_in_range "${TARGET}" "${HOST_RANGE}"; then
  note "兼容检查通过：dsh ${TARGET} ∈ ${HOST_RANGE}"
else
  msg="dsh ${TARGET} 不在插件 ${PLUGIN_VERSION} 声明的宿主范围内（${HOST_RANGE}）"
  [ "${FORCE}" = "1" ] || die "${msg}——先把插件升到支持它的版本，或 FORCE=1 强行继续"
  note "⚠️  ${msg}（FORCE=1，继续）"
fi

# ── 4) 可选：旧日志扫描（默认关，理由与处置见头部注释）──────────────────────
if [ "${SCAN_LEGACY}" = "1" ]; then
  command -v zstd >/dev/null 2>&1 || die "SCAN_LEGACY=1 需要 zstd（多帧 zstd 必须用 zstd -d -c 解）"
  hits=0
  while IFS= read -r f; do
    n="$(zstd -d -c -q "${f}" 2>/dev/null | grep -c '"type":"ref-lib/set"' || true)"
    if [ "${n}" != "0" ]; then note "⚠️  命中 ${n} 处 ref-lib/set：${f}"; hits=$((hits + 1)); fi
  done < <(find "${REAL_HOME}/sessions" -name 'session*.jsonl.zstd' ! -name '*.bak-*' 2>/dev/null || true)
  note "旧日志扫描完成：${hits} 个文件命中（命中会让该会话在新宿主上读不出来，需先处置）"
  if [ "${hits}" != "0" ]; then
    [ "${ASSUME_YES}" = "1" ] || die "命中旧日志：真实 home 还没动，先按头部 SCAN_LEGACY 说明做整目录备份并处置这些会话，再重跑升级"
  fi
fi

# ── 5) **先准备插件产物**（build + pack + 校验）──────────────────────────────
# 刻意排在备份/升宿主**之前**：打包是最容易出岔子的一步，必须在动真实环境之前暴露——
# 否则会出现"宿主升上去了、插件没换"的半升级状态（2026-09-25 真实翻车就是这样）。
TGZ=""
if [ "${SKIP_PLUGIN}" = "1" ]; then
  note "跳过准备插件产物（SKIP_PLUGIN=1）"
elif [ "${CHECK_ONLY}" = "1" ]; then
  note "（--check：本次不打包；真跑时会**先**打包并校验产物，失败则什么都不动）"
else
  note "准备插件产物：pnpm build + pnpm pack → ${PKG_ROOT}"
  if ! TGZ="$(pack_plugin)"; then
    die "插件产物准备失败——**没有动任何真实环境**（宿主与插件都保持原样），修好后再跑"
  fi
  note "产物就绪：${TGZ}（$(du -h "${TGZ}" | cut -f1)）"
fi

# ── 6) 计划 + 确认 ─────────────────────────────────────────────────────────
BK_DIR="${REAL_HOME}.bak-$(date +%Y%m%d-%H%M%S)"
echo
note "计划："
[ "${BACKUP}" = "1" ] && note "  1. 备份真实 home → ${BK_DIR}"
[ "${SKIP_HOST}" = "1" ] && note "  2. （SKIP_HOST=1，跳过升宿主）" || note "  2. npm i -g @deepseek-ai/dsh@${TARGET}"
[ "${SKIP_PLUGIN}" = "1" ] && note "  3. （SKIP_PLUGIN=1，跳过换插件）" || note "  3. dsh plugin --profile ${PROFILE} remove → add ${TGZ}（装不上会自动把原插件装回去）"
note "  4. 由你手动重启 dsh web（脚本不碰你正在跑的进程）"
if [ "${CHECK_ONLY}" = "1" ]; then
  note "干跑结束（--check）：以上都没有执行。"
  exit 0
fi

if [ "${ASSUME_YES}" != "1" ]; then
  printf 'upgrade-host: 确认执行？输入 yes 继续：' >&2
  read -r reply
  [ "${reply}" = "yes" ] || die "已取消（要跳过确认用 --yes）"
fi

# ── 7) 备份（L4）────────────────────────────────────────────────────────────
if [ "${BACKUP}" = "1" ]; then
  note "备份：${REAL_HOME} → ${BK_DIR}"
  cp -R "${REAL_HOME}" "${BK_DIR}" || die "备份失败——已中止（不做无备份的格式升级）"
  note "备份完成（$(du -sh "${BK_DIR}" 2>/dev/null | cut -f1)）；确认一切正常后再删它"
else
  note "⚠️  BACKUP=0：跳过备份（会话格式 v3→v4 不可逆，出事没得回退）"
fi

# ── 8) 升宿主 ──────────────────────────────────────────────────────────────
if [ "${SKIP_HOST}" = "1" ]; then
  note "跳过升宿主（SKIP_HOST=1）"
else
  note "安装 @deepseek-ai/dsh@${TARGET}（全局，npm prefix -g = $(npm prefix -g 2>/dev/null || echo '?')）"
  npm install --global "@deepseek-ai/dsh@${TARGET}" || die "npm i -g 失败（缓存 owner 问题可试：sudo chown -R \$(id -u):\$(id -g) ~/.npm）"
  after="$(dsh --version 2>/dev/null | tail -1 || true)"
  note "宿主现在是：${after:-未知}"
  [ "${after}" = "${TARGET}" ] || note "⚠️  版本仍是 ${after}，期望 ${TARGET}——检查是否有别的 dsh 抢了 PATH"
fi

# ── 9) 换插件：先移除旧的、再装刚校验过的产物；装不上就把原来的装回去 ──────────
if [ "${SKIP_PLUGIN}" = "1" ]; then
  note "跳过换插件（SKIP_PLUGIN=1）"
else
  note "移除旧插件：@hpyperry/dsh-ref-lib（当前 ${CURRENT_SPEC}）"
  dsh plugin --profile "${PROFILE}" remove @hpyperry/dsh-ref-lib >/dev/null 2>&1 || note "（此前未安装或移除失败，继续）"
  note "安装：${TGZ}"
  if ! dsh plugin --profile "${PROFILE}" add "${TGZ}" >/dev/null 2>&1; then
    case "${CURRENT_SPEC}" in
      "(未安装)"|"(无 profile)"|"")
        note "⚠️  安装失败，且原先就没装，无可回滚" ;;
      *)
        note "⚠️  安装失败，尝试把原来的插件装回去：${CURRENT_SPEC}"
        if dsh plugin --profile "${PROFILE}" add "${CURRENT_SPEC}" >/dev/null 2>&1; then
          note "已回滚到原插件（宿主已是 ${TARGET}，插件仍是旧版）"
        else
          note "⚠️  回滚也失败，手工执行：dsh plugin --profile ${PROFILE} add ${CURRENT_SPEC}"
        fi ;;
    esac
    die "插件安装失败——tarball 在 ${TGZ}，手工复现：dsh plugin --profile ${PROFILE} add ${TGZ}"
  fi
  installed="$(node -p 'require(process.argv[1]).version' "${REAL_HOME}/profiles/${PROFILE}/node_modules/@hpyperry/dsh-ref-lib/package.json" 2>/dev/null || echo '?')"
  [ "${installed}" = "${PLUGIN_VERSION}" ] || die "装上的版本是 '${installed}'，期望 '${PLUGIN_VERSION}'——检查 tarball：${TGZ}"
  note "插件已装：${installed}"
fi

# ── 10) 后续步骤（手动）──────────────────────────────────────────────────────
cat <<EOF

upgrade-host: 完成。**还差最后一步（手动）**：

  1) 重启 dsh web（宿主换版 + 插件换版都必须重启；client 扫描按包名解析，无 HMR）：
       在跑 dsh web 的终端按 Ctrl-C，然后重新起。

  2) 重启后核验：
       dsh --version                                                              # 期望 ${TARGET}
       node -p "require('${REAL_HOME}/profiles/${PROFILE}/node_modules/@hpyperry/dsh-ref-lib/package.json').version"   # 期望 ${PLUGIN_VERSION}
       find ${REAL_HOME}/sessions -name 'session.v4.jsonl.zstd' | head -3          # 新会话应落 v4（0.1.7 起）
     GUI 里看：dock 胶囊在、图标不空白、/ref-lib list 能跑、控制台无报错。

  3) 一切正常后再清理：
       rm -rf "${BK_DIR}"        # L4 备份
       # 仓库根的旧 tarball（0.1.5-rc.3 / 0.1.7-rc.2）确认没有 profile 再引用后可删
EOF
