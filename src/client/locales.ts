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
  'dock.unavailable': '参考库，{count} 个失效',
  // ── 条目可用性（失效检测，v9）──
  'status.missing': '目录已删除或不可访问',
  'status.notDirectory': '路径不再是目录',
  // ── 管理面板 ──
  'panel.title': '参考库',
  'panel.close': '关闭',
  'panel.description': '共 {count} 个只读参考库：供 agent 读取参考，禁止修改其中文件',
  'list.remove': '移除',
  'list.remove.aria': '移除参考库 {name}',
  'list.empty': '还没有参考库',
  'list.empty.hint': '在下方输入目录路径，或点击「浏览」选择目录',
  'list.loading': '正在加载…',
  // ── 条目详情 ──
  'detail.open': '查看详情',
  'detail.open.aria': '查看 {name} 的详情',
  'detail.path': '路径',
  'detail.cancel': '取消',
  'detail.save': '保存',
  // ── 添加表单 ──
  'add.label': '添加参考库',
  'add.placeholder': '输入目录路径（支持 ~ 与相对）',
  'add.submit': '添加',
  'add.browse': '浏览',
  'add.note.label': '用途说明',
  'add.note.placeholder': '用途说明（可选，帮助 agent 判断相关性）',
  'add.hint': '目录仅作只读参考；用途不填时自动提取 README 标题',
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
  'error.unavailable': '参考库目录不可用（仅允许移除）',
} satisfies Record<string, string>

/** ref-lib 命名空间的键集。 */
export type RefLibKey = keyof typeof zh

/** 英文词典，与 zh 键集逐键对齐（编译期校验）。 */
export const en = {
  'dock.label': 'Reference Library',
  'dock.aria': 'Manage read-only reference libraries',
  'dock.count.aria': 'Reference library, {count} total',
  'dock.unavailable': 'Reference library, {count} unavailable',
  // ── Entry availability (stale detection, v9) ──
  'status.missing': 'Directory deleted or unavailable',
  'status.notDirectory': 'Path is no longer a directory',
  'panel.title': 'Reference Library',
  'panel.close': 'Close',
  'panel.description':
    '{count} read-only reference libraries: the agent may read them for reference, but must not modify any files',
  'list.remove': 'Remove',
  'list.remove.aria': 'Remove reference library {name}',
  'list.empty': 'No reference libraries yet',
  'list.empty.hint': 'Enter a directory path below, or click “Browse” to pick one',
  'list.loading': 'Loading…',
  // ── Entry details ──
  'detail.open': 'View details',
  'detail.open.aria': 'View details of {name}',
  'detail.path': 'Path',
  'detail.cancel': 'Cancel',
  'detail.save': 'Save',
  'add.label': 'Add a reference library',
  'add.placeholder': 'Enter a directory path (~ or relative)',
  'add.submit': 'Add',
  'add.browse': 'Browse',
  'add.note.label': 'Description',
  'add.note.placeholder': 'Description (optional; helps the agent judge relevance)',
  'add.hint': 'Directories are read-only references; if no description is given, the README title is used',
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
  'error.unavailable': 'Reference library directory unavailable (remove only)',
} satisfies Record<RefLibKey, string>
