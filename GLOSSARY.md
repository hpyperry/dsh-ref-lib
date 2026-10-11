# ref-lib

只读参考库插件：给每个会话挂一组本地只读目录，agent 回答前先去这些目录查证。
本文件只收本仓库特有的词汇，不放通用编程概念。

## Language

**参考库 (reference library)**:
挂在一个会话上的一组本地只读目录；其中查得到的答案不必再走外部来源。
_Avoid_: 知识库、语料、索引

**参考库条目 (entry)**:
参考库里的单条记录，由 `id` / `path`（realpath 绝对路径）/ `note?` / `status?` 组成。
_Avoid_: 目录项、库项

**侧车 (sidecar)**:
插件的 per-session 状态文件 `<dshHome>/plugin-data/ref-lib/<sessionId>.json`，
是会话事件之外唯一的落盘位置——会话日志只允许宿主白名单内的事件类型。
_Avoid_: 缓存、存档

**轨道 (track)**:
dsh 的 npm dist-tag（`next` / `latest` / …），不是 git 分支。
"单轨维护"指只在 `main` 上开发、靠 `TRACK` / `DSH_VERSION` 在隔离环境里钉住别的版本试，
与"插件支持多少代宿主"无关——那件事由 `peerDependencies` 的区间决定。
_Avoid_: 分支、版本线、兼容线
