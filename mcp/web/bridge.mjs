import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

const app = new App({ name: window.__tasksUiConfig?.title || 'Beads Tasks', version: '0.1.0' }, {});
let payload = null;
const inputListeners = [];
const resultListeners = [];
app.ontoolinput = (params) => {
  payload = null;
  inputListeners.forEach((cb) => cb(params.arguments || {}));
};
app.ontoolresult = (params) => {
  payload = params.structuredContent || null;
  resultListeners.forEach((cb) => cb(payload));
};
app.ontoolcancelled = () => {};
function theme(ctx) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}
app.onhostcontextchanged = (ctx) => {
  theme(ctx);
  window.dispatchEvent(new Event('tasks-host-context'));
};
const routes = {
  '/api/projects': 'ui_get_projects', '/api/item': 'ui_get_item',
  '/api/batch': 'ui_get_batch', '/api/list': 'ui_list_tasks',
  '/api/bead/status': 'ui_update_bead_status', '/api/bead/priority': 'ui_update_bead_priority',
  '/api/bead/note': 'ui_append_bead_note', '/api/bead/label': 'ui_update_bead_label',
  '/api/clipboard': 'ui_copy_clipboard',
  ...window.__tasksUiExt?.mcpRoutes,
};
async function call(name, args) {
  const result = await app.callServerTool({ name, arguments: args });
  let data = result.structuredContent;
  if (!data) {
    try {
      data = JSON.parse(result.content?.[0]?.text || '{}');
    } catch {
      data = { ok: false, error: result.content?.[0]?.text || 'Tool failed' };
    }
  }
  if (result.isError && data.ok !== false) data = { ok: false, error: result.content?.[0]?.text || 'Tool failed' };
  return data;
}
function matchesPayload(url) {
  const expected = { detail: '/api/item', batch: '/api/batch', list: '/api/list' }[payload?.view];
  if (!payload || payload.payloadTruncated || url.pathname !== expected || url.searchParams.get('force')) return false;
  if ((url.searchParams.get('project') || '') !== (payload.project || '') ||
      (url.searchParams.get('repo') || '') !== (payload.repo || '')) return false;
  if (payload.view === 'detail') return url.searchParams.get('id') === payload.id;
  if (payload.view === 'batch') return url.searchParams.get('ids') === (payload.ids || []).join(',');
  return (url.searchParams.get('status') || '') === (payload.status || '') &&
    (url.searchParams.get('q') || '') === (payload.query || '') &&
    (Number(url.searchParams.get('limit')) || 40) === (Number(payload.limit) || 40);
}
window.__tasksMcpBridge = {
  isMcpApp: true,
  async fetch(url, options = {}) {
    const u = new URL(url, 'http://tasks.local');
    if (matchesPayload(u)) {
      const data = { ...payload.data, projects: payload.projects, activeProjectId: payload.activeProjectId };
      payload = null;
      return { ok: data.ok !== false, status: data.ok === false ? 400 : 200, text: async () => JSON.stringify(data) };
    }
    if (['/api/item', '/api/batch', '/api/list'].includes(u.pathname)) payload = null;
    const args = Object.fromEntries(u.searchParams);
    if (args.ids) args.ids = args.ids.split(',').filter(Boolean);
    if (args.limit) args.limit = Number(args.limit);
    if (args.force) args.force = args.force === '1' || args.force === 'true';
    if (options.body) Object.assign(args, JSON.parse(options.body));
    const name = u.pathname === '/api/settings' ? (options.method?.toUpperCase() === 'POST' ? 'ui_update_settings' : 'ui_get_settings') : routes[u.pathname];
    const data = await call(name, args);
    return { ok: data.ok !== false, status: data.ok === false ? 400 : 200, text: async () => JSON.stringify(data) };
  },
  onToolInput: (cb) => inputListeners.push(cb),
  onToolResult: (cb) => resultListeners.push(cb),
  getInitialPayload: () => payload,
  getHostCapabilities: () => app.getHostCapabilities(),
  getHostContext: () => app.getHostContext(),
  updateModelContext: (text) => app.updateModelContext({ content: [{ type: 'text', text }] }),
  clearModelContext: () => app.updateModelContext({ content: [] }),
  async sendMessage(text, { newConversation = false } = {}) {
    const result = await app.sendMessage({
      role: 'user', content: [{ type: 'text', text }],
      ...(newConversation ? { _meta: { 'com.google.antigravity/message': { target: 'new' } } } : {}),
    });
    if (result.isError) throw Error('宿主拒绝发送消息');
    return { conversationId: result._meta?.['com.google.antigravity/message']?.conversationId };
  },
  async openFileInSidePane(path) {
    if (!path.startsWith('/')) throw Error('需要绝对路径');
    try {
      const result = await app.request({ method: 'com.google.antigravity/toggle-aux-pane', params: { tabType: 'fileView', uri: `file://${encodeURI(path)}` } }, z.object({}).passthrough());
      if (result.isError) throw Error('宿主不支持打开侧栏');
    } catch (error) {
      if (error.code === -32601) throw Error('宿主不支持打开侧栏');
      throw error;
    }
  },
  loadReviewQueue: async () => (await call('ui_review_queue', { op: 'get' })).queue,
  saveReviewQueue: (queue) => call('ui_review_queue', { op: 'set', queue }),
  clearReviewQueue: () => call('ui_review_queue', { op: 'clear' }),
};
await app.connect().then(
  () => {
    theme(app.getHostContext());
    window.dispatchEvent(new Event('tasks-host-context'));
  },
  (error) => {
    const message = error?.message || String(error);
    window.__tasksMcpBridge.connectError = message;
    const host = document.getElementById('app-root') || document.body;
    if (host) {
      host.textContent = '';
      const box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin:16px;padding:12px 14px;border:1px solid #d9534f;border-radius:6px;font:13px/1.5 system-ui,sans-serif;white-space:pre-wrap;';
      box.textContent = `无法连接到 Antigravity 宿主：${message}`;
      host.appendChild(box);
    }
    console.error('tasks MCP bridge: app.connect() failed', error);
  },
);
