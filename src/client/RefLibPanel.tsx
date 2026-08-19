/**
 * 参考库管理面板（Modal）：列表（基名 + 全路径、移除操作）+ 添加表单。
 *
 * 设计（优化点 1/2）：全部样式走 “--dsw-*” 设计令牌（随浅/深主题适配），
 * 列表行以「基名为主行、完整路径为次行」呈现，移除为带危险 hover 的图标按钮，
 * 添加为主按钮 + 路径输入（支持直接粘贴路径，绕开卡顿的系统选择器）+ 系统选择器
 * 兜底；空态/加载态/错误态各有独立视觉。文案全部经 `t` 本地化（zh/en）。
 * 本组件为纯展示：异步操作与错误归集由 RefLibDock 持有。
 * @module @hpyperry/dsh-ref-lib/src/client/RefLibPanel
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconEllipsisOutline16,
  IconFolderOpen16,
  IconLoadingOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RefLibEntry } from '../spec.ts'
import { libBasename } from './data.ts'

/** 用途说明最大长度（与 node half service.NOTE_MAX_LENGTH 一致）。 */
const NOTE_MAX_LENGTH = 120

/** 面板组件依赖的注入面（由 RefLibDock 提供）。 */
export interface RefLibPanelProps {
  /** 对话框可见性。 */
  open: boolean
  /** 关闭（Escape / 遮罩 / 关闭按钮）。 */
  onClose: () => void
  /** 当前参考库列表。 */
  libs: readonly RefLibEntry[]
  /** 初次加载中（列表区显示加载态）。 */
  loading: boolean
  /** 任一异步操作（添加/移除）进行中：禁用全部操作。 */
  busy: boolean
  /** 系统目录选择器已打开（禁用添加表单，防重复唤起）。 */
  picking: boolean
  /** 正在移除的条目 id（该行显示行内 spinner）。 */
  removingId: string | null
  /** 已本地化的错误文案（null 表示无错误）。 */
  error: string | null
  /** 本地化取词。 */
  t: TranslateNS<'ref-lib'>
  /** 移除一个条目（父组件执行异步并刷新）。 */
  onRemove: (id: string) => void
  /** 按输入路径添加（可带用途说明 note）；失败时抛出（面板保留输入内容）。 */
  onAddPath: (path: string, note?: string) => Promise<void>
  /** 更新条目的用途说明（详情编辑保存）；失败入错误槽、不抛出。 */
  onUpdateNote: (id: string, note: string) => Promise<void>
  /** 唤起目录选择（browse/native），返回选中路径或 null（取消）——由面板填入路径字段，不直接添加。 */
  onBrowse: () => Promise<string | null>
}

/**
 * 渲染参考库管理面板。
 * @param props - 见 {@link RefLibPanelProps}。
 * @returns 对话框元素（关闭时 Modal 返回 null）。
 */
export function RefLibPanel(props: RefLibPanelProps): ReactElement {
  const { open, onClose, libs, loading, busy, picking, removingId, error, t, onRemove, onAddPath, onUpdateNote, onBrowse } = props
  const [draft, setDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  // 详情展开：正在查看/编辑的条目 id + 编辑中的用途草稿。
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')

  // 面板关闭时清空输入草稿：每次打开都是干净的添加表单（失败保留输入的行为只限于面板打开期间）。
  useEffect(() => {
    if (!open) {
      setDraft('')
      setNoteDraft('')
      setDetailId(null)
    }
  }, [open])

  const handleSubmit = async (): Promise<void> => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    try {
      const note = noteDraft.trim()
      await onAddPath(trimmed, note === '' ? undefined : note)
      setDraft('')
      setNoteDraft('')
    } catch {
      /* 错误由父组件在统一错误槽展示；输入保留以便修正 */
    }
  }

  /** 浏览选中目录 → 填入路径字段（不直接添加，用户可补用途后提交）。 */
  const handleBrowse = async (): Promise<void> => {
    const path = await onBrowse()
    if (path !== null) setDraft(path)
  }

  /** 展开/收起条目详情；展开时载入当前用途草稿。 */
  const toggleDetail = (entry: RefLibEntry): void => {
    if (detailId === entry.id) {
      setDetailId(null)
      return
    }
    setDetailId(entry.id)
    setEditNote(entry.note ?? '')
  }

  /** 保存详情编辑的用途说明；成功后收起详情。 */
  const handleSaveNote = async (): Promise<void> => {
    if (detailId === null) return
    await onUpdateNote(detailId, editNote)
    setDetailId(null)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('panel.title')}
      closeLabel={t('panel.close')}
      description={t('panel.description', { count: String(libs.length) })}
      className="reflib-modal"
    >
      <div className="reflib-panel">
        {error !== null && (
          <div className="reflib-error" role="alert">
            <IconWarningOutline16 size={14} className="reflib-errorIcon" />
            <span>{error}</span>
          </div>
        )}
        {loading ? (
          <div className="reflib-status" role="status">
            <IconLoadingOutline16 size={20} className="reflib-spin reflib-statusIcon" />
            <span className="reflib-statusText">{t('list.loading')}</span>
          </div>
        ) : libs.length === 0 ? (
          <div className="reflib-status">
            <IconFolderOpen16 size={22} className="reflib-statusIcon" />
            <span className="reflib-statusText">{t('list.empty')}</span>
            <span className="reflib-statusHint">{t('list.empty.hint')}</span>
          </div>
        ) : (
          <div className="reflib-list">
            {libs.map((entry) => {
              const name = libBasename(entry.path)
              const removing = removingId === entry.id
              const detailOpen = detailId === entry.id
              return (
                <div key={entry.id} className="reflib-listItem" data-removing={removing || undefined}>
                  <div className="reflib-row">
                    <IconFolderOpen16 size={16} className="reflib-rowIcon" />
                    <div className="reflib-rowBody">
                      <span className="reflib-rowName" title={entry.path}>
                        {name}
                      </span>
                      <span className="reflib-rowPath" title={entry.path}>
                        {entry.path}
                      </span>
                      {entry.note !== undefined && entry.note !== '' && (
                        <span className="reflib-rowNote" title={entry.note}>
                          {entry.note.replace(/\s+/g, ' ')}
                        </span>
                      )}
                    </div>
                    <Tooltip label={t('detail.open')} side="top" delayMs={400}>
                      <button
                        type="button"
                        className="reflib-rowAction"
                        aria-label={t('detail.open.aria', { name })}
                        aria-expanded={detailOpen || undefined}
                        disabled={busy || removingId !== null}
                        onClick={() => {
                          toggleDetail(entry)
                        }}
                      >
                        <IconEllipsisOutline16 size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip label={t('list.remove')} side="top" delayMs={400}>
                      <button
                        type="button"
                        className="reflib-rowRemove"
                        aria-label={t('list.remove.aria', { name })}
                        disabled={busy || removingId !== null}
                        onClick={() => {
                          onRemove(entry.id)
                        }}
                      >
                        {removing ? (
                          <IconLoadingOutline16 size={14} className="reflib-spin" />
                        ) : (
                          <IconTrashOutline16 size={14} />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                  {detailOpen && (
                    <div className="reflib-detail">
                      <div className="reflib-detailMeta">
                        <span className="reflib-detailKey">ID</span>
                        <span className="reflib-detailValue">{entry.id}</span>
                      </div>
                      <div className="reflib-detailMeta">
                        <span className="reflib-detailKey">{t('detail.path')}</span>
                        <span className="reflib-detailValue" title={entry.path}>
                          {entry.path}
                        </span>
                      </div>
                      <span className="reflib-detailKey">{t('add.note.label')}</span>
                      <div className="reflib-noteWrap">
                        <textarea
                          className="reflib-noteTextarea"
                          value={editNote}
                          placeholder={t('add.note.placeholder')}
                          aria-label={t('add.note.label')}
                          disabled={busy}
                          rows={3}
                          maxLength={NOTE_MAX_LENGTH}
                          onChange={(event) => {
                            setEditNote(event.currentTarget.value)
                          }}
                        />
                        <span className="reflib-noteCount">
                          {editNote.length}/{NOTE_MAX_LENGTH}
                        </span>
                      </div>
                      <div className="reflib-detailActions">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setDetailId(null)
                          }}
                        >
                          {t('detail.cancel')}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            void handleSaveNote()
                          }}
                        >
                          {t('detail.save')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="reflib-divider" />
        <div className="reflib-add">
          <span className="reflib-addLabel">{t('add.label')}</span>
          {/* 统一表单：路径（可输入 / 浏览填充）+ 用途（可选），同一「添加」提交 */}
          <div className="reflib-addRow">
            <Input
              className="reflib-addInputWrap"
              value={draft}
              placeholder={t('add.placeholder')}
              aria-label={t('add.label')}
              disabled={busy || picking}
              onChange={(event) => {
                setDraft(event.currentTarget.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleSubmit()
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              icon={<IconSearchOutline16 size={14} />}
              disabled={busy || picking}
              onClick={() => {
                void handleBrowse()
              }}
            >
              {t('add.browse')}
            </Button>
          </div>
          <div className="reflib-noteWrap">
            <textarea
              className="reflib-noteTextarea"
              value={noteDraft}
              placeholder={t('add.note.placeholder')}
              aria-label={t('add.note.label')}
              disabled={busy || picking}
              rows={2}
              maxLength={NOTE_MAX_LENGTH}
              onChange={(event) => {
                setNoteDraft(event.currentTarget.value)
              }}
            />
            <span className="reflib-noteCount">
              {noteDraft.length}/{NOTE_MAX_LENGTH}
            </span>
          </div>
          <Button
            variant="primary"
            className="reflib-addSubmit"
            icon={<IconPlusOutline16 size={14} />}
            disabled={busy || picking || draft.trim() === ''}
            onClick={() => {
              void handleSubmit()
            }}
          >
            {t('add.submit')}
          </Button>
          <span className="reflib-addHint">{t('add.hint')}</span>
        </div>
      </div>
    </Modal>
  )
}
