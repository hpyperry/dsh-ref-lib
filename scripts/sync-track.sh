#!/usr/bin/env bash
# sync-track.sh —— 两轨同步助手（main 跟 dsh npm `latest`，next 跟 dsh npm `next`）。
#
# 为什么需要它：两轨长期并存，但有几处**本来就该不同**——`package.json` 的 version 与
# `dsh-*` peer/devDeps、`pnpm-lock.yaml`（跟着前者变）、`README.md` 的安装对应表、
# `AGENTS.md` 里的轨道措辞。裸 `git merge` 会在这几处必然报冲突；本脚本改用
# `git merge -X ours <另一条轨>`：**共享改动照常合入，冲突块按「保留本轨」解决**
# （语义就是"版本号 / 依赖区间跟本轨走"）。按 AGENTS.md §2 的约定，真正共享的文件两边
# 应保持一致，所以"保留本轨"不会吞掉共享改动；预览会把自动解决的文件列出来供 review。
#
# 用法（在目标分支的工作区里执行）：
#   ./scripts/sync-track.sh                 # 自动推断来源轨（main ↔ next）
#   ./scripts/sync-track.sh --from main     # 显式指定来源
#   ./scripts/sync-track.sh --check         # 只预览，不改工作区
#
# 行为：校验工作区干净 → 预览（哪些冲突会被自动解决、哪些解决不了）→ 执行 merge
# （**不自动 commit**）。收尾请自己跑门禁并提交：
#   pnpm typecheck && pnpm lint && pnpm test && pnpm build
#   git commit
set -euo pipefail

die() { echo "sync-track: ✖ $*" >&2; exit 1; }
note() { echo "sync-track: $*"; }

FROM=""
CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) shift; [ $# -gt 0 ] || die "--from 需要一个分支名"; FROM="$1" ;;
    --from=*) FROM="${1#--from=}" ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
    *) die "未知参数 '$1'（可用：--from <分支> / --check）" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || die "不在 git 仓库里"
git merge-tree --write-tree HEAD HEAD >/dev/null 2>&1 || die "需要 git ≥ 2.38（merge-tree --write-tree）"

CUR="$(git symbolic-ref --quiet --short HEAD || true)"
[ -n "${CUR}" ] || die "当前处于 detached HEAD，先切到 main 或 next"

if [ -z "${FROM}" ]; then
  case "${CUR}" in
    main) FROM=next ;;
    next) FROM=main ;;
    *) die "当前分支 '${CUR}' 不是 main/next，请用 --from <分支> 指定来源" ;;
  esac
fi
[ "${FROM}" = "${CUR}" ] && die "来源轨与当前分支相同（${CUR}）"

if git rev-parse --verify --quiet "refs/heads/${FROM}" >/dev/null; then
  FROM_REF="${FROM}"
elif git rev-parse --verify --quiet "refs/remotes/origin/${FROM}" >/dev/null; then
  FROM_REF="origin/${FROM}"
else
  die "找不到分支 ${FROM}（本地与 origin 都没有）"
fi

[ -z "$(git status --porcelain --untracked-files=no)" ] || die "工作区有未提交改动，先提交或 stash 再同步"

note "当前分支 ${CUR}（$(git rev-parse --short HEAD)） ← 来源轨 ${FROM_REF}（$(git rev-parse --short "${FROM_REF}")）"

# 预览 1：默认 merge 会冲突的路径（这些将由「保留本轨」自动解决，需人工 review）
plain="$(git merge-tree --write-tree HEAD "${FROM_REF}" 2>&1 || true)"
auto="$(printf '%s\n' "${plain}" | grep '^CONFLICT' || true)"

# 预览 2：-X ours 之后仍冲突的部分（改/删、重命名等非文本冲突解决不了）
final="$(git merge-tree --write-tree -X ours HEAD "${FROM_REF}" 2>&1 || true)"
hard="$(printf '%s\n' "${final}" | grep '^CONFLICT' || true)"

if [ -n "${auto}" ]; then
  note "以下冲突将按「保留本轨」自动解决（review 它们是否只剩轨道专属内容）："
  printf '%s\n' "${auto}" | sed 's/^/    /'
else
  note "无冲突文件：本次是干净的快进/合并。"
fi

if [ -n "${hard}" ]; then
  note "⚠️  仍解决不了的冲突（-X ours 处理不了，通常是「一边改、一边删」或重命名）："
  printf '%s\n' "${hard}" | sed 's/^/    /'
  die "先手工处理（或按 AGENTS.md §2 把共享文件在两边对齐）再同步"
fi

if [ "${CHECK_ONLY}" = "1" ]; then
  note "干跑结束（--check）：未改动工作区。"
  exit 0
fi

note "执行：git merge --no-commit --no-ff -X ours ${FROM_REF}"
git merge --no-commit --no-ff -X ours "${FROM_REF}" >/dev/null

if ! git rev-parse --verify --quiet MERGE_HEAD >/dev/null; then
  note "已是最新，无内容可合。"
  exit 0
fi

note "已合入并暂存，改动概览："
git diff --cached --stat | sed 's/^/    /'
note "下一步：跑门禁 → 提交 merge"
note "    pnpm typecheck && pnpm lint && pnpm test && pnpm build"
note "    git commit"
