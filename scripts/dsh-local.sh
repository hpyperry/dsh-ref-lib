#!/usr/bin/env bash
# dsh-local.sh —— 取一份**版本化、非全局**的 dsh CLI 用于测试（跟 dsh 通道：main=latest；next 预留）。
#
# stdout **只打印 dsh bin 的绝对路径**（便于 `DSH_BIN="$(...)"` 捕获）；进度/提示走 stderr。
#
# 用法：
#   DSH_TRACK=main ./scripts/dsh-local.sh                 # 跟 npm latest（= dsh 主线）
#   DSH_TRACK=next ./scripts/dsh-local.sh                 # 跟 npm next
#   DSH_VERSION=0.1.5-rc.3 ./scripts/dsh-local.sh         # 显式钉版本
#   DSH_CACHE_DIR=~/.dsh-tools DSH_TRACK=next ./scripts/dsh-local.sh   # 缓存复用，不重复下载
#   ./scripts/dsh-local.sh --print-version                # 只解析并打印该通道的版本号（不安装）
#
# 环境变量：
#   DSH_TRACK=main|next   跟哪条 dsh 通道（默认 main）；DSH_VERSION 优先
#   DSH_VERSION=<版本>    显式版本
#   DSH_PREFIX=<目录>     指定安装目录（最优先）
#   DSH_CACHE_DIR=<目录>  缓存根：装到 <目录>/<版本>，下次同版本直接复用
#   DSH_FRESH=1           强制清空重装
#   兼容旧用法：DSH_TOOLS_DIR=<目录> 等价于 DSH_CACHE_DIR
#
# 安装位置规则（默认**临时**，符合"每次拉新的临时版本、不全局下载"）：
#   DSH_PREFIX 给定          → 用它
#   DSH_CACHE_DIR/TOOLS_DIR  → <目录>/<版本>
#   都没给                   → mktemp -d 临时目录（**本脚本不负责删除**，调用方用完自理；
#                              直接跑 dev-isolate.sh 时由它自动删）
#
# 典型配合（dev-isolate.sh 已内置同样的流程，一般直接用那个即可）：
#   DSH_BIN="$(DSH_TRACK=main ./scripts/dsh-local.sh)" \
#     DEV_HOME="$HOME/.dsh-dev-main" ./scripts/dev-isolate.sh
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/dsh-track.sh
. "${SELF_DIR}/dsh-track.sh"

PRINT_VERSION_ONLY=0
for arg in "$@"; do
  case "${arg}" in
    --print-version) PRINT_VERSION_ONLY=1 ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "dsh-local: 未知参数 '${arg}'（只支持 --print-version / --help）" >&2; exit 2 ;;
  esac
done

if ! VERSION="$(dsh_resolve_version)"; then
  echo "dsh-local: 解析 dsh 版本失败（registry 不通？设 DSH_VERSION=<版本> 或 DSH_CACHE_DIR=<目录>）" >&2
  exit 1
fi

if [ "${PRINT_VERSION_ONLY}" = "1" ]; then
  printf '%s\n' "${VERSION}"
  exit 0
fi

if [ -n "${DSH_PREFIX:-}" ]; then
  PREFIX="${DSH_PREFIX}"
elif [ -n "${DSH_CACHE_DIR:-${DSH_TOOLS_DIR:-}}" ]; then
  PREFIX="${DSH_CACHE_DIR:-${DSH_TOOLS_DIR}}/${VERSION}"
else
  PREFIX="$(mktemp -d "${TMPDIR:-/tmp}/dsh-${VERSION}-XXXXXX")"
  echo "dsh-local: 临时安装目录 ${PREFIX}（用完请 rm -rf；想复用请设 DSH_CACHE_DIR）" >&2
fi

echo "dsh-local: 通道=${DSH_TRACK:-main} 版本=${VERSION} 目录=${PREFIX}" >&2
dsh_install_cli "${VERSION}" "${PREFIX}"
