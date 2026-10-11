/**
 * 图标取值的**纯逻辑**（零依赖，便于 L0 单测）。
 *
 * 为什么需要它：dsh 从 **0.1.7-alpha.1** 起把 `ui-primitives` 的共享图标由
 * `Icon<Glyph><Size>`（`IconFolderOpen16`）改为 `Icon<Glyph><Weight>`
 * （`IconFolderOpenRegular` / `…Medium`），且**两代名字不共存**——0.1.6-alpha.2
 * 及以前只有旧名，0.1.7-alpha.1 起只有新名。
 *
 * 图标是宿主 seed 模块表里的 **value import**：运行时按名取值，所以只要在取值处
 * 做一次回退，**同一份 client bundle 就能同时在两代宿主上正确渲染**——这是"一份
 * 插件版本支持多代宿主"的关键（取值处见 `icons.ts`，理由见 `AGENTS.md` 的「硬约束」第 2 条）。
 *
 * 本模块刻意不 import 任何东西（`ComponentType` 是 type-only，构建期擦除），
 * 使单测不必加载真实的 ui-primitives 包。
 *
 * @module @hpyperry/dsh-ref-lib/src/client/glyph
 */
import type { ComponentType } from 'react'

/** 图标组件在我们这里用到的 props（`size` 缺省即该字形自带的绘制尺寸）。 */
export interface GlyphProps {
  readonly size?: number
  readonly className?: string
}

/** 图标表：宿主 ui-primitives 的模块命名空间（测试里可用普通对象替身）。 */
export type GlyphTable = Record<string, ComponentType<GlyphProps> | undefined>

/**
 * 按字形基名取图标：优先新版 `…Regular`，回退旧版 `…16` / `…14`。
 * @param table - 图标表（生产的 `import * as primitives`，或测试替身）。
 * @param base - 不含字重/尺寸后缀的导出基名，如 `'IconFolderOpen'`。
 * @returns 该字形的 Regular 权重组件（1px 描边，等价于旧 `*16` / `*14` 的视觉）。
 * @throws 两代名字都找不到时抛错——宁可启动即报错，也不要渲染 `undefined` 白屏。
 */
export function pickGlyph(table: GlyphTable, base: string): ComponentType<GlyphProps> {
  const component = table[`${base}Regular`] ?? table[`${base}16`] ?? table[`${base}14`]
  if (component === undefined) {
    throw new Error(`ref-lib: 宿主 ui-primitives 缺少图标 ${base}（两代名字都没有）`)
  }
  return component
}
