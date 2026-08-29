/**
 * 跨会话导入流程（v12）：从其他会话挑选参考库条目导入当前会话。
 *
 * 三步状态机（与原型 prototype-session-import.html 一致）：
 *   1. 会话选择：列出配置过参考库的其他会话（只列有参考库的，按最近活跃排序）；
 *   2. 条目选择：多选 + 「全选本会话全部条目」（三态勾选）；与当前会话重复的条目
 *      标 ⚠ 警示（按规范化绝对路径判定，classifyImport）；
 *   3. 冲突 diff：每条重复项并排对比「当前会话 vs 导入」（note / 可用状态差异
 *      高亮），用户逐条选择「保留我的」/「使用导入的」；无冲突条目直接导入。
 *
 * 语义（与 v10 fork 继承一致）：导入即**快照、不回流**——新增条目重新铸造 id、
 * note 保持源值；「使用导入的」= 以导入侧 note 替换现有条目（保留现有 id）。
 * 数据通道：/api/ref-lib/sessions（v16 懒加载：`groups=1` 组概览 + `group=<key>`
 * 按组会话）+ /list（源条目）+ /import（写入）。
 * 本组件为纯展示 + 状态机：异步操作（枚举/拉取/导入）经注入面执行，错误在
 * 流程弹窗内部展示（flowError）——导入流程是叠在面板之上的独立 Modal，
 * 写入面板错误槽会被遮住（v12.1 修复）。
 * @module @hpyperry/dsh-ref-lib/src/client/RefLibImport
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconFolderOpen16,
  IconLoadingOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ImportPlan } from '../logic.ts'
import type { RefLibEntry } from '../spec.ts'
import { classifyImport, formatRefLibError, libBasename, type ImportClassification, type RefLibImportGroup, type RefLibSourceSession } from './data.ts'

/** 导入流程的步骤。 */
type Step = 'sessions' | 'picks' | 'conflicts'

/** 冲突决策。 */
type ConflictDecision = 'mine' | 'import'

/** 组件依赖的注入面（由 RefLibDock 绑定 runtime API）。 */
export interface RefLibImportProps {
  /** 流程可见性（面板内打开）。 */
  open: boolean
  /** 关闭（取消/完成/遮罩）。 */
  onClose: () => void
  /** 当前会话条目列表（冲突检测基准）。 */
  currentLibs: readonly RefLibEntry[]
  /** 本地化取词。 */
  t: TranslateNS<'ref-lib'>
  /** 工作区组概览（v16 懒加载第一级，GET /api/ref-lib/sessions?groups=1，不读标题）。 */
  listGroups: () => Promise<RefLibImportGroup[]>
  /** 单个工作区的会话（v16 懒加载第二级，GET /api/ref-lib/sessions?group=<key>）。 */
  loadGroupSessions: (groupKey: string) => Promise<RefLibSourceSession[]>
  /** 拉取某会话的条目（GET /api/ref-lib/list?session=<id>）。 */
  loadEntries: (sessionId: SessionId) => Promise<RefLibEntry[]>
  /** 提交导入（POST /api/ref-lib/import）；失败抛错（错误在流程弹窗内展示）。 */
  onImport: (plan: ImportPlan) => Promise<void>
}

/** 相对时间（原型：更新于 10 分钟前）。 */
function timeAgo(updatedAt: number, t: RefLibImportProps['t']): string {
  const delta = Date.now() - updatedAt
  if (delta < 60_000) return t('import.time.justNow')
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return t('import.time.minutes', { n: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('import.time.hours', { n: String(hours) })
  return t('import.time.days', { n: String(Math.floor(hours / 24)) })
}

/** 源会话显示名：标题优先；无标题时显示"新会话"（v15：按工作区分组后，工作区名由
 * 组头承担，回退标题不再拼"工作区名 · "前缀；id 在会话清单中始终可见）。 */
function sessionTitle(session: RefLibSourceSession, t: RefLibImportProps['t']): string {
  if (session.title !== undefined && session.title !== '') return session.title
  return t('import.session.new')
}

/** 可用状态徽标文案。 */
function statusLabel(entry: RefLibEntry, t: RefLibImportProps['t']): { text: string; tone: 'ok' | 'err' | 'warn' | 'none' } {
  if (entry.status === undefined) return { text: '–', tone: 'none' }
  if (entry.status === 'available') return { text: t('import.status.ok'), tone: 'ok' }
  return {
    text: entry.status === 'missing' ? t('import.status.missing') : t('import.status.notDirectory'),
    tone: 'err',
  }
}

/**
 * 跨会话导入流程弹窗。
 * @param props - 见 {@link RefLibImportProps}。
 * @returns 对话框元素（关闭时 Modal 返回 null）。
 */
export function RefLibImport(props: RefLibImportProps): ReactElement {
  const { open, onClose, currentLibs, t, listGroups, loadGroupSessions, loadEntries, onImport } = props
  const [step, setStep] = useState<Step>('sessions')
  // v16 懒加载：第一级只有工作区组概览（轻量、不读标题）；展开某组才拉该组会话。
  const [groups, setGroups] = useState<RefLibImportGroup[] | null>(null)
  const [source, setSource] = useState<RefLibSourceSession | null>(null)
  const [classification, setClassification] = useState<ImportClassification | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [decisions, setDecisions] = useState<ReadonlyMap<string, ConflictDecision>>(new Map())
  const [busy, setBusy] = useState(false)
  // v16：展开/折叠状态（**默认全折叠**）+ 按组缓存与加载中集合。
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [groupSessions, setGroupSessions] = useState<ReadonlyMap<string, RefLibSourceSession[]>>(new Map())
  const [groupLoading, setGroupLoading] = useState<ReadonlySet<string>>(new Set())
  // 流程内错误（v12.1）：导入流程是叠在面板之上的独立 Modal，错误必须显示在流程
  // 内部（写入面板错误槽会被遮住）。打开/换步骤时清除。
  const [flowError, setFlowError] = useState<string | null>(null)

  // 打开时重置并拉取**组概览**（v16：不读标题；展开某组时才按需补全该组会话）。
  useEffect(() => {
    if (!open) return
    setStep('sessions')
    setGroups(null)
    setExpanded(new Set())
    setGroupSessions(new Map())
    setGroupLoading(new Set())
    setSource(null)
    setClassification(null)
    setSelected(new Set())
    setDecisions(new Map())
    setBusy(false)
    setFlowError(null)
    void (async () => {
      try {
        setGroups(await listGroups())
      } catch (cause) {
        setFlowError(formatRefLibError(cause, t))
        setGroups([])
      }
    })()
  }, [open])

  /** 选择来源会话 → 拉取条目 → 分类（默认**不勾选**，用户按需挑选或一键全选）。 */
  const selectSource = async (candidate: RefLibSourceSession): Promise<void> => {
    setBusy(true)
    try {
      const libs = await loadEntries(candidate.sessionId as SessionId)
      const result = classifyImport(currentLibs, libs)
      setSource(candidate)
      setClassification(result)
      // 默认反选起步：不预设任何选中（冲突项亦不预设决策，选了再进 diff）。
      setSelected(new Set<string>())
      setDecisions(new Map(result.conflicts.map((c) => [c.incoming.path, 'mine'] as const)))
      setStep('picks')
    } catch (cause) {
      setFlowError(formatRefLibError(cause, t))
    } finally {
      setBusy(false)
    }
  }

  /** 按组懒加载（v16 第二级）：展开时拉取该工作区的会话；失败进 flowError（可重试）。 */
  const loadGroup = async (key: string): Promise<void> => {
    setGroupLoading((prev) => new Set(prev).add(key))
    try {
      const rows = await loadGroupSessions(key)
      setGroupSessions((prev) => new Map(prev).set(key, rows))
    } catch (cause) {
      setFlowError(formatRefLibError(cause, t))
    } finally {
      setGroupLoading((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  /** 切换一个工作区组的展开/折叠（v16：默认全折叠；展开且未缓存时按组拉取）。 */
  const toggleGroup = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    // 展开且未缓存/未加载中 → 发起按组加载（闭包读当前渲染的 expanded/缓存状态）。
    if (!expanded.has(key) && !groupSessions.has(key) && !groupLoading.has(key)) {
      void loadGroup(key)
    }
  }

  /** 切换一个条目的选中态。 */
  const togglePick = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** 可选的新增条目（v12.1：失效条目禁用，不可导入）。 */
  const selectableAdditions = (): RefLibEntry[] => {
    if (classification === null) return []
    return classification.additions.filter(
      (entry) => entry.status === undefined || entry.status === 'available',
    )
  }

  /** 全选 / 取消全选（仅可选条目；失效条目恒不选）。 */
  const toggleSelectAll = (): void => {
    if (classification === null) return
    const all: string[] = [
      ...selectableAdditions().map((entry) => entry.path),
      ...classification.conflicts.map((conflict) => conflict.incoming.path),
    ]
    setSelected((prev) => (prev.size === all.length ? new Set() : new Set(all)))
  }

  /** 设置一条冲突的决策（保留我的 / 使用导入的）。 */
  const choose = (path: string, decision: ConflictDecision): void => {
    setDecisions((prev) => new Map(prev).set(path, decision))
  }

  /** 选中的冲突条数（决定是否进入 diff 步）。 */
  const selectedConflictCount = (): number => {
    if (classification === null) return 0
    return classification.conflicts.filter((c) => selected.has(c.incoming.path)).length
  }

  /** 构建导入规划（与 planImport 同语义：additions + replacements）。 */
  const buildPlan = (): ImportPlan => {
    const result = classification ?? { additions: [], conflicts: [] }
    const additions = result.additions
      .filter((entry) => selected.has(entry.path))
      .map((entry) => ({ path: entry.path, ...(entry.note === undefined ? {} : { note: entry.note }) }))
    const replacements = result.conflicts
      .filter((c) => selected.has(c.incoming.path) && decisions.get(c.incoming.path) === 'import')
      .map((c) => ({
        existingId: c.mine.id,
        ...(c.incoming.note === undefined ? {} : { note: c.incoming.note }),
      }))
    return { additions, replacements }
  }

  /** 下一步：有选中的冲突项 → diff 步；否则直接提交。 */
  const proceed = (): void => {
    if (selectedConflictCount() > 0) {
      setStep('conflicts')
      return
    }
    void confirmImport()
  }

  /** 确认导入：提交规划并关闭（成功后由父组件刷新列表）。 */
  const confirmImport = async (): Promise<void> => {
    if (classification === null) return
    const plan = buildPlan()
    if (plan.additions.length === 0 && plan.replacements.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await onImport(plan)
      onClose()
    } catch (cause) {
      setFlowError(formatRefLibError(cause, t))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 分层回退（v12.1）：取消/关闭在子页面返回上一级，仅在会话列表顶层关闭整个流程——
   * 选错会话/想对比其他会话是高频动作，整个关闭再重开丢失上下文且多两步。
   * conflicts → picks（保留选择与决策）→ sessions（清空选择）→ 关闭。
   */
  const goBack = (): void => {
    if (step === 'conflicts') {
      setStep('picks')
      return
    }
    if (step === 'picks') {
      // 返回会话列表：清空当前选择与决策（重新选源会话）。
      setSource(null)
      setClassification(null)
      setSelected(new Set())
      setDecisions(new Map())
      setFlowError(null)
      setStep('sessions')
      return
    }
    onClose()
  }

  /** Modal 关闭（✕/遮罩/Escape）与「取消」共用：逐级回退，顶层才真正关闭。 */
  const handleClose = (): void => {
    if (busy) return
    goBack()
  }

  const selectedCount = selected.size
  // 三态基准：可选条目数（失效新增条目不计入；冲突条目恒可选）。
  const allCount =
    classification === null ? 0 : selectableAdditions().length + classification.conflicts.length
  const dupCount = selectedConflictCount()
  const importCount = classification === null ? 0 : classification.conflicts
    .filter((c) => selected.has(c.incoming.path) && decisions.get(c.incoming.path) === 'import').length
  const keepMineCount = classification === null ? 0 : classification.conflicts
    .filter((c) => selected.has(c.incoming.path) && decisions.get(c.incoming.path) === 'mine').length

  const title =
    step === 'sessions'
      ? t('import.title')
      : step === 'picks'
        ? t('import.picks.title')
        : t('import.conflicts.title')

  const description =
    step === 'sessions'
      ? t('import.hint')
      : step === 'picks' && source !== null
        ? t('import.picks.source', { session: sessionTitle(source, t) })
        : t('import.conflicts.count', { count: String(dupCount) })

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      closeLabel={step === 'sessions' ? t('import.cancel') : t('import.back')}
      description={description}
      className={
        step === 'conflicts'
          ? 'reflib-modal reflib-import-modal-wide'
          : step === 'picks'
            ? 'reflib-modal reflib-import-modal-mid'
            : 'reflib-modal reflib-import-modal'
      }
    >
      <div className="reflib-import">
        {flowError !== null && (
          <div className="reflib-error" role="alert">
            <IconWarningOutline16 size={14} className="reflib-errorIcon" />
            <span>{flowError}</span>
          </div>
        )}
        <div className="reflib-importScroll">
        {step === 'sessions' && (
          <>
            {groups === null ? (
              <div className="reflib-status" role="status">
                <IconLoadingOutline16 size={20} className="reflib-spin reflib-statusIcon" />
                <span className="reflib-statusText">{t('import.sessions.loading')}</span>
              </div>
            ) : groups.length === 0 ? (
              <div className="reflib-status">
                <IconFolderOpen16 size={22} className="reflib-statusIcon" />
                <span className="reflib-statusText">{t('import.empty')}</span>
              </div>
            ) : (
              <div className="reflib-importList">
                {groups.map((group) => {
                  // v16 懒加载：组概览默认**全折叠**；展开且未缓存时按组拉取（第二级）。
                  const isExpanded = expanded.has(group.key)
                  const rows = groupSessions.get(group.key)
                  const loading = groupLoading.has(group.key)
                  const label = group.workspace ?? t('import.group.ungrouped')
                  return (
                    <section key={group.key} className="reflib-importGroup" data-collapsed={!isExpanded || undefined}>
                      <button
                        type="button"
                        className="reflib-importGroupHead"
                        disabled={busy}
                        aria-expanded={isExpanded}
                        onClick={() => {
                          toggleGroup(group.key)
                        }}
                      >
                        <span className="reflib-importGroupChevron" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                        <span className="reflib-importGroupTitle">{label}</span>
                        <span className="reflib-importGroupCount">
                          {t('import.group.count', { n: String(group.count) })}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="reflib-importGroupBody">
                          {loading ? (
                            <div className="reflib-status" role="status">
                              <IconLoadingOutline16 size={16} className="reflib-spin reflib-statusIcon" />
                              <span className="reflib-statusText">{t('import.sessions.loading')}</span>
                            </div>
                          ) : rows !== undefined && rows.length === 0 ? (
                            <div className="reflib-status">
                              <IconFolderOpen16 size={18} className="reflib-statusIcon" />
                              <span className="reflib-statusText">{t('import.empty')}</span>
                            </div>
                          ) : (
                            (rows ?? []).map((session) => {
                              const name = sessionTitle(session, t)
                              return (
                                <button
                                  key={session.sessionId}
                                  type="button"
                                  className="reflib-importSession"
                                  disabled={busy}
                                  onClick={() => {
                                    void selectSource(session)
                                  }}
                                >
                                  <span className="reflib-importSessionRadio" aria-hidden="true" />
                                  <span className="reflib-importSessionBody">
                                    <span className="reflib-importSessionTitle">{name}</span>
                                    <span className="reflib-importSessionMeta">
                                      {t('import.sessions.count', { count: String(session.count), available: String(session.available) })}
                                      {session.count - session.available > 0 && (
                                        <span className="reflib-importSessionUnavailable">
                                          {' · '}
                                          {t('import.sessions.unavailable', { count: String(session.count - session.available) })}
                                        </span>
                                      )}
                                      {' · '}
                                      {t('import.updated', { time: timeAgo(session.updatedAt, t) })}
                                      {session.workspace === undefined && session.cwd !== undefined && session.cwd !== '' && (
                                        <>
                                          {' · '}
                                          <span className="reflib-importSessionCwd">{libBasename(session.cwd)}</span>
                                        </>
                                      )}
                                    </span>
                                  </span>
                                </button>
                              )
                            })
                          )}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </>
        )}

        {step === 'picks' && classification !== null && (
          <>
            <button
              type="button"
              className="reflib-importSelectAll"
              data-active={allCount > 0 && selectedCount === allCount}
              disabled={allCount === 0}
              onClick={() => {
                toggleSelectAll()
              }}
            >
              <span
                className="reflib-importCheckbox"
                data-state={allCount === 0 || selectedCount === 0 ? 'empty' : selectedCount === allCount ? 'checked' : 'indet'}
                aria-hidden="true"
              >
                {allCount > 0 && selectedCount === allCount ? '✓' : ''}
              </span>
              <span className="reflib-importSelectAllLabel">
                {t('import.selectAll')}
                <span className="reflib-importSelectAllSub">
                  {t('import.selectAll.sub', {
                    // count = 本会话全部条目（含失效）；dup = 全部冲突数（与选中无关）。
                    count: String(
                      classification === null ? 0 : classification.additions.length + classification.conflicts.length,
                    ),
                    dup: String(classification === null ? 0 : classification.conflicts.length),
                  })}
                </span>
              </span>
            </button>
            <div className="reflib-importList">
              {classification.additions.map((entry) => {
                const path = entry.path
                // v12.1：源读取已实时探测——失效（missing/not-directory）的新增条目
                // 无法通过导入校验，禁用勾选并显示失效徽标（冲突条目不受影响：
                // replace 仅更新 note，不校验源路径）。
                const unavailable = entry.status !== undefined && entry.status !== 'available'
                const unavailableLabel = unavailable ? statusLabel(entry, t) : null
                return (
                  <button
                    key={path}
                    type="button"
                    className="reflib-importPick"
                    data-selected={selected.has(path) || undefined}
                    data-unavailable={unavailable || undefined}
                    disabled={unavailable}
                    onClick={() => {
                      togglePick(path)
                    }}
                  >
                    <span
                      className="reflib-importCheckbox"
                      data-state={unavailable ? 'empty' : selected.has(path) ? 'checked' : 'empty'}
                      aria-hidden="true"
                    >
                      {!unavailable && selected.has(path) ? '✓' : ''}
                    </span>
                    <span className="reflib-importPickBody">
                      <span className="reflib-importPickName">{libBasename(path)}</span>
                      <span className="reflib-importPickPath">{path}</span>
                      {entry.note !== undefined && entry.note !== '' && (
                        <span className="reflib-importPickNote">{entry.note.replace(/\s+/g, ' ')}</span>
                      )}
                    </span>
                    {unavailableLabel !== null && (
                      <span className="reflib-importStatusBadge" data-tone={unavailableLabel.tone}>
                        {unavailableLabel.text}
                      </span>
                    )}
                  </button>
                )
              })}
              {classification.conflicts.map((conflict) => {
                const path = conflict.incoming.path
                return (
                  <button
                    key={path}
                    type="button"
                    className="reflib-importPick"
                    data-selected={selected.has(path) || undefined}
                    onClick={() => {
                      togglePick(path)
                    }}
                  >
                    <span
                      className="reflib-importCheckbox"
                      data-state={selected.has(path) ? 'checked' : 'empty'}
                      aria-hidden="true"
                    >
                      {selected.has(path) ? '✓' : ''}
                    </span>
                    <span className="reflib-importPickBody">
                      <span className="reflib-importPickName">{libBasename(path)}</span>
                      <span className="reflib-importPickPath">{path}</span>
                    </span>
                    <span className="reflib-importDup">{t('import.dup')}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {step === 'conflicts' && classification !== null && (
          <div className="reflib-importList">
            {classification.conflicts
              .filter((conflict) => selected.has(conflict.incoming.path))
              .map((conflict) => {
                const path = conflict.incoming.path
                const decision = decisions.get(path) ?? 'mine'
                const mineStatus = statusLabel(conflict.mine, t)
                const incomingStatus = statusLabel(conflict.incoming, t)
                const reason = conflict.noteDiffers
                  ? conflict.statusDiffers
                    ? t('import.conflict.pathSame')
                    : t('import.conflict.pathSameNoteDiff')
                  : conflict.statusDiffers
                    ? t('import.conflict.pathSameStatusDiff')
                    : t('import.conflict.pathSame')
                return (
                  <div key={path} className="reflib-importConflict">
                    <div className="reflib-importConflictHead">
                      <IconWarningOutline16 size={13} className="reflib-importConflictWarn" />
                      <span>{reason}</span>
                      <span className="reflib-importConflictPath">{path}</span>
                    </div>
                    <div className="reflib-importConflictCompare">
                      <div className="reflib-importSide" data-side="mine">
                        <span className="reflib-importSideTag">{t('import.side.mine')}</span>
                        <span className="reflib-importSidePath">{conflict.mine.path}</span>
                        <span className="reflib-importSideNote" data-diff={conflict.noteDiffers || undefined}>
                          {t('import.noteLabel')}
                          {conflict.mine.note === undefined || conflict.mine.note === ''
                            ? t('import.noteEmpty')
                            : conflict.mine.note.replace(/\s+/g, ' ')}
                        </span>
                        <span className="reflib-importSideStatus" data-tone={mineStatus.tone}>
                          {t('import.statusLabel')}
                          {mineStatus.text}
                        </span>
                      </div>
                      <div className="reflib-importVs">vs</div>
                      <div className="reflib-importSide" data-side="incoming">
                        <span className="reflib-importSideTag">{t('import.side.incoming')}</span>
                        <span className="reflib-importSidePath">{conflict.incoming.path}</span>
                        <span className="reflib-importSideNote" data-diff={conflict.noteDiffers || undefined}>
                          {t('import.noteLabel')}
                          {conflict.incoming.note === undefined || conflict.incoming.note === ''
                            ? t('import.noteEmpty')
                            : conflict.incoming.note.replace(/\s+/g, ' ')}
                        </span>
                        <span className="reflib-importSideStatus" data-tone={incomingStatus.tone}>
                          {t('import.statusLabel')}
                          {incomingStatus.text}
                        </span>
                      </div>
                    </div>
                    <div className="reflib-importConflictFoot">
                      <span className="reflib-importPickLabel">{t('import.conflict.pick')}</span>
                      <button
                        type="button"
                        className="reflib-importChoice"
                        data-active={decision === 'mine' || undefined}
                        data-tone="mine"
                        disabled={busy}
                        onClick={() => {
                          choose(path, 'mine')
                        }}
                      >
                        {t('import.keepMine')}
                      </button>
                      <button
                        type="button"
                        className="reflib-importChoice"
                        data-active={decision === 'import' || undefined}
                        data-tone="import"
                        disabled={busy}
                        onClick={() => {
                          choose(path, 'import')
                        }}
                      >
                        {t('import.useIncoming')}
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        )}

        </div>
        <div className="reflib-divider" />
        <div className="reflib-importFoot">
          {step === 'picks' && (
            <span className="reflib-importSummary">
              {t('import.picks.summary', {
                sel: String(selectedCount),
                total: String(allCount),
                dup: String(dupCount),
              })}
            </span>
          )}
          {step === 'conflicts' && (
            <span className="reflib-importSummary">
              {t('import.conflicts.summary', {
                mine: String(keepMineCount),
                import: String(importCount),
                add: String(
                  classification === null ? 0 : classification.additions.filter((a) => selected.has(a.path)).length,
                ),
              })}
            </span>
          )}
          <div className="reflib-importActions">
            <Button variant="ghost" size="sm" disabled={busy} onClick={handleClose}>
              {step === 'sessions' ? t('import.cancel') : t('import.back')}
            </Button>
            {step === 'sessions' ? null : (
              <Button
                variant="primary"
                size="sm"
                disabled={busy || selectedCount === 0}
                onClick={() => {
                  if (step === 'conflicts') void confirmImport()
                  else proceed()
                }}
              >
                {step === 'conflicts'
                  ? t('import.confirm')
                  : dupCount > 0 ? t('import.proceed') : t('import.proceed.clean')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
