const pairs = {
  '。': '.', '01 / INLINE & BOARD': '01 / INLINE & BOARD', '02 / SIDECAR': '02 / SIDECAR', '03 / ZERO CONFIG': '03 / ZERO CONFIG', 'GET STARTED': 'GET STARTED', 'GitHub ↗': 'GitHub ↗', 'Issues ↗': 'Issues ↗', 'Beads Tasks': 'Beads Tasks',
  'Antigravity 插件': 'Antigravity Plugin', '简介': 'Overview', '安装': 'Install', '在线试用': 'Playground', '开始试用 ↓': 'Try it ↓',
  'beads-tasks · Antigravity Plugin · 零 npm 依赖': 'beads-tasks · Antigravity Plugin · Zero npm dependencies',
  '在 Antigravity 里，<br>直接流转每一条 Beads 任务。': 'Move every Beads task forward,<br>right in Antigravity.',
  '集成对话内 MCP Apps 卡片、左侧全页看板与右侧 Sidecar 评审面板。仅依赖原生 <code>bd</code> 即可零配置独立使用。': 'Use MCP Apps cards in conversations, a full-page board, and a Sidecar review panel. All you need is the native <code>bd</code> CLI.',
  '向下滑动试用 ↓': 'Scroll down to try it ↓', '安装说明': 'Installation', 'MCP Apps 内联与全页': 'MCP Apps inline and full-page',
  '对话内渲染 <code>show_task_card</code> / <code>show_task_batch</code>，或从左侧 Plugins 打开 <code>open_tasks_board</code> 全页看板。': 'Render <code>show_task_card</code> / <code>show_task_batch</code> in chat, or open the <code>open_tasks_board</code> board from Plugins.',
  '对话卡片 · 全页看板': 'Chat cards · Full-page board', 'Sidecar 持久评审面板': 'Persistent Sidecar review panel',
  '通过 <code>sidecar://</code> 进入右侧栏，逐条查看评审队列、页内搜索，并通过 <code>agentapi</code> 发回对话。': 'Open the right panel via <code>sidecar://</code>, review tasks one by one, search, and send them back to chat via <code>agentapi</code>.',
  '逐条查看 ▶ · 双向回传': 'Review one by one ▶ · Two-way communication', '零配置 · 独立可用': 'Zero configuration · Standalone',
  '自动探测工作区 <code>.beads/</code>；直接使用 <code>bd</code> 读写任务。': 'Automatically discover workspace <code>.beads/</code> and read or update tasks with <code>bd</code>.',
  '自动发现 · 开箱即用': 'Auto discovery · Ready to use', '↓ 向下查看安装并进入底部全屏试用': '↓ See installation and try the full-screen playground',
  '两步接入你的 Antigravity': 'Get started with Antigravity in two steps', '01 · 安装插件': '01 · Install the plugin', '02 · 零配置试用 / Sidecar 直连': '02 · Zero-config setup / Sidecar link',
  '查看 GitHub 仓库': 'View the GitHub repository', '打开含 <code>.beads/</code> 的工作区即可自动探测。': 'Open a workspace containing <code>.beads/</code> to discover it automatically.',
  ' Beads Tasks (beads-tasks) · MIT · 页面交互为本地模拟': ' Beads Tasks (beads-tasks) · MIT · Local interactive simulation', '回到顶部 ↑': 'Back to top ↑', '在线试用 · test-repo 本地沙盒（纯前端模拟）': 'Playground · test-repo local sandbox (browser simulation)', '重置沙盒': 'Reset sandbox', '↑ 安装命令': '↑ Install commands', '↑ 回到顶部': '↑ Back to top',
  '复制': 'Copy', '已复制': 'Copied', '复制失败': 'Copy failed', '主导航': 'Main navigation', 'GitHub 仓库': 'GitHub repository', '切换明暗主题': 'Toggle light and dark theme', '在线试用工作台': 'Interactive playground',
  'New Conversation': 'New Conversation', 'WORKSPACE': 'WORKSPACE', 'PLUGINS': 'PLUGINS', 'QUICK FLOWS': 'QUICK FLOWS', 'Settings': 'Settings', 'Global': 'Global',
  '列出 test-repo 四态任务': 'List the four test-repo tasks', '打开单任务卡片': 'Open a task card', '写操作闭环（优先级/备注/Reopen）': 'Try updates (priority, notes, reopen)', '重置沙盒生成新哈希 ID': 'Reset sandbox and generate new IDs',
  '切换侧栏': 'Toggle sidebar', 'Beads Tasks 侧栏': 'Beads Tasks Side Panel', '关闭辅助面板': 'Close side panel', 'Antigravity Settings': 'Antigravity Settings', '模型名展示': 'Model display', '权限策略展示': 'Permission policy', '插件设置可在侧栏或看板中调整。': 'Plugin settings are available in the side panel or board.', 'Ask first': 'Ask first', 'Auto': 'Auto',
  '列出全部任务': 'List all tasks', '查看进行中 Feature': 'Show the in-progress feature', '打开评审队列': 'Open the review queue', '打开全页看板': 'Open the full-page board', '重新打开 Bug': 'Reopen the bug',
  '复制 ID 并打开侧栏': 'Copy ID and open side panel', '在侧栏打开': 'Open in side panel', '在右侧 Beads Tasks 侧栏打开': 'Open in Beads Tasks side panel', '开始探索任务。': 'Start exploring tasks.', '从左侧选择一个演练，或直接输入指令。': 'Choose a quick flow on the left or enter a command.', '你': 'You', '列出 test-repo 任务': 'List test-repo tasks', '输入消息': 'Enter a message', '输入消息，使用 / 命令或 @ 提及': 'Enter a message; use / for commands or @ to mention', '发送消息': 'Send message', '返回对话': 'Back to conversation',
  '全部': 'All', '清空日志': 'Clear logs', '没有匹配项': 'No matches', '所有状态': 'All statuses', '状态筛选': 'Filter by status', '搜索任务或 ID': 'Search tasks or ID', '搜索任务': 'Search tasks', '没有匹配的任务。': 'No matching tasks.', '附着到下一条消息': 'Attach to next message', '附着上下文': 'Attach context', '已读': 'Read',
  '已复制地址': 'Address copied', '已复制 ID': 'ID copied', '状态已更新': 'Status updated', '重置完成': 'Sandbox reset', '已发送到当前对话': 'Sent to current conversation', '已通过 agentapi 发回对话': 'Sent to conversation via agentapi', '批处理评审': 'Batch review',
  '请查看附着的上下文。': 'Please review the attached context.', '已重置 test-repo，生成新的哈希编号。': 'Reset test-repo and generated new IDs.', '已打开批处理评审队列。': 'Opened the batch review queue.', '任务已重新打开。': 'Task reopened.', '已找到 test-repo 中的演示任务。': 'Found the demo tasks in test-repo.', '列出 test-repo 的演示任务。': 'List the demo tasks in test-repo.', '已找到 test-repo 中的四条演示任务。': 'Found four demo tasks in test-repo.', 'test-repo 已就绪：四条演示任务。': 'test-repo is ready with four demo tasks.', '查看进行中的 Feature。': 'Show the in-progress feature.', '已修改优先级、追加备注并重新打开 Bug。': 'Updated priority, added a note, and reopened the bug.', '已模拟重置并生成新的哈希编号。': 'Reset the sandbox and generated new IDs.', '已收到任务上下文，可以继续讨论或更新该任务。': 'Received the task context. Continue discussing or updating the task.',
  '未识别到有效任务 ID，当前 test-repo 任务：': 'No valid task ID found. Current test-repo tasks: ', '来自侧栏的任务上下文：': 'Task context from side panel: ', '已收到侧栏消息，但未识别到具体任务 ID。当前 test-repo 任务：': 'Received a side panel message without a task ID. Current test-repo tasks: ', '已收到侧栏发回的任务上下文：': 'Received task context from the side panel: ', '。可以继续讨论，或在下方卡片中更新状态、备注与标签。': '. Continue the discussion or update the task below.',
  '本地联调：写操作闭环完成。': 'Local testing: update workflow complete.', '当前 test-repo 任务：': 'Current test-repo tasks: ', '未知 RPC 类型': 'Unknown RPC type',
  'test-repo 任务面板演练': 'test-repo task panel demo', '新对话': 'New conversation', 'events': 'events', 'Ran': 'Ran', 'tasks': 'tasks'
};
const chineseOverrides = { '01 / INLINE & BOARD': '01 / 内联与看板', '02 / SIDECAR': '02 / 侧栏', '03 / ZERO CONFIG': '03 / 零配置', 'GET STARTED': '开始使用', 'New Conversation': '新建对话', WORKSPACE: '工作区', PLUGINS: '插件', 'QUICK FLOWS': '快捷演练', Settings: '设置', Global: '全局', 'Antigravity Settings': 'Antigravity 设置', 'Ask first': '先询问', Auto: '自动', events: '条事件', Ran: '已运行', tasks: '个任务' };
export const SITE_MESSAGES = { en: pairs, 'zh-CN': Object.fromEntries(Object.keys(pairs).map(key => [key, chineseOverrides[key] || key])) };
export function getSiteCopy(locale) { return SITE_MESSAGES[locale === 'zh-CN' ? 'zh-CN' : 'en']; }
export function detectSiteLocale(env = globalThis) {
  let query = '', saved = '';
  try { query = new URLSearchParams(env.location?.search || '').get('lang') || ''; } catch {}
  try { saved = env.localStorage?.getItem('beads-tasks-site-lang') || ''; } catch {}
  const normalize = value => /^zh(?:-|$)/i.test(value) ? 'zh-CN' : /^en$/i.test(value) ? 'en' : '';
  return normalize(query) || normalize(saved) || (/^zh/i.test(env.navigator?.language || '') ? 'zh-CN' : 'en');
}
export function saveSiteLocale(locale, env = globalThis) { try { env.localStorage?.setItem('beads-tasks-site-lang', locale); } catch {} }
const demos = {
  epic: ['演示 Epic：任务面板端到端演练', 'Demo Epic: End-to-end task panel walkthrough', '用于验证列表、详情页与批处理队列。', 'Verify the list, detail view, and batch review queue.'],
  feature: ['演示 Feature：批处理队列筛选', 'Demo Feature: Batch queue filtering', '验证 in_progress 状态渲染与状态切换按钮。', 'Verify in-progress status display and status controls.'],
  task: ['演示 Task：等待 Epic 验收', 'Demo Task: Await Epic acceptance', '依赖前置 Feature 完成后再开工。', 'Start after the prerequisite feature is complete.'],
  bug: ['演示 Bug：详情页重复渲染', 'Demo Bug: Duplicate detail rendering', '关闭后用于验证 closed 过滤与 reopen 操作。', 'Use the closed task to verify filtering and reopening.'],
  docs: ['完善项目文档', 'Improve project documentation', '为第二个项目编写使用指南。', 'Write a user guide for the second project.']
};
export function localizeDemoTask(task, locale) {
  const entry = demos[task.id === 'docs-a1b' ? 'docs' : task.projectId === 'test-repo' ? task.type : ''];
  if (!entry) return task;
  const translate = (value, zh, en) => value === zh || value === en ? (locale === 'zh-CN' ? zh : en) : value;
  return { ...task, title: translate(task.title, entry[0], entry[1]), description: translate(task.description, entry[2], entry[3]), notes: (task.notes || []).map(note => translate(translate(note, '本地联调：批处理队列切换正常。', 'Local testing: batch queue switching works.'), '本地联调：写操作闭环完成。', 'Local testing: update workflow complete.')), close_reason: translate(task.close_reason, '已在本地修复', 'Fixed locally') };
}
