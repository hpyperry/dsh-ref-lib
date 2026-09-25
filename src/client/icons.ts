/**
 * 本插件用到的图标出口：**跨 dsh 版本取值**（取值逻辑见 `./glyph.ts`）。
 *
 * 组件请从这里 import 图标，**不要**直接从 `@deepseek-ai/dsh-client-ui-primitives`
 * 取 `Icon*`——直接取会把插件钉死在一代宿主上（0.1.7 起旧名 `Icon*16` 已删除，
 * 取到 `undefined` 会白屏）。其余 primitives（`Button` / `Modal` / `Input` …）
 * 跨版本完全兼容，继续直接从 ui-primitives 取。
 *
 * @module @hpyperry/dsh-ref-lib/src/client/icons
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { pickGlyph, type GlyphTable } from './glyph.ts'

export type { GlyphProps } from './glyph.ts'

const table = primitives as unknown as GlyphTable

/** 绑定到宿主图标表的取值（每个字形在模块加载时解析一次）。 */
function glyph(base: string): ReturnType<typeof pickGlyph> {
  return pickGlyph(table, base)
}

export const IconFolderOpen = glyph('IconFolderOpen')
export const IconFolderClose = glyph('IconFolderClose')
export const IconChevronRightOutline = glyph('IconChevronRightOutline')
export const IconEditOutline = glyph('IconEditOutline')
export const IconLoadingOutline = glyph('IconLoadingOutline')
export const IconWarningOutline = glyph('IconWarningOutline')
export const IconEllipsisOutline = glyph('IconEllipsisOutline')
export const IconPlusOutline = glyph('IconPlusOutline')
export const IconRefreshOutline = glyph('IconRefreshOutline')
export const IconSearchOutline = glyph('IconSearchOutline')
export const IconTrashOutline = glyph('IconTrashOutline')
export const IconCheckOutline = glyph('IconCheckOutline')
export const IconCopyOutline = glyph('IconCopyOutline')
