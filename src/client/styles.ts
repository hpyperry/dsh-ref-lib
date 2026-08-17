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

/* 列表：固定最大高度 + 内滚动（旧实现整个面板滚动、无设计，此处分层） */
.reflib-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 264px;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -8px;
  padding: 0 8px;
}

.reflib-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 8px;
  border-radius: 10px;
  background: transparent;
  transition: background-color 120ms ease;
}

.reflib-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.reflib-row[data-removing='true'] {
  opacity: 0.55;
  pointer-events: none;
}

.reflib-rowIcon {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
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

/* ── 添加表单 ──
   两组操作分离（优化点 2.1）：手动输入路径 + 「添加」是一组（主路径）；
   「选择目录」是另一组备选方式，独占一行，避免并排造成困惑。 */
.reflib-add {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.reflib-addLabel {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

/* 主方式：选择目录 —— 全宽主按钮（优先级最高） */
.reflib-addBrowseMain {
  width: 100%;
}

/* 备选：手动输入路径组 */
.reflib-addManual {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.reflib-addManualLabel {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
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

.reflib-addHint {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
}

/* 窄视口：主路径行换行，输入框占满一行 */
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
