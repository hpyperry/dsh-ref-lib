#!/usr/bin/env bash
# scripts/dsh-track.sh —— dsh「通道 → 版本」解析 + 临时安装共用库。
#
# 被 scripts/dsh-local.sh 与 scripts/dev-isolate.sh `source`（不直接执行）。
#
# 三条约定（2026-09-25 修订；ref-lib 当前跟 dsh npm `next` = 0.1.7-rc.2，见 AGENTS.md §1）：
#   1) **永不全局安装**：一律 `npm install --prefix <目录>`；目录默认是 mktemp 出来的
#      临时目录（用完即删），也可用 DSH_CACHE_DIR 按版本缓存到用户目录复用。
#      **任何情况下都不执行 `npm i -g`、不改 PATH、不碰 `which dsh` 那份全局 CLI。**
#   2) **版本按 dist-tag 解析**：`main`（默认）= npm `dist-tags.latest`；也可传任意
#      dist-tag（如 `next`）。也可用 DSH_VERSION 显式钉版本。只读 registry 的元数据。
#   3) 本库只管 CLI；隔离 home（含 sk/会话）由调用方管理，本库不读不写。

# registry 元数据地址（可用 DSH_REGISTRY_URL 覆盖，例如内网镜像）。
DSH_REGISTRY_URL="${DSH_REGISTRY_URL:-https://registry.npmjs.org/@deepseek-ai%2Fdsh}"

# 解析 npm dist-tag → 该 tag 当前的 dsh 版本号（stdout 单行）。
# 用法：dsh_track_version main|latest|next|…
dsh_track_version() {
  local track="$1" tag
  case "${track}" in
    ""|main) tag=latest ;;
    *) tag="${track}" ;;
  esac
  command -v curl >/dev/null 2>&1 || { echo "dsh-track: 需要 curl" >&2; return 1; }
  command -v node >/dev/null 2>&1 || { echo "dsh-track: 需要 node" >&2; return 1; }
  curl -fsS --max-time 25 "${DSH_REGISTRY_URL}" | node -e '
let s = ""
process.stdin.on("data", (d) => { s += d })
process.stdin.on("end", () => {
  let tags
  try { tags = JSON.parse(s)["dist-tags"] ?? {} } catch { process.exit(3) }
  const v = tags[process.argv[1]]
  if (typeof v !== "string" || v === "") {
    console.error("dsh-track: registry 缺少 dist-tag " + process.argv[1])
    process.exit(4)
  }
  process.stdout.write(v)
})' "${tag}"
}

# 解析最终使用的 dsh 版本号（stdout 单行）。
# 优先 DSH_VERSION（显式钉版本），否则按 DSH_TRACK（默认 next = 插件所跟踪的通道）查 registry。
# 用法：dsh_resolve_version
dsh_resolve_version() {
  if [ -n "${DSH_VERSION:-}" ]; then
    printf '%s\n' "${DSH_VERSION}"
    return 0
  fi
  # DSH_TRACK 为准；也接受 TRACK（dev-isolate.sh 用的就是 TRACK，别再踩一次）
  dsh_track_version "${DSH_TRACK:-${TRACK:-next}}"
}

# 判断某个版本是否落在 `>=A <B` 形式的宿主区间内（落在区间内返回 0，否则 1）。
#
# 为什么自己写而不是用 semver 包：本仓库不依赖 semver，而这里只需要「区间成员判定 +
# 预发布感知比较」（0.1.7-rc.2 < 0.1.7-rc.3 < 0.1.7 < 0.2.0），30 行足够且可读。
# 用法：dsh_version_in_range <版本> <区间>
dsh_version_in_range() {
  local version="$1" range="$2"
  command -v node >/dev/null 2>&1 || { echo "dsh-track: 需要 node 校验宿主区间" >&2; return 1; }
  node -e '
const [v, range] = process.argv.slice(1)
function parse(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(s)
  if (m === null) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] }
}
function cmp(a, b) {
  const A = parse(a), B = parse(b)
  if (A === null || B === null) return NaN
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1
  if (A.pre.length === 0 && B.pre.length === 0) return 0
  if (A.pre.length === 0) return 1      // 正式版 > 同号预发布
  if (B.pre.length === 0) return -1
  const n = Math.max(A.pre.length, B.pre.length)
  for (let i = 0; i < n; i++) {
    const x = A.pre[i], y = B.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}
const lo = /(?:^|\s)>=([^\s]+)/.exec(range)
const hi = /(?:^|\s)<([^\s]+)/.exec(range)
if (lo !== null && !(cmp(v, lo[1]) >= 0)) process.exit(1)
if (hi !== null && !(cmp(v, hi[1]) < 0)) process.exit(1)
process.exit(0)
' "${version}" "${range}"
}

# 只读探测某个安装目录里已装的 dsh 版本（未装则打印空串）。
dsh_installed_version() {
  local prefix="$1" manifest="$1/node_modules/@deepseek-ai/dsh/package.json"
  [ -f "${manifest}" ] || return 0
  node -p 'require(process.argv[1]).version' "${manifest}" 2>/dev/null || true
}

# 把指定版本装到指定目录，并把该目录里的 dsh bin 绝对路径打到 stdout。
# 幂等：目录里已经是目标版本就跳过（除非 DSH_FRESH=1）；装错版本会就地纠正。
# 用法：dsh_install_cli <版本> <安装目录>
dsh_install_cli() {
  # 注意：bash 3.2（macOS 自带）+ set -u 下，同一 local 语句里引用同句刚声明的变量会报
  # "unbound variable"，所以 bin 单独声明。
  local version="$1" prefix="$2" installed=""
  local bin="${prefix}/node_modules/.bin/dsh"
  command -v npm >/dev/null 2>&1 || { echo "dsh-track: 需要 npm（仅用其 --prefix 安装能力，不做全局安装）" >&2; return 1; }

  if [ "${DSH_FRESH:-0}" = "1" ] && [ -e "${prefix}" ]; then
    echo "dsh-track: DSH_FRESH=1 → 清空 ${prefix} 后重装" >&2
    rm -rf "${prefix}"
  fi

  installed="$(dsh_installed_version "${prefix}")"
  if [ "${installed}" != "${version}" ]; then
    if [ -n "${installed}" ]; then
      echo "dsh-track: ${prefix} 里是 ${installed}，需要 ${version} → 重装" >&2
    fi
    echo "dsh-track: 安装 @deepseek-ai/dsh@${version} → ${prefix}（--prefix 本地安装，不是全局）" >&2
    mkdir -p "${prefix}"
    npm install --prefix "${prefix}" --no-fund --no-audit "@deepseek-ai/dsh@${version}" >&2 || {
      echo "dsh-track: npm 安装失败（需要网络可达 registry；离线请先用 DSH_CACHE_DIR 备好缓存）" >&2
      return 1
    }
    installed="$(dsh_installed_version "${prefix}")"
    if [ "${installed}" != "${version}" ]; then
      echo "dsh-track: 安装后版本仍是 '${installed}'，期望 '${version}'" >&2
      return 1
    fi
  fi

  [ -x "${bin}" ] || { echo "dsh-track: 找不到可执行文件 ${bin}" >&2; return 1; }
  printf '%s\n' "${bin}"
}
