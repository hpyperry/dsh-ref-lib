/**
 * systemPrompt 注入文本的纯渲染函数。
 *
 * 注入模板为**定稿英文版**（2026-08 优化：MUST/ALWAYS 强制语义 + note 作为
 * routing metadata + 只读约束细化）。动态部分仅参考库列表（序号 + basename +
 * Path + Description），其余规则文本为静态常量。
 * @module @hpyperry/dsh-ref-lib/src/render
 */

import { basename } from 'node:path'
import { filterAvailable, groupSourcesByWorkspace } from './logic.ts'
import type { RefLibEntry } from './spec.ts'
import { sanitizeControlCharacters } from './validate.ts'

/** 一条参考库的注入渲染（`1. <basename>\n   Path: <path>\n   Description: <note>`）。 */
function renderLibrary(entry: RefLibEntry, index: number): string {
  const path = sanitizeControlCharacters(entry.path)
  const lines = [`${index + 1}. ${sanitizeControlCharacters(basename(path))}`, `   Path: ${path}`]
  const note = entry.note?.trim()
  if (note !== undefined && note !== '') {
    // 注入模板的 Description 是单行：多行 note 折叠为空格（存储保留换行，展示与注入单行化）。
    const flat = note.replace(/\s+/g, ' ')
    lines.push(`   Description: ${sanitizeControlCharacters(flat)}`)
  }
  return lines.join('\n')
}

/** 参考库规则模板（定稿英文版）：静态部分，仅 Reference libraries 列表动态。 */
const REF_LIB_TEMPLATE = `[Read-only Reference Libraries]

The following local directories are registered as reference libraries.

Each library has a path and a description. The description is routing
metadata that explains the library's scope and helps determine whether
the library is relevant to the current task.

Reference libraries:

{LIBS}

[Reference Library Selection]

Before answering or acting on any project-specific question:

1. Use the library descriptions to determine which reference libraries
   are potentially relevant.

2. Search relevant reference libraries FIRST, before:
   - web search
   - third-party sources
   - model memory

3. Do NOT search unrelated reference libraries unless the relevant
   library does not contain sufficient information.

4. A library description is routing metadata only. It is NOT authoritative
   evidence about the contents or behavior of the project. Verify factual
   claims by reading the actual files in the library.

[Reference Library Search]

For each relevant library:

1. Read its root README, index, or documented entry point first.
2. Locate only the files needed to answer the question.
3. Read the minimum necessary content.
4. NEVER recursively scan or dump the entire library.

If the library has no README or index, inspect its root directory to find
an appropriate entry point.

[Authority]

Information found in a relevant reference library is authoritative for
project-specific facts and takes precedence over model memory and general
knowledge.

If multiple reference libraries contain conflicting information:

1. Prefer the library most directly relevant to the question.
2. Prefer explicit source code or documentation over inference.
3. If the conflict cannot be resolved, explicitly report the conflict.
4. NEVER silently guess or merge conflicting information.

[External Sources]

If the relevant reference libraries do not contain sufficient information,
external sources MAY be used.

When external sources are used, explicitly state:

"Not in reference library; external source used."

Do NOT use external sources merely to verify or supplement information
already established by the reference libraries.

[Read-only Constraint]

Reference libraries are strictly read-only.

NEVER create, modify, delete, rename, move, or overwrite files or directories
inside a reference library.

If changes are required:

1. Copy the relevant files into the current workspace.
2. Make changes only in the copied files.
3. Keep the original reference library unchanged.`

/**
 * 渲染参考库清单与规则声明。先过滤失效条目（`filterAvailable`）：失效目录读了也
 * 白读，且避免误导模型访问不存在的路径。过滤后为空（无库/全部失效）返回空串，
 * 不占用模型上下文 token。
 * @param libs - 已注册的只读参考库（含失效）。
 * @returns 注入到系统提示的文本；无可注入库时为空串。
 */
export function renderRefLibs(libs: readonly RefLibEntry[]): string {
  const available = filterAvailable(libs)
  if (available.length === 0) return ''
  const libraries = available.map(renderLibrary).join('\n\n')
  return REF_LIB_TEMPLATE.replace('{LIBS}', libraries)
}

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
 * 渲染 `/ref-lib import`（无参）的会话清单：按注册工作区分组（v15），组内 id +
 * 标题 + 条目数——让会话 id 可发现，用户据此用 `/ref-lib import <id> [路径...]` 继续。
 * 组顺序 = 组内最近活跃会话降序；未归属工作区的会话归入「未分组」兜底组（行内附
 * cwd 基名辅助识别）。无标题会话显示"新会话"（v15：分组后不再拼"工作区名 · "前缀）。
 * @param sessions - 有参考库的源会话清单（listSessions 结果，含 workspace 补全）。
 * @returns 清单文本。
 */
export function renderImportSessions(sessions: readonly { sessionId: string; title?: string; cwd?: string; workspace?: string; count: number }[]): string {
  if (sessions.length === 0) return '其他会话还没有参考库。'
  const blocks = groupSourcesByWorkspace(sessions).map((group) => {
    const head = group.workspace === undefined ? '未分组' : `工作区 ${group.workspace}`
    const lines = group.sessions
      .map((session) => {
        // 无标题会话：统一显示"新会话"（v15 去"工作区名 · "前缀；未分组行附 cwd 基名）。
        const label = session.title !== undefined && session.title !== ''
          ? session.title
          : '新会话'
        const cwdHint = group.workspace === undefined && session.cwd !== undefined && session.cwd !== ''
          ? ` · ${basename(session.cwd)}`
          : ''
        return `- ${session.sessionId} 「${sanitizeControlCharacters(label)}」（${session.count} 个条目${cwdHint}）`
      })
      .join('\n')
    return `${head}：\n${lines}`
  })
  return `配置过参考库的会话：\n${blocks.join('\n')}\n用 /ref-lib import <上面的会话id或标题> [路径...] 查看并导入。`
}
