#!/usr/bin/env bash
# dsh-local.sh —— 取一个**版本化本地安装**的 dsh CLI，用于测试。
# 安装目录默认 ~/.dsh-tools/<版本>/（可 DSH_TOOLS_DIR 覆盖），与 npm 全局安装
# （`which dsh` 命中的那份）完全无关：不读取、不覆盖、不升级全局。
#
# 用法：
#   DSH_VERSION=0.1.2-rc.1 ./scripts/dsh-local.sh            # 装（若缺）并打印 dsh bin 绝对路径
#   DSH_VERSION=0.1.1-rc.2 ./scripts/dsh-local.sh            # 任意版本（同轨 A 生产基线）
#   DSH_TOOLS_DIR=/tmp/dsh-tools DSH_VERSION=0.1.2-rc.1 ./scripts/dsh-local.sh  # 自定义工具目录
#
# 典型配合（scripts/dev-isolate.sh 的 DSH_BIN）：
#   DSH_BIN="$(DSH_VERSION=0.1.2-rc.1 ./scripts/dsh-local.sh)" \
#     DEV_HOME="$HOME/.dsh-dev-rc1" PROFILE=ref-lib-rc1 ./scripts/dev-isolate.sh
#
# 清理：rm -rf "${DSH_TOOLS_DIR:-$HOME/.dsh-tools}"
set -euo pipefail

DSH_VERSION="${DSH_VERSION:-0.1.2-rc.1}"
TOOLS_DIR="${DSH_TOOLS_DIR:-$HOME/.dsh-tools}"
PREFIX="$TOOLS_DIR/$DSH_VERSION"
BIN="$PREFIX/node_modules/.bin/dsh"

if [ ! -x "$BIN" ]; then
  echo "dsh-local: installing @deepseek-ai/dsh@$DSH_VERSION -> $PREFIX" >&2
  mkdir -p "$PREFIX"
  npm install --prefix "$PREFIX" --no-fund --no-audit "@deepseek-ai/dsh@$DSH_VERSION" >&2
fi

printf '%s\n' "$BIN"
