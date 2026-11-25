import { projects } from './data.js';
import { localizeDemoTask } from './i18n.js';
export function createMockApi(store, hooks = {}) {
  const state = store.state;
  let settings = { version: 1, emitSidecarLinks: true }, savedQueue = null;
  const record = (channel, event, payload) => state.logs.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), channel, event, payload });
  const projectFor = args => projects.find(p => p.id === args.project || p.repo === args.repo) || projects[0];
  const common = args => ({ project: projectFor(args), projects, activeProjectId: projectFor(args).id });
  const bead = original => { const t = localizeDemoTask(original, hooks.locale?.() || 'zh-CN'); return ({ ...t, issue_type: t.type, notes: t.notes.join('\n\n'), created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', dependencies: [...(t.parent ? [{ id: t.parent, dependency_type: 'parent-child' }] : []), ...t.blockedBy.map(id => ({ id, dependency_type: 'blocks' }))], dependents: state.tasks.filter(x => x.blockedBy.includes(t.id)).map(x => ({ id: x.id, title: x.title, dependency_type: 'blocks' })) }); };
  const item = (id, args = {}) => {
    const t = state.tasks.find(x => x.id === id && x.projectId === projectFor(args).id);
    if (!t) return { ok: false, error: `任务不存在：${id}` };
    return { ok: true, id, kind: 'bead', ...common(args), bead: bead(t) };
  };
  const routes = { '/api/projects': 'ui_get_projects', '/api/item': 'ui_get_item', '/api/batch': 'ui_get_batch', '/api/list': 'ui_list_tasks', '/api/bead/status': 'ui_update_bead_status', '/api/bead/priority': 'ui_update_bead_priority', '/api/bead/note': 'ui_append_bead_note', '/api/bead/label': 'ui_update_bead_label', '/api/clipboard': 'ui_copy_clipboard' };
  async function fetch(hostId, url, options = {}) {
    const u = new URL(url, 'http://mock.local');
    const args = Object.fromEntries(u.searchParams);
    if (options.body) Object.assign(args, JSON.parse(options.body));
    if (hostId.startsWith('inline') || hostId === 'board') record('mcp', 'app.callServerTool', { method: 'tools/call', params: { name: routes[u.pathname] || (options.method === 'POST' ? 'ui_update_settings' : 'ui_get_settings'), arguments: args } });
    let data;
    try {
      if (u.pathname.startsWith('/api/bead/') && !item(args.id, args).ok) throw new Error(`任务不存在：${args.id}`);
      switch (u.pathname) {
        case '/api/projects': data = { ok: true, ...common(args) }; break;
        case '/api/settings': if (options.method === 'POST') { settings = { ...settings, ...(args.settings || args) }; hooks.changed?.(hostId); } data = { ok: true, settings, path: '/mock/settings.json' }; break;
        case '/api/list': { const all = state.tasks.filter(t => t.projectId === projectFor(args).id && (!args.status || args.status === 'all' || t.status === args.status) && `${t.id} ${localizeDemoTask(t, hooks.locale?.() || 'zh-CN').title} ${localizeDemoTask(t, hooks.locale?.() || 'zh-CN').description} ${t.labels.join(' ')}`.toLowerCase().includes((args.q || '').toLowerCase())); data = { ok: true, ...common(args), items: all.slice(0, Number(args.limit) || 40).map(t => ({ ...bead(t), kind: 'bead' })), total: all.length }; break; }
        case '/api/batch': {
          const ids = (args.ids || '').split(',').filter(Boolean);
          const items = ids.filter(id => state.tasks.some(t => t.id === id && t.projectId === projectFor(args).id)).map(id => item(id, args));
          const missing = ids.filter(id => !state.tasks.some(t => t.id === id && t.projectId === projectFor(args).id)).map(id => ({ id, error: `未找到任务或 Bead: ${id}` }));
          const counts = { total: ids.length, found: items.length, open: 0, in_progress: 0, blocked: 0, closed: 0, deferred: 0, other: 0 };
          for (const it of items) {
            const st = it.bead?.status || it.task?.status || 'other';
            if (st !== 'total' && st !== 'found' && st in counts) counts[st]++;
            else counts.other++;
          }
          data = { ok: true, ...common(args), items, missing, counts };
          break;
        }
        case '/api/item': data = item(args.id, args); break;
        case '/api/bead/status': store.updateStatus(args.id, args.status, args.reason); data = { ok: true, item: item(args.id, args) }; break;
        case '/api/bead/priority': store.updatePriority(args.id, args.priority); data = { ok: true, item: item(args.id, args) }; break;
        case '/api/bead/note': store.appendNote(args.id, args.text); data = { ok: true, item: item(args.id, args) }; break;
        case '/api/bead/label': if (args.op === 'add') store.addLabel(args.id, args.label); else store.removeLabel(args.id, args.label); data = { ok: true, item: item(args.id, args) }; break;
        case '/api/clipboard': await hooks.copy?.(args.text); store.log('mcp', 'ui_copy_clipboard', { text: args.text }); data = { ok: true }; break;
        case '/api/agent/send': store.receiveAgentPrompt(args.prompt); hooks.send?.(args.prompt); data = { ok: true }; break;
        default: data = { ok: false, error: '未知接口' };
      }
      if (options.method === 'POST' && u.pathname.startsWith('/api/bead/')) hooks.changed?.(hostId);
    } catch (error) { data = { ok: false, error: error.message }; }
    return { ok: data.ok !== false, status: data.ok === false ? 400 : 200, text: async () => JSON.stringify(data), json: async () => data };
  }
  function getInitialPayload(mode, search) {
    const params = new URLSearchParams(search);
    return { view: params.has('id') ? 'detail' : params.has('ids') ? 'batch' : 'list', id: params.get('id') || '', ids: (params.get('ids') || '').split(',').filter(Boolean), surface: mode === 'mcp-inline' ? 'inline' : 'global', projects, activeProjectId: projectFor(Object.fromEntries(params)).id };
  }
  return {
    fetch, getInitialPayload, getSettings: () => settings,
    updateModelContext: text => hooks.context?.(text),
    clearModelContext: () => store.clearContext(),
    sendMessage: text => { store.receiveAgentPrompt(text); hooks.send?.(text); return {}; },
    openLink: path => hooks.openLink?.(path),
    getReviewQueue: () => savedQueue,
    saveReviewQueue: queue => { savedQueue = queue; record('mcp', 'ui_review_queue', { op: 'set', queue }); },
    clearReviewQueue: () => { savedQueue = null; record('mcp', 'ui_review_queue', { op: 'clear' }); },
  };
}
