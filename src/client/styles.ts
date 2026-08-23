/**
 * ref-lib client 样式注入：在文档头挂一张本插件专属的 <style data-plugin> 标签。
 *
 * 为什么不用 CSS Modules：ref-lib 的 tsdown 配置未移植 core 的 lightningcss
 * CSS-Modules 插件（避免新增 native 依赖与构建面），而内联 style 无法表达
 * hover/媒体查询/动画。因此采用运行时注入单张样式表——与 loader 的清理契约
 * 兼容（`data-plugin` 标签在插件卸载/HMR 时由 loader 移除，重新物化时本模块
 * 重新注入，幂等）。类名统一 `reflib-` 前缀防碰撞；颜色/字号/圆角全部走
 * `--dsw-*` 设计令牌，随主题（浅色/深色）自动适配——这是"字体显示不一致、
 * 没有设计感"的根因修复之一（旧实现硬编码 #d33 等，不随主题变化）。
 * @module @hpyperry/dsh-ref-lib/src/client/styles
 */

/** 插件 id（与 package.json 的 bundle 手递一致，loader 按它清理样式）。 */
const PLUGIN_ID = '@hpyperry/dsh-ref-lib'
/** 样式标签稳定 id（幂等注入的判据）。 */
const STYLE_TAG_ID = '@hpyperry/dsh-ref-lib/styles'

const CSS = `
/* ── 输入卡正上方的入口胶囊行（dock）──
   独立一行，横跨整个 composer 列；chip 与输入卡左缘对齐——用官方设计令牌
   （--dsh-composer-side-clearance / --dsh-composer-card-max-width）纯 CSS 计算，
   零 JS 测量（v7 起取消 hero 相位测量/绝对定位）；hero 与 active 一致，
   plan/model 等工具行座位的启停不影响本行位置。 */
.reflib-dock {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-width: 0;
  /* 镜像输入卡居中：chip 落在输入卡左缘之上（宽视口 = 居中余量，窄视口 = clearance） */
  padding-left: max(
    var(--dsh-composer-side-clearance, 16px),
    calc((100% - var(--dsh-composer-card-max-width, 100%)) / 2)
  );
}

.reflib-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 30px;
  padding: 0 10px 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 15px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.reflib-chip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.reflib-chip:active {
  background: var(--dsw-alias-interactive-bg-active);
}

.reflib-chip[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}

.reflib-chipIcon {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.reflib-chipLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reflib-chipBadge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-label-primary-bluish);
  font-size: 11px;
  line-height: 18px;
  font-weight: 500;
}

/* 失效条目计数角标（v9）：红色系，与普通数量徽标区分。 */
.reflib-chipWarn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--dsw-alias-state-error-primary);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  font-weight: 500;
}

/* ── 应用内目录浏览器（browse 后端）── */
.reflib-browser {
  width: min(460px, 100%);
}

.reflib-browserPath {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}

.reflib-browserCrumbs {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.reflib-browserCrumbs::-webkit-scrollbar {
  display: none;
}

.reflib-browserCrumb {
  display: inline-flex;
  align-items: center;
  flex: none;
}

.reflib-browserCrumbChevron {
  flex: none;
  color: var(--dsw-alias-label-caption);
}

.reflib-browserCrumbBtn {
  display: inline-flex;
  align-items: center;
  max-width: 160px;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.reflib-browserCrumbBtn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.reflib-browserCrumbBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.reflib-browserEdit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.reflib-browserEdit:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.reflib-browserEdit:disabled {
  opacity: 0.5;
  cursor: default;
}

.reflib-browserInput {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
}

.reflib-browserInput::placeholder {
  color: var(--dsw-alias-label-dimmed);
}

.reflib-browserList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 264px;
  min-height: 60px;
  overflow-y: auto;
  margin: 0 -8px;
  padding: 0 8px;
}

.reflib-browserRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
  text-align: left;
}

.reflib-browserRow:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.reflib-browserRow:disabled {
  opacity: 0.5;
  cursor: default;
}

.reflib-browserRowIcon {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.reflib-browserRowName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reflib-browserFooter {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

/* ── 管理面板 ── */
.reflib-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* 顶部状态行（对齐原型）：可用数绿点 / 失效数红点 */
.reflib-statusline {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.reflib-statuslineItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.reflib-statuslineDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.reflib-statuslineDot[data-tone='ok'] {
  background: var(--dsw-alias-state-success-primary);
}
.reflib-statuslineDot[data-tone='err'] {
  background: var(--dsw-alias-state-error-primary, var(--dsw-alias-state-error-primary));
}

/* 列表：固定最大高度 + 内滚动（旧实现整个面板滚动、无设计，此处分层） */
.reflib-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -8px;
  padding: 0 8px;
}

/* 条目行卡片（对齐原型 .row）：带边框 + 底色 + 圆角，hover 边框变亮 */
.reflib-listItem {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  transition: border-color 120ms ease;
}

.reflib-listItem:hover {
  border-color: var(--dsw-alias-border-l2);
}

.reflib-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 10px;
  border-radius: 8px;
  transition: background-color 120ms ease;
}

.reflib-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.reflib-listItem[data-removing='true'] {
  opacity: 0.55;
  pointer-events: none;
}

.reflib-rowIcon {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

/* 失效条目行图标（v9）：警示色。 */
.reflib-rowIconWarn {
  color: var(--dsw-alias-state-error-primary);
}

.reflib-rowBody {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.reflib-rowName {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reflib-rowPath {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 列表行用途说明（Description，v8）：单行截断，与路径同属次行层级 */
.reflib-rowNote {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 失效条目徽标（v13 UI 打磨）：名称旁红色胶囊，替代整行状态文字（减少三重表达） */
.reflib-rowBadge {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 9px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}

.reflib-rowRemove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.reflib-rowRemove:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}

.reflib-rowRemove:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 详情/编辑入口按钮（与移除同尺寸，非危险 hover） */
.reflib-rowAction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.reflib-rowAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.reflib-rowAction:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 条目详情展开区（ID / 路径 / 用途编辑） */
.reflib-detail {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 2px 0 6px;
  padding: 8px 10px 10px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  min-width: 0;
}

.reflib-detailMeta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.reflib-detailKey {
  flex: none;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
}

.reflib-detailValue {
  overflow: hidden;
  min-width: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reflib-detailActions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}

/* 用途说明多行输入（添加表单 + 详情编辑共用） */
.reflib-noteWrap {
  position: relative;
  display: flex;
  min-width: 0;
}

.reflib-noteTextarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  resize: vertical;
  min-height: 40px;
}

.reflib-noteTextarea:focus {
  outline: 2px solid var(--dsw-alias-focus-ring, var(--dsw-alias-state-info-primary));
  outline-offset: -1px;
}

.reflib-noteTextarea:disabled {
  opacity: 0.5;
}

.reflib-noteCount {
  position: absolute;
  right: 8px;
  bottom: 6px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 10px;
  line-height: 14px;
  color: var(--dsw-alias-label-caption);
  pointer-events: none;
}

/* 空态 / 加载态 / 错误态 */
.reflib-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 8px;
  color: var(--dsw-alias-label-caption);
  text-align: center;
}

.reflib-statusIcon {
  display: inline-flex;
  color: var(--dsw-alias-label-tertiary);
}

.reflib-statusText {
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.reflib-statusHint {
  max-width: 260px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-caption);
}

.reflib-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  word-break: break-word;
}

.reflib-errorIcon {
  display: inline-flex;
  flex: none;
  margin-top: 1px;
}

.reflib-spin {
  animation: reflib-spin 800ms linear infinite;
}

@keyframes reflib-spin {
  to {
    transform: rotate(360deg);
  }
}

.reflib-divider {
  height: 1px;
  margin: 2px 0;
  background: var(--dsw-alias-border-l2);
}

/* ── 管理面板 Modal（v8 优化）──
   宽度放宽到约 1/3 屏（上限 560px）；进入动画为柔和缓出（easeOutQuint 风格：
   280ms 浮起 + 淡入，位移 12px→0、scale 0.96→1），无回弹——更从容、高级感。 */
.reflib-modal {
  width: min(52vw, 720px);
  animation: reflib-pop 280ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* v12 导入流程弹窗宽度（按步骤贴近原型：会话选择 560 / 条目选择 680 / 冲突 diff 760） */
.reflib-modal.reflib-import-modal {
  width: min(40vw, 560px);
}
.reflib-modal.reflib-import-modal-mid {
  width: min(50vw, 680px);
}
.reflib-modal.reflib-import-modal-wide {
  width: min(58vw, 760px);
}

@keyframes reflib-pop {
  0% {
    opacity: 0;
    transform: scale(0.96) translateY(12px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ── 添加表单 ──
   统一表单（v8 UI 重构）：路径（可输入 / 浏览填充）+ 用途（可选）同一容器，
   同一「添加」按钮提交——用途与路径强关联，浏览不再直接添加。 */
.reflib-add {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.reflib-addLabel {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.reflib-addRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.reflib-addInputWrap {
  flex: 1 1 180px;
  min-width: 0;
}

/* 输入字体与面板一致（13px，同列表行名），placeholder 不再比整体大；
   文案已缩短保证完整显示 */
.reflib-addInputWrap > input {
  width: 100%;
  box-sizing: border-box;
  font-size: 13px;
  line-height: 18px;
}

/* 全宽「添加」主按钮 */
.reflib-addSubmit {
  flex: none;
}

/* 从会话导入：与添加按钮同排（对齐原型：输入 + 添加 + 从会话导入 一行） */
.reflib-importOpen {
  flex: none;
}

/* ── /ref-lib 命令结果卡片（conversation.chat.commandview）── */
.reflib-cmd {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.reflib-cmdHead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.reflib-cmdHeadIcon {
  flex: none;
}

.reflib-cmdName {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

/* 摘要行 = 结果首行；过长单行省略（完整结果见下方 body） */
.reflib-cmdSummary {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reflib-cmdSummary[data-error] {
  color: var(--dsw-alias-state-error-primary);
}

.reflib-cmdCopy {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.reflib-cmdCopy:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* 完整结果：默认全展开（无 max-height 截断），超宽自动换行 */
.reflib-cmdBody {
  margin: 0;
  padding: 10px 14px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-markdown-code-block-small);
  white-space: pre-wrap;
  word-break: break-word;
}

.reflib-cmdBody[data-error] {
  color: var(--dsw-alias-state-error-primary);
}

/* 窄视口：路径行换行，输入框占满一行 */
@media (max-width: 440px) {
  .reflib-addRow {
    flex-wrap: wrap;
  }

  .reflib-addInputWrap {
    flex: 1 1 100%;
  }

  .reflib-addRow > button:last-child {
    margin-left: auto;
  }
}

/* ── 跨会话导入流程（v12）──
   三步状态机弹窗：会话选择 / 条目选择（含全选三态）/ 冲突 diff。复用 reflib- 前缀，
   全部走 --dsw-* 设计令牌。冲突 diff 三栏：当前会话 vs 导入，差异字段高亮。 */
.reflib-import {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* v13：仅内容区滚动（会话/条目/diff 列表），错误条与底部操作固定 */
.reflib-importScroll {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  max-height: 52vh;
  overflow-y: auto;
}

.reflib-importList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 会话选择行 */
.reflib-importSession {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.reflib-importSession:hover {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
}
.reflib-importSession:disabled {
  opacity: 0.6;
  cursor: default;
}
.reflib-importSessionRadio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--dsw-alias-border-l2);
  flex-shrink: 0;
}
.reflib-importSessionBody {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.reflib-importSessionTitle {
  font-weight: 500;
}
.reflib-importSessionMeta {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.reflib-importSessionUnavailable {
  color: var(--dsw-alias-state-error-primary);
}

/* 全选行（三态） */
.reflib-importSelectAll {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm, 6px);
  position: sticky;
  top: 0;
  z-index: 1;
  /* 吸顶时背景需不透明（品牌 6% 混合 Modal 内容背景 bg-layer-2），否则下方条目透出 */
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.reflib-importSelectAll:hover {
  border-color: var(--dsw-alias-state-business-primary);
}
.reflib-importSelectAll:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  border-color: var(--dsw-alias-border-l1);
  background: transparent;
}
.reflib-importSelectAllLabel {
  font-weight: 500;
}
.reflib-importSelectAllSub {
  font-weight: 400;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  margin-left: 6px;
}

/* 勾选框（全选行 + 条目行共用） */
.reflib-importCheckbox {
  width: 15px;
  height: 15px;
  border-radius: 4px;
  border: 1.5px solid var(--dsw-alias-border-l2);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: var(--dsw-alias-label-primary-foreground);
}
.reflib-importCheckbox[data-state='checked'] {
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}
.reflib-importCheckbox[data-state='indet'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent);
  border-color: var(--dsw-alias-state-business-primary);
}
.reflib-importCheckbox[data-state='indet']::after {
  content: '–';
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 12px;
}

/* 条目选择行 */
.reflib-importPick {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 11px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.reflib-importPick:hover {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
}
.reflib-importPick[data-selected] {
  border-color: var(--dsw-alias-state-business-primary);
}
.reflib-importPickBody {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.reflib-importPickName {
  font-weight: 500;
}
.reflib-importPickPath {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  word-break: break-all;
}
.reflib-importPickNote {
  font-size: 12px;
  font-style: italic;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reflib-importDup {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--dsw-alias-state-warn-primary);
  border: 1px solid var(--dsw-alias-state-warn-primary);
  border-radius: 9px;
  padding: 1px 7px;
  white-space: nowrap;
}

/* 失效条目徽标（v12.1：源读取实时探测后，失效新增条目禁用勾选并红色提示） */
.reflib-importStatusBadge {
  flex-shrink: 0;
  font-size: 10px;
  border-radius: 9px;
  padding: 1px 7px;
  white-space: nowrap;
}
.reflib-importStatusBadge[data-tone='err'] {
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-state-error-primary));
  border: 1px solid var(--dsw-alias-state-error-primary, var(--dsw-alias-state-error-primary));
}

/* 冲突 diff */
.reflib-importDiffNote {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-2, transparent);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm, 6px);
  padding: 8px 12px;
}
.reflib-importConflict {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 8px);
  overflow: hidden;
}
.reflib-importConflictHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-3, transparent);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.reflib-importConflictWarn {
  color: var(--dsw-alias-state-warn-primary);
  flex-shrink: 0;
}
.reflib-importConflictPath {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reflib-importConflictCompare {
  display: grid;
  grid-template-columns: 1fr 40px 1fr;
  align-items: stretch;
}
.reflib-importSide {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  min-width: 0;
}
.reflib-importSide[data-side='mine'] {
  border-right: 1px dashed var(--dsw-alias-border-l2);
}
.reflib-importSide[data-side='incoming'] {
  border-left: 1px dashed var(--dsw-alias-border-l2);
}
.reflib-importSideTag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 1px 7px;
  border-radius: 9px;
  border: 1px solid;
  align-self: flex-start;
}
.reflib-importSide[data-side='mine'] .reflib-importSideTag {
  color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}
.reflib-importSide[data-side='incoming'] .reflib-importSideTag {
  color: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary);
}
.reflib-importSidePath {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  word-break: break-all;
}
.reflib-importSideNote {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  word-break: break-word;
}
/* diff 高亮：仅差异字段着色——mine 侧红（对应原型 .hl-mine / git diff 减号）、
   import 侧绿（对应原型 .hl-imp / git diff 加号）。 */
.reflib-importSideNote[data-diff] {
  border-radius: 3px;
}
.reflib-importSide[data-side='mine'] .reflib-importSideNote[data-diff] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
.reflib-importSide[data-side='incoming'] .reflib-importSideNote[data-diff] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
}
.reflib-importSideStatus {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.reflib-importSideStatus[data-tone='ok'] {
  color: var(--dsw-alias-state-success-primary);
}
.reflib-importSideStatus[data-tone='err'] {
  color: var(--dsw-alias-state-error-primary);
}
.reflib-importVs {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.reflib-importConflictFoot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.reflib-importPickLabel {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  margin-right: 2px;
}
.reflib-importChoice {
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 15px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.reflib-importChoice[data-active][data-tone='mine'] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}
.reflib-importChoice[data-active][data-tone='import'] {
  border-color: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
}
.reflib-importChoice:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 底部：汇总 + 操作 */
.reflib-importFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex: none;
}
.reflib-importSummary {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  flex: 1;
  min-width: 0;
}
.reflib-importActions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ── add 重复确认（v12：不再静默覆盖）──
   同路径已注册且显式 note 不同：并排展示「现有 vs 新填写」，用户选保留或更新。 */
.reflib-duplicate {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.reflib-duplicateCompare {
  display: grid;
  grid-template-columns: 1fr 34px 1fr;
  align-items: stretch;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 8px);
  overflow: hidden;
}
.reflib-duplicateSide {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  min-width: 0;
}
.reflib-duplicateSide[data-side='mine'] {
  border-right: 1px dashed var(--dsw-alias-border-l2);
}
.reflib-duplicateSide[data-side='new'] {
  border-left: 1px dashed var(--dsw-alias-border-l2);
}
.reflib-duplicateTag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 1px 7px;
  border-radius: 9px;
  border: 1px solid;
  align-self: flex-start;
}
.reflib-duplicateSide[data-side='mine'] .reflib-duplicateTag {
  color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}
.reflib-duplicateSide[data-side='new'] .reflib-duplicateTag {
  color: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary);
}
.reflib-duplicateNote {
  font-size: 12px;
  word-break: break-word;
}
.reflib-duplicateActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
`

/** 注入/确保样式表存在（幂等；HMR 重执行时旧标签已被 loader 移除，重新注入）。 */
export function ensureRefLibStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
