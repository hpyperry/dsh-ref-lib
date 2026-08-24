/**
 * systemPrompt 注入文本的纯渲染函数。
 *
 * 注入模板为**v15 提醒式英文版**（2026-08-24 收敛：挂载即识别 + 库清单 + 规范使用
 * 提醒，不诱导必查）。动态部分仅参考库列表（序号 + basename + id + Path +
 * Description），其余规则文本为静态常量。
 * @module @hpyperry/dsh-ref-lib/src/render
 */

import { basename } from 'node:path'
import type { RefLibEntry } from './spec.ts'
import { sanitizeControlCharacters } from './validate.ts'

/**
 * 渲染 `/ref-lib list` 的人类可读输出；失效条目带状态标记。
 * @param libs - 已注册的只读参考库。
 * @returns 列表文本；无库时提示为空。
 */
export function renderLibList(libs: readonly RefLibEntry[]): string {
  if (libs.length === 0) return '当前没有已注册的只读参考库。使用 /ref-lib add <path> 添加。'
  return libs
    .map((entry) => {
      const note = entry.note === undefined || entry.note === '' ? '' : `（${sanitizeControlCharacters(entry.note)}）`
      const status = entry.status === 'missing'
        ? ' [已失效]'
        : entry.status === 'not-directory' ? ' [不是目录]' : ''
      return `- ${entry.id}: ${sanitizeControlCharacters(entry.path)}${status}${note}`
    })
    .join('\n')
}

/**
 * 渲染 `/ref-lib import <会话>` 的源会话条目清单（无路径参数时列出，供用户挑选路径）。
 * @param source - 源会话 id。
 * @param libs - 源会话条目（readSessionLibs 已实时探测）。
 * @returns 清单文本；无库时提示。
 */
export function renderImportSource(source: string, libs: readonly RefLibEntry[]): string {
  if (libs.length === 0) return `会话 ${source} 没有参考库。`
  const lines = libs
    .map((entry) => {
      const note = entry.note === undefined || entry.note === '' ? '' : `（${sanitizeControlCharacters(entry.note)}）`
      const status = entry.status === 'missing'
        ? ' [已失效]'
        : entry.status === 'not-directory' ? ' [不是目录]' : ' [可用]'
      return `- ${sanitizeControlCharacters(entry.path)}${status}${note}`
    })
    .join('\n')
  return `会话 ${source} 的参考库（${libs.length} 个）：\n${lines}\n用 /ref-lib import ${source} <路径> 导入指定条目（与当前重复的自动跳过）。`
}

/**
 * 渲染 `/ref-lib import`（无参）的会话清单：id + 标题 + 条目数——让会话 id 可发现，
 * 用户据此用 `/ref-lib import <id> [路径...]` 继续。
 * @param sessions - 有参考库的源会话清单（listSessions 结果）。
 * @returns 清单文本。
 */
export function renderImportSessions(sessions: readonly { sessionId: string; title?: string; cwd?: string; count: number }[]): string {
  if (sessions.length === 0) return '其他会话还没有参考库。'
  const lines = sessions
    .map((session) => {
      // 无标题会话：与 UI 一致的「工作区名 · 新会话」回退（cwd 也缺则只显示"新会话"）。
      const label =
        session.title !== undefined && session.title !== ''
          ? session.title
          : session.cwd !== undefined && session.cwd !== ''
            ? `${basename(session.cwd)} · 新会话`
            : '新会话'
      return `- ${session.sessionId} 「${sanitizeControlCharacters(label)}」（${session.count} 个条目）`
    })
    .join('\n')
  return `配置过参考库的会话：\n${lines}\n用 /ref-lib import <上面的会话id或标题> [路径...] 查看并导入。`
}

/* ------------------------------------------------------------------ */
/* v15：瘦身政策 + 命中库清单（方案 B：路径告知 + 工具化查证）          */
/* ------------------------------------------------------------------ */

/** v15 政策模板（提醒式——2026-08-24 实测收敛：告知路径 + 规范使用提醒，不强制必查）。 */
const REF_LIB_TEMPLATE_V15 = `[Read-only Reference Libraries]

The following reference libraries are registered for this session. They are
local, strictly read-only, and authoritative for project facts (code, APIs,
standards, internal docs).

Reference libraries:

{LIB}

[Usage Guidance]

Prefer reference library information over model memory for project facts.
When you need specific details (exact signatures, code locations, file
contents), locate them in the libraries above — via the reference_lookup tool
or by reading the library files directly. Use English identifiers and
technical terms as query terms (matching is literal). Follow the standards and
conventions found in these libraries when implementing features. Reference
libraries are strictly read-only.`

/** 一条命中库的 v15 渲染（序号 + basename + id + Path + Description）。 */
function renderLibraryV15(entry: RefLibEntry, index: number): string {
  const path = sanitizeControlCharacters(entry.path)
  const lines = [
    `${index + 1}. ${sanitizeControlCharacters(basename(path))} (id: ${entry.id})`,
    `   Path: ${path}`,
  ]
  const note = entry.note?.trim()
  if (note !== undefined && note !== '') {
    const flat = note.replace(/\s+/g, ' ')
    lines.push(`   Description: ${sanitizeControlCharacters(flat)}`)
  }
  return lines.join('\n')
}

/** v15 注入渲染：可用挂载库 → 提醒式政策 + 库清单（每库一行，含 id 供工具限定）。
 * 挂载即识别：无可用库返回空串（未挂载 → 零注入）。
 * @param hits - 可用挂载条目（调用方已 filterAvailable）。
 * @returns 注入文本；无可用库时为空串。
 */
export function renderRefLibsV15(hits: readonly RefLibEntry[]): string {
  if (hits.length === 0) return ''
  const libraries = hits.map(renderLibraryV15).join('\n\n')
  return REF_LIB_TEMPLATE_V15.replace('{LIB}', libraries)
}
