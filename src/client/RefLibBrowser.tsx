/**
 * 应用内目录浏览器（browse 后端可用时，「选择目录」的落地实现）。
 *
 * 为什么需要它：v6 起 profile 把 directory-picker 从 -auto（本机解析为 native，
 * OS 对话框硬编码英文且每次拉 osascript 进程）切换为 -browse 后，
 * `host.pickDirectory`（native 专用 RPC）不再可用；本组件用 `listDirectory`
 * （Node stdlib 列目录，zh/en 本地化、无 OS 进程）提供等价的目录选择：
 * 面包屑 + 路径编辑 + 子目录列表，点击下行进入，「选择此目录」把当前层级添加为
 * 参考库。简化为单列（与官方 DirectoryBrowser 的 Miller 双列相比），
 * 但覆盖添加参考库的核心路径。
 * @module @hpyperry/dsh-ref-lib/src/client/RefLibBrowser
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconLoadingOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** 面板组件依赖的注入面（由 RefLibDock 提供）。 */
export interface RefLibBrowserProps {
  /** 对话框可见性。 */
  open: boolean
  /** 关闭（Escape / 遮罩 / 取消）。 */
  onClose: () => void
  /** 列出一层目录（缺省路径 = 宿主主目录）；signal 中止被取代的扫描。 */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** 本地化取词。 */
  t: TranslateNS<'ref-lib'>
  /** 选定当前层级目录（父组件负责添加并刷新）。 */
  onOpen: (path: string) => void
}

/** 面包屑展示：主目录子树内以本地化 Home 开头；之外显示完整祖先链。 */
function displayCrumbs(listing: DirectoryListing, homeLabel: string): DirectoryEntry[] {
  const homeIndex = listing.crumbs.findIndex((crumb) => crumb.path === listing.home)
  if (homeIndex === -1) return listing.crumbs
  const tail = listing.crumbs.slice(homeIndex + 1)
  return [{ name: homeLabel, path: listing.home, hidden: false }, ...tail]
}

/** 平台分隔符（由宿主主目录推断，绝不从键入文本推断）。 */
function separatorOf(listing: DirectoryListing): '\\' | '/' {
  return listing.home.includes('\\') ? '\\' : '/'
}

/**
 * 渲染应用内目录浏览器。
 * @param props - 见 {@link RefLibBrowserProps}。
 * @returns 对话框元素（关闭时 Modal 返回 null）。
 */
export function RefLibBrowser(props: RefLibBrowserProps): ReactElement {
  const { open, onClose, listDirectory, t, onOpen } = props
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 路径编辑：null = 面包屑模式；字符串 = 正在键入的草稿。
  const [pathDraft, setPathDraft] = useState<string | null>(null)
  const seq = useRef(0)
  const controller = useRef<AbortController | null>(null)
  // IME 确认（Enter 选中候选）不得提交路径。
  const composing = useRef(false)

  /** 新意图胜出：中止在途扫描并使旧结果失效。 */
  const navigate = (target?: string): void => {
    controller.current?.abort()
    controller.current = null
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    const ctrl = new AbortController()
    controller.current = ctrl
    listDirectory(target, ctrl.signal).then(
      (next) => {
        if (mine !== seq.current) return
        setListing(next)
        setLoading(false)
      },
      (cause: unknown) => {
        if (mine !== seq.current) return
        setLoading(false)
        setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
  }

  // 打开时列主目录；关闭时清理在途扫描。
  useEffect(() => {
    if (open) {
      navigate()
    } else {
      seq.current += 1
      controller.current?.abort()
      controller.current = null
      setPathDraft(null)
      setError(null)
    }
  }, [open])

  const openPathEditor = (): void => {
    if (listing === null) {
      setPathDraft('')
      return
    }
    const sep = separatorOf(listing)
    const base = listing.path
    setPathDraft(base.endsWith(sep) ? base : base + sep)
  }

  const commitPath = (): void => {
    const draft = pathDraft ?? ''
    if (draft.trim() === '') return
    navigate(draft)
    setPathDraft(null)
  }

  const crumbs = listing === null ? [] : displayCrumbs(listing, t('browser.home'))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('browser.title')}
      closeLabel={t('browser.cancel')}
      className="reflib-browser"
    >
      <div className="reflib-panel">
        {error !== null && (
          <div className="reflib-error" role="alert">
            <IconWarningOutline16 size={14} className="reflib-errorIcon" />
            <span>{error}</span>
          </div>
        )}
        {/* 路径条：面包屑 + 编辑路径入口 */}
        <div className="reflib-browserPath">
          {pathDraft === null ? (
            <>
              <span className="reflib-browserCrumbs" role="navigation">
                {crumbs.map((crumb, index) => (
                  <span key={crumb.path} className="reflib-browserCrumb">
                    {index > 0 && <IconChevronRightOutline14 size={12} className="reflib-browserCrumbChevron" />}
                    <button
                      type="button"
                      className="reflib-browserCrumbBtn"
                      disabled={loading}
                      onClick={() => {
                        navigate(crumb.path)
                      }}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </span>
              <button
                type="button"
                className="reflib-browserEdit"
                aria-label={t('browser.editPath')}
                title={t('browser.editPath')}
                disabled={loading}
                onClick={openPathEditor}
              >
                <IconEditOutline16 size={14} />
              </button>
            </>
          ) : (
            <input
              className="reflib-browserInput"
              value={pathDraft}
              aria-label={t('browser.editPath')}
              placeholder={t('browser.pathPlaceholder')}
              autoFocus
              disabled={loading}
              onChange={(event) => {
                setPathDraft(event.currentTarget.value)
              }}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !composing.current) {
                  event.preventDefault()
                  commitPath()
                }
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setPathDraft(null)
                }
              }}
            />
          )}
        </div>
        {/* 目录列表 */}
        {loading ? (
          <div className="reflib-status" role="status">
            <IconLoadingOutline16 size={20} className="reflib-spin reflib-statusIcon" />
            <span className="reflib-statusText">{t('browser.loading')}</span>
          </div>
        ) : listing !== null && listing.entries.length === 0 ? (
          <div className="reflib-status">
            <IconFolderOpen16 size={22} className="reflib-statusIcon" />
            <span className="reflib-statusText">{t('browser.empty')}</span>
          </div>
        ) : (
          listing !== null && (
            <div className="reflib-browserList">
              {listing.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="reflib-browserRow"
                  aria-label={t('browser.enter.aria', { name: entry.name })}
                  disabled={loading}
                  onClick={() => {
                    navigate(entry.path)
                  }}
                >
                  <IconFolderClose16 size={16} className="reflib-browserRowIcon" />
                  <span className="reflib-browserRowName">{entry.name}</span>
                </button>
              ))}
            </div>
          )
        )}
        <div className="reflib-divider" />
        {/* 底部操作 */}
        <div className="reflib-browserFooter">
          <Button variant="outline" size="sm" disabled={loading} onClick={onClose}>
            {t('browser.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={loading || listing === null}
            aria-label={t('browser.open.aria')}
            onClick={() => {
              if (listing !== null) onOpen(listing.path)
            }}
          >
            {t('browser.open')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
