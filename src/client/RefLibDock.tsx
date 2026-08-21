/**
 * 参考库入口（conversation.input.dock，输入卡正上方）+ 面板状态持有者。
 *
 * 位置（v7）：v5/v6 曾在 hero 相位把胶囊**测量定位**提入官方 hero 行（紧跟"标准
 * 模式"chip 之后）。该像素测量与 hero 行的异步内容存在竞态——模式 chip 的 roster
 * 经 RPC 异步挂载、Web 字体异步加载、其他插件 chip 异步加入——而重测触发面
 * （hero 行/槽位出口/栈均为固定盒或 display:contents）对"行内内容变化"是盲区，
 * 导致偶发与模式按钮重叠。v7 起**取消测量与绝对定位**：胶囊统一渲染在 dock 槽位
 * （输入卡正上方）的独立一行，左缘经官方设计令牌（--dsh-composer-side-clearance /
 * --dsh-composer-card-max-width）纯 CSS 与输入卡左缘对齐——hero/active 一致、
 * 零 JS 测量、零竞态；plan/model 等工具行座位的启停不影响本行位置；与其他 dock
 * 条带（todo/goal/queue）按 order 流式堆叠，天然不重叠。
 *
 * 数据（v4/v5）：读/写经 /api/ref-lib/* 路由（静默、无命令卡片）；
 * 目录选择走系统原生选择器，另提供路径输入直加（绕开卡顿的原生对话框）。
 * @module @hpyperry/dsh-ref-lib/src/client/RefLibDock
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryListing, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RefLibEntry } from '../spec.ts'
import { RefLibApiError } from './data.ts'
import type { RefLibKey } from './locales.ts'
import { RefreshGuard } from './refresh-guard.ts'
import { RefLibBrowser } from './RefLibBrowser.tsx'
import { RefLibPanel } from './RefLibPanel.tsx'
import { ensureRefLibStyles } from './styles.ts'

/** 面板组件依赖的注入面（apply 闭包绑定 runtime 能力）。 */
export interface RefLibDockInjected {
  /** 读取会话的参考库列表（GET /api/ref-lib/list，静默）。 */
  load: (sessionId: SessionId) => Promise<RefLibEntry[]>
  /** 添加一个参考库目录（POST /api/ref-lib/add，静默；note 为可选用途说明）。 */
  add: (sessionId: SessionId, path: string, note?: string) => Promise<void>
  /** 移除一个参考库条目（POST /api/ref-lib/remove，静默）。 */
  remove: (sessionId: SessionId, id: string) => Promise<void>
  /** 更新一个条目的用途说明（POST /api/ref-lib/note，静默；空串清除）。 */
  setNote: (sessionId: SessionId, id: string, note: string) => Promise<void>
  /** 唤起系统原生"选择文件夹"对话框；取消时返回 null。 */
  pickDirectory: () => Promise<string | null>
  /** 列出一层目录（browse 后端）；缺省路径 = 宿主主目录；signal 中止扫描。 */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
}

/** 挂载预载失败重试：间隔与上限（重启后会话 live 通常 <1s，重试 1–2 次即成功）。 */
const MOUNT_RETRY_DELAY_MS = 800
const MOUNT_RETRY_MAX = 5

/** 可见期轮询间隔：外部变更（删除/恢复目录）自动反向同步到 UI。 */
const POLL_INTERVAL_MS = 30_000

/** 完整 props：input.dock 运行时套件 + 注入面 + 本地化 seat。 */
export type RefLibDockProps = PropsRuntime<'conversation.input.dock'> & RefLibDockInjected & PropsLocale<'ref-lib'>

/** wire 错误码 → 本地化文案键（未知码回退原始消息）。 */
const ERROR_KEYS: Record<string, RefLibKey> = {
  'ref-lib/missing': 'error.missing',
  'ref-lib/not-directory': 'error.notDirectory',
  'ref-lib/unsafe': 'error.unsafe',
  'ref-lib/unknown-id': 'error.unknownId',
  'ref-lib/unavailable': 'error.unavailable',
}

/** 把未知错误规整为可展示文案。 */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 把 API 错误本地化：已知 wire code 映射为当前语言文案（带 path/id 参数），
 * 其余错误原样展示服务端消息。
 */
function formatError(cause: unknown, t: RefLibDockProps['t']): string {
  if (cause instanceof RefLibApiError) {
    const key = ERROR_KEYS[cause.code]
    if (key !== undefined) {
      const params =
        cause.details.path !== undefined
          ? { path: cause.details.path }
          : cause.details.id !== undefined
            ? { id: cause.details.id }
            : undefined
      return t(key, params)
    }
  }
  return messageOf(cause)
}

// 模块装载即注入样式（幂等）；组件挂载后再兜底一次（覆盖装载早于 DOM 的情况）。
ensureRefLibStyles()

/**
 * 输入卡正上方的参考库入口：胶囊按钮（图标 + 文案 + 数量徽标）唤起管理面板。
 * 位置由 .reflib-dock 的纯 CSS padding 与输入卡左缘对齐，无任何 JS 测量。
 * @param props - sessionId 与注入面。
 * @returns 胶囊入口（+ 打开时的管理面板）。
 */
export function RefLibDock(props: RefLibDockProps): ReactElement {
  const { sessionId, session, load, add, remove, setNote, pickDirectory, listDirectory, t } = props
  const [open, setOpen] = useState(false)
  const [libs, setLibs] = useState<RefLibEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 并发读守卫（竞态控制）：仅采纳最新一次 refresh 的结果（挂载预载/开面板/轮询/
  // 操作后刷新可能重叠）；详见 src/client/refresh-guard.ts 与 tests/refresh-guard.spec.ts。
  const guard = useRef(new RefreshGuard())

  // 目录选择能力（v6）：browse（应用内浏览器，listDirectory）或 native（OS 对话框，
  // pickDirectory）。探测一次并缓存；host 侧能力在单次 boot 内稳定。
  const [pickerMode, setPickerMode] = useState<'browse' | 'native' | null>(null)
  const [browserOpen, setBrowserOpen] = useState(false)
  // pickPath 等待应用内浏览器选定时挂起的 resolve（取消以 null 结束）。
  const pendingPick = useRef<((path: string | null) => void) | null>(null)
  const detectPicker = async (): Promise<'browse' | 'native'> => {
    if (pickerMode !== null) return pickerMode
    let mode: 'browse' | 'native'
    try {
      await listDirectory(undefined, new AbortController().signal)
      mode = 'browse'
    } catch {
      // browse 不可用（directory-picker-unavailable）→ 回退 native 尝试；
      // pickDirectory 若也不可用，由错误槽如实展示。
      mode = 'native'
    }
    setPickerMode(mode)
    return mode
  }

  /**
   * 拉取会话参考库列表并更新 UI。
   * @param silent - 静默模式（轮询用）：失败不写入错误槽；成功也**不碰 error/loading**
   * ——错误与加载态只由用户操作/打开面板管理，避免后台轮询吞掉操作错误提示或
   * 提前结束面板加载态（轮询仅更新 libs 数据）。
   */
  const refresh = async (silent = false): Promise<void> => {
    const mine = guard.current.begin()
    try {
      const next = await load(sessionId)
      if (!guard.current.isLatest(mine)) return
      setLibs(next)
      if (!silent) setError(null)
    } catch (cause) {
      if (!guard.current.isLatest(mine)) return
      if (!silent) setError(formatError(cause, t))
    } finally {
      if (guard.current.isLatest(mine) && !silent) setLoading(false)
    }
  }

  // 挂载/会话切换预载（带失败重试）：重启 dsh web 后会话可能尚未 live（/list 404），
  // 首次加载失败若直接放弃，胶囊角标/列表会缺失直到用户点开面板——延迟重试直至
  // 会话就绪或达到上限，让"刚启动"的失效角标也能自动出现（seq 守卫防并发竞态）。
  useEffect(() => {
    ensureRefLibStyles()
    let stopped = false
    let retries = 0
    let timer: number | undefined
    const attempt = async (): Promise<void> => {
      const mine = guard.current.begin()
      try {
        const next = await load(sessionId)
        if (stopped || !guard.current.isLatest(mine)) return
        setLibs(next)
        setError(null)
      } catch (cause) {
        if (stopped || !guard.current.isLatest(mine)) return
        if (retries < MOUNT_RETRY_MAX) {
          retries += 1
          timer = window.setTimeout(() => { void attempt() }, MOUNT_RETRY_DELAY_MS)
          return
        }
        setError(formatError(cause, t))
      } finally {
        if (!stopped && guard.current.isLatest(mine)) setLoading(false)
      }
    }
    void attempt()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [sessionId])
  useEffect(() => {
    if (open) {
      setLoading(true)
      void refresh()
    }
  }, [open])

  // 发消息即刷新（交互钩子）：dock owner 的 `session` 是**响应式会话快照**——用户
  // 发消息必然产生 user 消息节点（`kind: 'user'`），计数 +1 触发静默刷新，UI 在
  // 发消息后立即同步（不必等 30s 轮询）；流式 assistant 回复不改变 user 计数，
  // 不会每 token 刷新。外部文件操作仍由下方 30s 轮询兜底。
  const userMessageCount = session.nodes.filter((node) => node.kind === 'user').length
  useEffect(() => {
    void refresh(true)
  }, [userMessageCount])

  // 可见期轮询（v9 遗留 §14 方案 1）：挂载期间每 30s 静默刷新一次——外部删除/
  // 恢复目录后，胶囊失效角标与面板列表自动反向同步，无需手动刷新。负载：每会话
  // 每 30s 一次 GET /list（node 端内存缓存 + N 次 statSync，毫秒级；状态变化才写盘），
  // 多开会话线性叠加，可忽略。
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(true) }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [sessionId])

  const handleRemove = async (id: string): Promise<void> => {
    setRemovingId(id)
    setBusy(true)
    setError(null)
    try {
      await remove(sessionId, id)
      await refresh()
    } catch (cause) {
      setError(formatError(cause, t))
    } finally {
      setRemovingId(null)
      setBusy(false)
    }
  }

  const handleAddPath = async (path: string, note?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await add(sessionId, path, note)
      await refresh()
    } catch (cause) {
      setError(formatError(cause, t))
      // 失败时重新抛出：让面板保留输入内容供修正
      throw cause
    } finally {
      setBusy(false)
    }
  }

  /** 更新条目用途说明（编辑详情保存）；失败入错误槽、不抛出（编辑区保持打开）。 */
  const handleUpdateNote = async (id: string, note: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await setNote(sessionId, id, note)
      await refresh()
    } catch (cause) {
      setError(formatError(cause, t))
    } finally {
      setBusy(false)
    }
  }

  /** 唤起目录选择（browse 应用内浏览器 / native 系统对话框）并返回选中的路径；
   * 取消或失败返回 null——**不直接添加**，由面板把路径填入表单（用户可补用途后提交）。 */
  const pickPath = async (): Promise<string | null> => {
    setError(null)
    // 探测目录选择能力：browse → 应用内目录浏览器；native → 系统 OS 对话框。
    let mode: 'browse' | 'native'
    try {
      mode = await detectPicker()
    } catch (cause) {
      setError(formatError(cause, t))
      return null
    }
    if (mode === 'browse') {
      setBrowserOpen(true)
      return await new Promise<string | null>((resolve) => {
        pendingPick.current = resolve
      })
    }
    setPicking(true)
    try {
      return await pickDirectory()
    } catch (cause) {
      setError(formatError(cause, t))
      return null
    } finally {
      setPicking(false)
    }
  }

  /** 应用内浏览器选定目录 → 把路径交给等待中的 pickPath 调用方并关闭浏览器。 */
  const handleBrowserPick = (path: string): void => {
    setBrowserOpen(false)
    const resolve = pendingPick.current
    pendingPick.current = null
    resolve?.(path)
  }

  /** 应用内浏览器取消 → 以 null 结束等待中的 pickPath。 */
  const handleBrowserClose = (): void => {
    setBrowserOpen(false)
    const resolve = pendingPick.current
    pendingPick.current = null
    resolve?.(null)
  }

  /**
   * 胶囊计数（v9）：徽标显示**可用**数量（失效不计入），红色角标显示失效数量
   * （总数 − 可用数），仅存在失效条目时显示。注意：UI 数据只在打开面板/操作后
   * 刷新，外部变更（如删除目录）不会自动反向同步到界面（与命令修改后不刷新同属
   * 待解决的 UI 数据同步问题，见设计文档"遗留备注"）。
   */
  const availableCount = libs.filter((entry) => entry.status === 'available').length
  const unavailableCount = libs.length - availableCount

  return (
    <>
      <div className="reflib-dock">
        <button
          type="button"
          className="reflib-chip"
          data-active={open || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            unavailableCount > 0
              ? t('dock.unavailable', { count: String(unavailableCount) })
              : availableCount > 0 ? t('dock.count.aria', { count: String(availableCount) }) : t('dock.aria')
          }
          title={t('dock.aria')}
          onClick={() => {
            setOpen((value) => !value)
          }}
        >
          <span className="reflib-chipIcon">
            <IconFolderOpen16 size={14} />
          </span>
          <span className="reflib-chipLabel">{t('dock.label')}</span>
          {availableCount > 0 && <span className="reflib-chipBadge">{availableCount}</span>}
          {unavailableCount > 0 && (
            <span className="reflib-chipWarn" title={t('dock.unavailable', { count: String(unavailableCount) })}>
              {unavailableCount}
            </span>
          )}
        </button>
      </div>
      <RefLibPanel
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        libs={libs}
        loading={loading}
        busy={busy}
        picking={picking}
        removingId={removingId}
        error={error}
        t={t}
        onRemove={(id) => {
          void handleRemove(id)
        }}
        onAddPath={handleAddPath}
        onUpdateNote={handleUpdateNote}
        onBrowse={pickPath}
      />
      <RefLibBrowser
        open={browserOpen}
        onClose={handleBrowserClose}
        listDirectory={listDirectory}
        t={t}
        onOpen={handleBrowserPick}
      />
    </>
  )
}
