export const SUPPORTED_LOCALES = ['en', 'zh-CN'];
export function normalizeLocale(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (/^zh(?:[-_]|$)/i.test(value)) return 'zh-CN';
  if (/^en(?:[-_]|$)/i.test(value)) return 'en';
  return '';
}
export function resolveLocale({ setting = 'auto', hostLocale = '', configLocale = '', navigatorLocale = '' } = {}) {
  if (setting === 'en' || setting === 'zh-CN') return setting;
  for (const value of [hostLocale, configLocale, navigatorLocale]) {
    const locale = normalizeLocale(value);
    if (locale) return locale;
    if (typeof value === 'string' && value.trim()) return 'en';
  }
  return 'en';
}
const translations = {
  '设置': 'Settings', '界面语言': 'Language', '自动': 'Auto', '返回': 'Back', '总览': 'Overview', '列表': 'List', '刷新': 'Refresh',
  '选择项目': 'Select project', '默认项目': 'Default project', '页内搜索': 'Find in page', '页内搜索 (⌘F / Ctrl+F)': 'Find in page (⌘F / Ctrl+F)',
  '页内搜索…': 'Find in page…', '页内搜索关键词': 'Find in page', '清空关键词': 'Clear search', '仅匹配': 'Matches only', '仅显示包含匹配项的任务卡片': 'Only show matching task cards', '上一处': 'Previous match', '下一处': 'Next match', '上一处 (Shift+Enter)': 'Previous match (Shift+Enter)', '下一处 (Enter)': 'Next match (Enter)', '关闭页内搜索': 'Close find', '关闭页内搜索 (Esc)': 'Close find (Esc)',
  '项目任务总览': 'Project task overview', '搜索 ID / 标题 / 标签…': 'Search ID / title / label…', '清除搜索': 'Clear search', '搜索': 'Search', '全部': 'All', '加载中…': 'Loading…', '逐条查看 ▶': 'Review step by step ▶',
  '暂无匹配的 Beads 任务': 'No matching Beads tasks', '当前筛选条件下无匹配任务': 'No tasks match the current filter', '没有匹配的任务': 'No matching tasks', '已看': 'Viewed', '上一条': 'Previous', '下一条': 'Next', '已到队尾 · 返回列表': 'End of queue · Back to list',
  '点击复制 Bead ID': 'Copy Bead ID', '点击复制 Task ID': 'Copy Task ID', '点击复制 ID': 'Copy ID', '复制 ID': 'Copy ID', '已复制': 'Copied', '已复制 ID': 'Copied ID', '复制失败，请手动选中复制': 'Copy failed; please select and copy manually',
  '(无标题)': '(Untitled)', '任务列表': 'Tasks', '本轮任务': 'Current tasks', '打开单卡': 'Open task', '展开完整详情': 'Expand full details', '在卡片内看完整详情': 'View full details in card', '附到对话': 'Attach to conversation', '清除上下文': 'Clear context', '发到当前对话': 'Send to current conversation', '新开会话': 'New conversation', '新开会话处理': 'Handle in new conversation', '操作成功': 'Completed',
  '搜索 / 直达 Beads ID': 'Search / open Beads ID', '输入 Beads ID 直达，或关键词搜索…': 'Enter a Beads ID or search keywords…', '打开/搜索': 'Open / Search', '搜列表': 'Search list', '关闭搜索': 'Close search', '请输入 ID 或关键词': 'Enter an ID or keywords', '未找到精确 ID，已按关键词搜索列表': 'Exact ID not found; searched the list instead',
  '移除标签': 'Remove label', '新增标签…': 'Add label…', '+ 标签': '+ Label', '状态与备注': 'Status and notes', '状态更新': 'Update status', '更新': 'Update', '优先级': 'Priority', '应用': 'Apply', '可选：关闭或重开原因 (--reason)…': 'Optional: reason for closing or reopening (--reason)…', '追加备注 (bd note / --append-notes)': 'Append note (bd note / --append-notes)', '输入备注内容…': 'Enter a note…', '追加 Note': 'Append note', '备注内容不能为空': 'Note cannot be empty', '已追加备注': 'Note added',
  '补充说明 / 驳回意见…': 'Additional notes / rejection reason…', '带说明发送': 'Send with note', '发送': 'Send', '取消': 'Cancel', '已发送到当前对话': 'Sent to current conversation', '请先输入说明内容，或直接用「发到当前对话」': 'Enter a note, or send directly to the current conversation',
  '加载设置中…': 'Loading settings…', '聊天输出与链接': 'Chat output and links', '输出时携带 Sidecar 链接': 'Include Sidecar links in output', '开启时，Agent 回复中的任务 ID 会附带 [⧉] / [↗] 与底部侧栏入口链接；关闭后仅输出纯行内代码（MCP Inline 卡片不受影响），无需重启、下一轮对话即生效。': 'When enabled, task IDs in agent replies include Sidecar links. When disabled, IDs are plain inline code. MCP Inline cards are unaffected. Changes apply to the next conversation turn.', '配置文件': 'Settings file', '复制路径': 'Copy path', '已复制路径': 'Path copied',
  '状态: {status} · 优先级: {priority}': 'Status: {status} · Priority: {priority}', '…（完整内容请查看任务详情）': '… (see task details for the full content)',
  '请继续处理任务：': 'Please continue working on this task:', '请继续处理以下任务：': 'Please continue working on the following task:',
  '已新开后台会话 ({id})': 'Started a new background conversation ({id})', '未找到': 'Not found', '本轮任务列表': 'Current task list', '未找到的 ID': 'IDs not found', '（点击复制）': '(click to copy)',
  '批量加载失败': 'Failed to load tasks', '列表加载失败': 'Failed to load list', '收起为简介': 'Collapse to preview', '返回批处理': 'Back to batch', '返回列表': 'Back to list',
  '状态已更新为 {status}': 'Status updated to {status}', '状态更新失败: {error}': 'Failed to update status: {error}', '优先级已更新为 P{priority}': 'Priority updated to P{priority}', '优先级更新失败: {error}': 'Failed to update priority: {error}',
  '追加备注失败: {error}': 'Failed to add note: {error}', '已添加标签 #{label}': 'Added label #{label}', '添加标签失败: {error}': 'Failed to add label: {error}', '已移除标签 #{label}': 'Removed label #{label}', '移除标签失败: {error}': 'Failed to remove label: {error}',
  '{count}项': '{count} items', '当前页内无匹配 “{query}” 的任务': 'No tasks on this page match “{query}”', '正在读取': 'Loading', '读取失败': 'Failed to load', '读取设置失败': 'Failed to load settings', '初始化失败': 'Initialization failed', '简体中文': 'Simplified Chinese',
  '已开启输出 Sidecar 链接（下一轮对话生效）': 'Sidecar links enabled (effective on the next conversation turn)', '已关闭输出 Sidecar 链接（下一轮对话生效）': 'Sidecar links disabled (effective on the next conversation turn)', '设置保存失败: {error}': 'Failed to save settings: {error}',
  'Parent': 'Parent', 'Child': 'Child', 'Close reason': 'Close reason',
  'Summary': 'Summary', 'Description': 'Description', 'Acceptance Criteria': 'Acceptance Criteria', 'Relations': 'Relations', 'Latest Reply': 'Latest Reply', 'Notes': 'Notes', 'Copy': 'Copy', 'Project': 'Project', 'Assignee': 'Assignee', 'Created': 'Created', 'Updated': 'Updated', 'Closed': 'Closed', 'Close Bead': 'Close Bead', 'Reopen Bead': 'Reopen Bead',
};
const zhOverrides = { Parent: '父任务', Child: '子任务', 'Close reason': '关闭原因', Summary: '处理简介', Description: '描述', 'Acceptance Criteria': '验收标准', Relations: '关联关系', 'Latest Reply': '最新回复', Notes: '备注', Copy: '复制', Project: '项目', Assignee: '负责人', Created: '创建时间', Updated: '更新时间', Closed: '关闭时间', 'Close Bead': '关闭 Bead', 'Reopen Bead': '重开 Bead' };
export const MESSAGES = {
  en: Object.fromEntries(Object.entries(translations)),
  'zh-CN': Object.fromEntries(Object.keys(translations).map(key => [key, zhOverrides[key] || key])),
};
export function createTranslator(locale) {
  return (key, vars = {}) => (MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key).replace(/\{([^{}]+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
}
