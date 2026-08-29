/**
 * 参考库管理面板（Modal）：列表（卡片：名称/状态/路径/用途 + ⋯ 操作菜单）+ 添加表单。
 *
 * 设计（v16 UI 打磨，GPT 评审稿落地）：资源管理界面而非"填写目录"表单——
 * - 头部：标题 + 静态副标题（Agent 可以使用的本地参考项目），计数下沉为列表头；
 * - 卡片：一行 = 图标 + 名称 + 状态徽标 + ⋯；二行 = 完整路径；三行 = 用途说明；
 *   删除等破坏性操作收进 ⋯ 菜单（danger 样式），不再直接暴露垃圾桶；
 * - 添加区：路径输入（浏览内嵌）+ 用途说明（标签/提示提升权重）+ 底行
 *   「从会话导入」（ghost，次要）+「添加参考库」（primary，主操作）；
 * - 列表独立滚动（最大高度），Dialog 高度受控、内容不足不产生大空白。
 * 全部样式走 "--dsw-*" 设计令牌（随浅/深主题适配）；文案经 `t` 本地化（zh/en）。
 * 本组件为纯展示：异步操作与错误归集由 RefLibDock 持有。
 * @module @hpyperry/dsh-ref-lib/src/client/RefLibPanel
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderOpen16,
  IconLoadingOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
  Menu,
  Modal,
  type MenuEntry,
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
  /** 任一异步操作（添加/移除/重扫）进行中：禁用全部操作。 */
  busy: boolean
  /** 系统目录选择器已打开（禁用添加表单，防重复唤起）。 */
  picking: boolean
  /** 正在移除的条目 id（该行降透明度）。 */
  removingId: string | null
  /** 已本地化的错误文案（null 表示无错误）。 */
  error: string | null
  /** 本地化取词。 */
  t: TranslateNS<'ref-lib'>
  /** 移除一个条目（父组件执行异步并刷新）。 */
  onRemove: (id: string) => void
  /** 重新扫描：重拉列表（node 侧实时探测目录可用性）；失败入错误槽。 */
  onRescan: () => void
  /** 按输入路径添加（可带用途说明 note）；失败时抛出（面板保留输入内容）。 */
  onAddPath: (path: string, note?: string) => Promise<void>
  /** 更新条目的用途说明（详情编辑保存）；失败入错误槽、不抛出。 */
  onUpdateNote: (id: string, note: string) => Promise<void>
  /** 唤起目录选择（browse/native），返回选中路径或 null（取消）——由面板填入路径字段，不直接添加。 */
  onBrowse: () => Promise<string | null>
  /** 打开跨会话导入流程（v12：从其他会话挑选参考库条目）。 */
  onImportOpen: () => void
}

/**
 * 渲染参考库管理面板。
 * @param props - 见 {@link RefLibPanelProps}。
 * @returns 对话框元素（关闭时 Modal 返回 null）。
 */
export function RefLibPanel(props: RefLibPanelProps): ReactElement {
  const { open, onClose, libs, loading, busy, picking, removingId, error, t, onRemove, onRescan, onAddPath, onUpdateNote, onBrowse, onImportOpen } = props
  const [draft, setDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  // 详情展开：正在查看/编辑的条目 id + 编辑中的用途草稿。
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')
  // ⋯ 操作菜单：当前打开的条目 id（null = 全部关闭）。
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  // 面板关闭时清空输入草稿：每次打开都是干净的添加表单（失败保留输入的行为只限于面板打开期间）。
  useEffect(() => {
    if (!open) {
      setDraft('')
      setNoteDraft('')
      setDetailId(null)
      setMenuOpenId(null)
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

  /** 展开/收起条目详情（⋯ 菜单「编辑」入口）；展开时载入当前用途草稿。 */
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

  /** 卡片 ⋯ 菜单项（失效条目禁用「编辑」——只允许移除/重扫；node 端 note 接口同样拒绝）。 */
  const entryMenuItems = (entry: RefLibEntry): MenuEntry[] => {
    const unavailable = entry.status !== undefined && entry.status !== 'available'
    const locked = busy || removingId !== null
    return [
      { id: 'edit', label: t('menu.edit'), icon: <IconEditOutline16 size={14} />, disabled: locked || unavailable },
      { id: 'rescan', label: t('menu.rescan'), icon: <IconRefreshOutline16 size={14} />, disabled: locked },
      { type: 'separator', id: 'sep-remove' },
      { id: 'remove', label: t('menu.remove'), icon: <IconTrashOutline16 size={14} />, danger: true, disabled: locked },
    ]
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('panel.title')}
      closeLabel={t('panel.close')}
      description={t('panel.subtitle')}
      className="reflib-modal"
    >
      <div className="reflib-panel">
        {error !== null && (
          <div className="reflib-error" role="alert">
            <IconWarningOutline16 size={14} className="reflib-errorIcon" />
            <span>{error}</span>
          </div>
        )}
        {/* 红绿灯状态行：绿点可用数 / 红点失效数（仅存在时显示）——计数一目了然 */}
        {!loading && libs.length > 0 && (
          <div className="reflib-statusline" role="status">
            <span className="reflib-statuslineItem">
              <span className="reflib-statuslineDot" data-tone="ok" />
              {t('panel.available', { count: String(libs.filter((entry) => entry.status === 'available').length) })}
            </span>
            {libs.some((entry) => entry.status !== undefined && entry.status !== 'available') && (
              <span className="reflib-statuslineItem">
                <span className="reflib-statuslineDot" data-tone="err" />
                {t('panel.unavailable', {
                  count: String(libs.filter((entry) => entry.status !== undefined && entry.status !== 'available').length),
                })}
              </span>
            )}
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
          <>
            <div className="reflib-list">
              {libs.map((entry) => {
                const name = libBasename(entry.path)
                const removing = removingId === entry.id
                const detailOpen = detailId === entry.id
                const unavailable = entry.status !== undefined && entry.status !== 'available'
                return (
                  <div
                    key={entry.id}
                    className="reflib-listItem"
                    data-removing={removing || undefined}
                    data-status={unavailable ? entry.status : undefined}
                  >
                    <div className="reflib-row">
                      {unavailable
                        ? <IconWarningOutline16 size={16} className="reflib-rowIcon reflib-rowIconWarn" />
                        : <IconFolderOpen16 size={16} className="reflib-rowIcon" />}
                      <div className="reflib-rowBody">
                        <div className="reflib-rowLine1">
                          <span className="reflib-rowName" title={entry.path}>
                            {name}
                          </span>
                          <span
                            className="reflib-rowStatus"
                            data-tone={unavailable ? 'err' : 'ok'}
                            role="status"
                            title={unavailable ? t(entry.status === 'missing' ? 'status.missing' : 'status.notDirectory') : undefined}
                          >
                            {unavailable ? t('status.badge') : t('status.available')}
                          </span>
                        </div>
                        <span className="reflib-rowPath" title={entry.path}>
                          {entry.path}
                        </span>
                        {entry.note !== undefined && entry.note !== '' && (
                          <span className="reflib-rowNote" title={entry.note}>
                            {entry.note.replace(/\s+/g, ' ')}
                          </span>
                        )}
                      </div>
                      {/* ⋯ 操作菜单：编辑 / 重新扫描 / 删除（danger）——破坏性操作不直接暴露 */}
                      <Menu
                        open={menuOpenId === entry.id}
                        anchor={(
                          <button
                            type="button"
                            className="reflib-rowAction"
                            aria-label={t('menu.aria', { name })}
                            aria-expanded={menuOpenId === entry.id || undefined}
                            disabled={busy || removingId !== null}
                            onClick={() => {
                              setMenuOpenId(menuOpenId === entry.id ? null : entry.id)
                            }}
                          >
                            <IconEllipsisOutline16 size={14} />
                          </button>
                        )}
                        items={entryMenuItems(entry)}
                        onSelect={(id) => {
                          setMenuOpenId(null)
                          if (id === 'edit') toggleDetail(entry)
                          else if (id === 'rescan') onRescan()
                          else if (id === 'remove') onRemove(entry.id)
                        }}
                        onClose={() => {
                          setMenuOpenId(null)
                        }}
                        align="end"
                        side="bottom"
                        portal
                        dense
                      />
                    </div>
                    {/* 失效条目不渲染详情/用途编辑区（只允许移除/重扫） */}
                    {detailOpen && !unavailable && (
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
          </>
        )}
        <div className="reflib-divider" />
        {/* 添加参考库：区段标题 + 字段化表单（路径组 / 用途）+ 底行主次操作 */}
        <div className="reflib-add">
          <span className="reflib-addLabel">{t('add.label')}</span>
          <span className="reflib-addFieldLabel">{t('add.path.label')}</span>
          {/* 路径输入组：浏览内嵌于输入控件右端，不再是大按钮 */}
          <div className="reflib-addPathGroup">
            <Input
              className="reflib-addPathInput"
              value={draft}
              placeholder={t('add.placeholder')}
              aria-label={t('add.path.label')}
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
            <button
              type="button"
              className="reflib-addBrowse"
              disabled={busy || picking}
              onClick={() => {
                void handleBrowse()
              }}
            >
              <IconSearchOutline16 size={13} />
              {t('add.browse')}
            </button>
          </div>
          <span className="reflib-addFieldLabel">
            {t('add.note.label')}
            <span className="reflib-addOptional">{t('add.note.optional')}</span>
          </span>
          <span className="reflib-addHint">{t('add.note.hint')}</span>
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
          <div className="reflib-addFoot">
            {/* 从会话导入：次要（ghost）；添加参考库：主操作（primary） */}
            <Button
              variant="ghost"
              size="sm"
              icon={<IconFolderOpen16 size={14} />}
              disabled={busy || picking}
              onClick={onImportOpen}
            >
              {t('import.open')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<IconPlusOutline16 size={14} />}
              disabled={busy || picking || draft.trim() === ''}
              onClick={() => {
                void handleSubmit()
              }}
            >
              {t('add.submit')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
