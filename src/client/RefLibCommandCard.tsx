/**
 * `/ref-lib` 命令结果专属卡片（conversation.chat.commandview，key='ref-lib'）。
 *
 * 背景（历史 bug）：官方 `GenericCommandCard` 对命令结果折叠态 `white-space:
 * nowrap` + `text-overflow: ellipsis` 单行截断，展开态 `max-height: 260px` 内滚动
 * ——`/ref-lib list` 等多行长结果会显示不全。本卡片注册在
 * `conversation.chat.commandview`（keyed，按命令名分派）的 `ref-lib` 键上：
 * **默认全展开展示完整结果**（无高度上限）+ 一键复制按钮。只影响 `/ref-lib`，
 * 其他命令仍走官方卡片。
 * @module @hpyperry/dsh-ref-lib/src/client/RefLibCommandCard
 */

import { useState } from 'react'
import type { ReactElement } from 'react'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16,
  IconCopyOutline16,
  IconLoadingOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ensureRefLibStyles } from './styles.ts'

/** 完整 props：commandview 运行时套件 + owner（node）+ 本地化 seat。 */
export type RefLibCommandCardProps = PropsRuntime<'conversation.chat.commandview'> & {
  /** 折叠的命令生命周期节点（run + 可选 done）；outcome 为 null 时仍在执行。 */
  node: CommandNode
  /** `/compact` 专用（ref-lib 不使用）。 */
  compaction?: unknown
} & PropsLocale<'ref-lib'>

ensureRefLibStyles()

/**
 * `/ref-lib` 命令结果卡片：完整展示 `outcome.text`（pre-wrap、无高度截断）+
 * 复制按钮。running 态显示执行中；error 态红色。
 * @param props - node（owner）与本地化 seat。
 * @returns 卡片元素。
 */
export function RefLibCommandCard(props: RefLibCommandCardProps): ReactElement {
  const { node, t } = props
  const [copied, setCopied] = useState(false)
  const outcome = node.outcome
  const text = outcome?.text
  const running = outcome === null
  const error = outcome?.kind === 'error'

  /** 复制完整结果到剪贴板；成功后短暂显示"已复制"（权限失败静默）。 */
  const copy = async (): Promise<void> => {
    if (text === undefined || text === '') return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1500)
    } catch {
      /* 剪贴板不可用（权限/非安全上下文）时静默 */
    }
  }

  const summary = running
    ? t('command.running')
    : text !== undefined && text !== '' ? text.split('\n')[0]! : t('command.done')

  return (
    <div className="reflib-cmd" data-state={running ? 'running' : error ? 'error' : 'ok'}>
      <div className="reflib-cmdHead">
        {running && <IconLoadingOutline16 size={14} className="reflib-spin reflib-cmdHeadIcon" />}
        {!running && error && <IconWarningOutline16 size={14} className="reflib-cmdHeadIcon" />}
        <span className="reflib-cmdName">/ref-lib</span>
        <span className="reflib-cmdSummary" data-error={error || undefined}>{summary}</span>
        {!running && text !== undefined && text !== '' && (
          <button
            type="button"
            className="reflib-cmdCopy"
            aria-label={t('command.copy')}
            title={t('command.copy')}
            onClick={() => { void copy() }}
          >
            {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
            {copied ? t('command.copied') : t('command.copy')}
          </button>
        )}
      </div>
      {!running && text !== undefined && text !== '' && (
        <pre className="reflib-cmdBody" data-error={error || undefined}>{text}</pre>
      )}
    </div>
  )
}
