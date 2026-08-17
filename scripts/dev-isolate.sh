#!/usr/bin/env bash
# 启动**隔离**的 dsh web 开发环境：数据（会话日志/设置/profile）全部落在
# $DEV_HOME（默认 ~/.dsh-dev），绝不触碰真实 $HOME/.dsh。
#
# 为什么需要它（2026-08-17 事故教训）：开发期插件若直接装进真实 web profile
# 并在真实会话上联调，任何"写会话日志/改配置"的实验都可能污染真实数据——
# ref-lib v1/v2 就是这样把真实会话日志写坏的（自定义事件触发加载器整体拒读）。
# 隔离环境让实验的破坏半径收敛到一个可随时 rm -rf 的目录。
#
# 用法：
#   ./scripts/dev-isolate.sh                 # 启动隔离 web（默认 ~/.dsh-dev）
#   DEV_HOME=/tmp/dsh-dev ./scripts/dev-isolate.sh   # 自定义隔离 home
#   PLUGIN=/path/to/other-plugin ./scripts/dev-isolate.sh  # 隔离其他插件（默认本插件）
#   DEV_HOME=/tmp/dsh-dev ./scripts/dev-isolate.sh --dump-config  # 透传 dsh 参数
#
# 清理：rm -rf "$DEV_HOME" 即完全重置开发环境。
set -euo pipefail

PLUGIN="${PLUGIN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEV_HOME="${DEV_HOME:-$HOME/.dsh-dev}"
PROFILE="${PROFILE:-web}"

# 包名以插件 package.json 的 name 为准（目录名可能 ≠ 包名，如 @scope/pkg）
PLUGIN_NAME="$(node -e 'const fs=require("node:fs");const j=JSON.parse(fs.readFileSync(process.argv[1]+"/package.json","utf8"));process.stdout.write(j.name||"")' "$PLUGIN" 2>/dev/null || true)"
PLUGIN_NAME="${PLUGIN_NAME:-$(basename "$PLUGIN")}"

mkdir -p "$DEV_HOME"

# 首次运行：把插件装进隔离 home 的 profile（与真实环境完全独立）
if [ ! -e "$DEV_HOME/profiles/$PROFILE/node_modules/$PLUGIN_NAME" ]; then
  echo "首次运行：安装插件 '$PLUGIN'（${PLUGIN_NAME}）到隔离环境 DSH_HOME=$DEV_HOME (profile=$PROFILE) ..."
  DSH_HOME="$DEV_HOME" dsh plugin --profile "$PROFILE" add "$PLUGIN"
fi

echo "启动隔离开发环境：DSH_HOME=${DEV_HOME}（真实 ${HOME}/.dsh 不受影响；Ctrl-C 退出，rm -rf $DEV_HOME 重置）"
exec env DSH_HOME="$DEV_HOME" dsh --profile "$PROFILE" "$@"
