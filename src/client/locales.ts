/**
 * ref-lib client 本地化字典（zh 为键集唯一来源，en 与之逐键对齐）。
 *
 * 语言适配（优化点 2）：面板、入口胶囊与添加表单的全部文案经
 * `ctx.locale.register(NS, { zh, en })` 注册，槽位注册声明 `locale: NS`，
 * 组件经框架注入的 `t` seat 取词（活动语言实时切换，缺省回退 zh）。
 * 键对等由 `satisfies Record<RefLibKey, string>` 在编译期强制。
 * @module @hpyperry/dsh-ref-lib/src/client/locales
 */

/** 简体中文字典（键集唯一来源）。 */
export const zh = {
  // ── 输入框上方入口胶囊（conversation.input.dock）──
  'dock.label': '参考库',
  'dock.aria': '管理只读参考库',
  'dock.count.aria': '参考库，共 {count} 个',
  // ── 管理面板 ──
  'panel.title': '参考库',
  'panel.close': '关闭',
  'panel.description': '共 {count} 个只读参考库：供 agent 读取参考，禁止修改其中文件',
  'list.remove': '移除',
  'list.remove.aria': '移除参考库 {name}',
  'list.empty': '还没有参考库',
  'list.empty.hint': '在下方输入目录路径，或点击「选择目录」从系统选择',
  'list.loading': '正在加载…',
  // ── 添加表单 ──
  'add.label': '添加参考库',
  'add.placeholder': '输入目录路径（支持 ~ 与相对）',
  'add.submit': '添加',
  'add.manual': '或手动输入路径',
  'add.browse': '选择目录',
  'add.hint': '目录仅作只读参考；位于工作区之外时由系统强制只读',
  // ── 应用内目录浏览器（browse 后端）──
  'browser.title': '选择目录',
  'browser.home': '主目录',
  'browser.open': '选择此目录',
  'browser.open.aria': '添加当前目录为参考库',
  'browser.enter.aria': '进入目录 {name}',
  'browser.editPath': '编辑路径',
  'browser.pathPlaceholder': '输入绝对路径，回车跳转',
  'browser.empty': '该目录下没有子目录',
  'browser.loading': '加载中…',
  'browser.cancel': '取消',
  // ── 错误映射（wire code → 本地化文案）──
  'error.missing': '目录不存在：{path}',
  'error.notDirectory': '不是目录：{path}',
  'error.unsafe': '路径包含控制字符，已拒绝：{path}',
  'error.unknownId': '未找到参考库条目：{id}',
} satisfies Record<string, string>

/** ref-lib 命名空间的键集。 */
export type RefLibKey = keyof typeof zh

/** 英文词典，与 zh 键集逐键对齐（编译期校验）。 */
export const en = {
  'dock.label': 'Reference Library',
  'dock.aria': 'Manage read-only reference libraries',
  'dock.count.aria': 'Reference library, {count} total',
  'panel.title': 'Reference Library',
  'panel.close': 'Close',
  'panel.description':
    '{count} read-only reference libraries: the agent may read them for reference, but must not modify any files',
  'list.remove': 'Remove',
  'list.remove.aria': 'Remove reference library {name}',
  'list.empty': 'No reference libraries yet',
  'list.empty.hint': 'Enter a directory path below, or click “Choose directory” to pick one',
  'list.loading': 'Loading…',
  'add.label': 'Add a reference library',
  'add.placeholder': 'Enter a directory path (~ or relative)',
  'add.submit': 'Add',
  'add.manual': 'or enter a path manually',
  'add.browse': 'Choose directory',
  'add.hint': 'Directories are read-only references; outside the workspace they are enforced read-only by the system',
  // ── In-app directory browser (browse backend) ──
  'browser.title': 'Select Directory',
  'browser.home': 'Home',
  'browser.open': 'Select this folder',
  'browser.open.aria': 'Add the current directory as a reference library',
  'browser.enter.aria': 'Open folder {name}',
  'browser.editPath': 'Edit path',
  'browser.pathPlaceholder': 'Type an absolute path and press Enter',
  'browser.empty': 'No subdirectories here',
  'browser.loading': 'Loading…',
  'browser.cancel': 'Cancel',
  'error.missing': 'Directory does not exist: {path}',
  'error.notDirectory': 'Not a directory: {path}',
  'error.unsafe': 'Path contains control characters and was rejected: {path}',
  'error.unknownId': 'Reference library entry not found: {id}',
} satisfies Record<RefLibKey, string>
