import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listKnownProjects, resolveProjectContext } from '../../sidecars/tasks/project_resolver.mjs';
import { createTasksClient } from '../../sidecars/tasks/beads_client.mjs';
import { MAX_CLIPBOARD_LEN, writeSystemClipboard } from '../../sidecars/tasks/clipboard.mjs';
import { loadSettings, saveSettings, resolveSettingsFile } from '../../sidecars/tasks/settings.mjs';

export function capStructuredPayload(payload, maxBytes = 850_000) {
  if (Buffer.byteLength(JSON.stringify(payload)) <= maxBytes) return payload;
  const trim = (value, size) => {
    if (Array.isArray(value)) return value.slice(0, size).map((item) => trim(item, size));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trim(item, size)]));
    return typeof value === 'string' && value.length > size * 16 ? `${value.slice(0, size * 16)}…` : value;
  };
  for (const size of [256, 64, 16, 4, 1]) {
    const result = { ...trim(payload, size), payloadTruncated: true };
    if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes) return result;
  }
  return { payloadTruncated: true, surface: payload.surface, view: payload.view, id: payload.id, ids: payload.ids?.slice(0, 50) };
}
export function createTasksMcpCore(options = {}) {
const { name: serverName = 'beads-tasks', version = '0.1.0', uri = 'ui://beads-tasks/app.html', boardTitle = 'Beads Tasks', client = createTasksClient(), settingsDeps = {}, extraTools = [], appHtmlPath = join(dirname(fileURLToPath(import.meta.url)), 'app.html'), appHtmlEnvKey, formatDetailSummary, formatItemLine } = options;
const { fetchItem, fetchBatch, fetchProjectList, updateBeadStatus, updateBeadPriority, appendBeadNote, updateBeadLabel } = client;
const dataDir = process.argv.find((arg) => arg.startsWith('--data-dir='))?.slice(11);
const queueFile = dataDir && join(dataDir, 'review-queue.json');
let memoryQueue = null;
const projectDeps = () => typeof options.projectDeps === 'function' ? options.projectDeps() : (options.projectDeps || {});
const prop = (type, description) => ({ type, description });
const common = {
  project: prop('string', 'Project ID to search; defaults to the active project.'),
  repo: prop('string', 'Repository path used to resolve the project.'),
  conversationId: prop('string', 'Conversation scope for project resolution.'),
  force: prop('boolean', 'Refresh cached task data.'),
};
const id = prop('string', 'Bead or task ID.');
const ids = { type: 'array', items: { type: 'string' }, description: 'Bead or task IDs in display order (2–50 for a batch).' };
const title = prop('string', 'Optional title for the batch.');
const definitions = [
  ['show_task_card', { id, repo: common.repo, project: common.project }, ['id'], 'card', 'Inline interactive task card for a single Bead or task.'],
  ['show_task_batch', { ids, title, repo: common.repo, project: common.project }, ['ids'], 'batch', 'Inline interactive batch card for multiple tasks (2–50 IDs) mentioned in the current turn.'],
  ['open_tasks_board', { id, ids, title, status: prop('string', 'Filter the project list by task status.'), query: prop('string', 'Search the project list by ID, title or label.'), limit: prop('number', 'Maximum number of project tasks to return.'), repo: common.repo, project: common.project }, [], 'board', 'Open or update the full-page tasks board (global). All arguments are optional; empty {} opens the default project task list.'],
  ['ui_get_settings', {}, []],
  ['ui_update_settings', { emitSidecarLinks: { type: 'boolean' }, locale: { type: 'string', enum: ['auto', 'en', 'zh-CN'] } }, []],
  ['ui_get_projects', common, []],
  ['ui_get_item', { ...common, id }, ['id']],
  ['ui_get_batch', { ...common, ids }, ['ids']],
  ['ui_list_tasks', { ...common, status: { type: 'string' }, q: { type: 'string' }, limit: { type: 'number' } }, []],
  ['ui_update_bead_status', { ...common, id, status: { type: 'string' }, currentStatus: { type: 'string' }, reason: { type: 'string' } }, ['id', 'status']],
  ['ui_update_bead_priority', { ...common, id, priority: { type: 'number' } }, ['id', 'priority']],
  ['ui_append_bead_note', { ...common, id, text: { type: 'string' } }, ['id', 'text']],
  ['ui_update_bead_label', { ...common, id, op: { type: 'string' }, label: { type: 'string' } }, ['id', 'op', 'label']],
  ['ui_copy_clipboard', { text: { type: 'string' } }, ['text']],
  ['ui_review_queue', { op: { enum: ['get', 'set', 'clear'] }, queue: { type: 'object' } }, ['op']],
];
const modelNames = new Set(definitions.filter((definition) => definition[3]).map((definition) => definition[0]));
const tools = definitions.map(([name, properties, required, kind, description]) => ({
  name,
  description: description || `Tasks: ${name}`,
  inputSchema: { type: 'object', properties, required },
  _meta: kind ? {
    ui: { resourceUri: uri },
    ...(kind === 'board' ? { 'com.google.antigravity/ui': { entrypoints: [{ type: 'global', title: boardTitle }] } } : {}),
  } : { ui: { visibility: ['app'] } },
}));
for (const extra of extraTools) tools.push(extra.tool);
async function context(args) {
  const [primary, known] = await Promise.all([resolveProjectContext(args, projectDeps()), listKnownProjects(args, projectDeps())]);
  return { primary, known, fallbacks: known.projects.filter((project) => !primary || project.id !== primary.id) };
}
async function run(name, args) {
  if (name === 'ui_get_settings') return { ok: true, settings: await loadSettings(settingsDeps), path: resolveSettingsFile(settingsDeps) };
  if (name === 'ui_update_settings') return { ok: true, ...await saveSettings(args, settingsDeps) };
  if (name === 'ui_review_queue') {
    if (args.op === 'get') {
      if (queueFile) {
        try {
          return { ok: true, queue: JSON.parse(await readFile(queueFile, 'utf8')) };
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return { ok: true, queue: memoryQueue };
    }
    if (!['set', 'clear'].includes(args.op)) throw Error('Unknown queue operation');
    memoryQueue = args.op === 'clear' ? null : args.queue;
    if (queueFile) {
      await mkdir(dirname(queueFile), { recursive: true });
      await writeFile(queueFile, JSON.stringify(memoryQueue));
    }
    return { ok: true, queue: memoryQueue };
  }
  if (name === 'ui_copy_clipboard') {
    if (!args.text || args.text.length > MAX_CLIPBOARD_LEN || args.text.includes('\0')) throw Error('invalid clipboard text');
    await writeSystemClipboard(args.text);
    return { ok: true };
  }
  const extra = extraTools.find((entry) => entry.tool.name === name);
  if (!extra && !definitions.some(([toolName]) => toolName === name)) throw Error('Unknown tool');
  const { primary, known, fallbacks } = await context(args);
  const deps = { noCache: !!args.force };
  if (name === 'ui_get_projects') return { ok: true, ...known };
  const item = () => fetchItem(args.id, primary, fallbacks, deps);
  const batch = () => fetchBatch(args.ids, primary, fallbacks, deps);
  const list = () => primary ? fetchProjectList(primary, { status: args.status, query: args.q || args.query, limit: args.limit }, deps) : Promise.resolve({ ok: true, items: [], project: null });
  if (name === 'ui_get_item') return { ...await item(), ...known };
  if (name === 'ui_get_batch') return { ...await batch(), ...known };
  if (name === 'ui_list_tasks') return { ...await list(), ...known };
  if (modelNames.has(name)) {
    const view = name === 'show_task_card' || args.id ? 'detail' : name === 'show_task_batch' || args.ids?.length ? 'batch' : 'list';
    const data = view === 'detail' ? await item() : view === 'batch' ? await batch() : await list();
    return { surface: name === 'open_tasks_board' ? 'board' : 'inline', view, id: args.id, ids: args.ids, title: args.title, project: args.project, repo: args.repo, status: args.status || '', query: args.query || '', limit: args.limit, data, ...known };
  }
  const target = args.id || args.taskId;
  let ctx = primary;
  if (!args.project && !args.repo && target) {
    const found = await fetchItem(target, primary, fallbacks);
    if (found.ok && found.project) ctx = [primary, ...fallbacks].find((project) => project?.id === found.project.id) || primary;
  }
  if (name === 'ui_update_bead_status') await updateBeadStatus(target, { status: args.status, currentStatus: args.currentStatus, reason: args.reason, force: !!args.force }, ctx);
  else if (name === 'ui_update_bead_priority') await updateBeadPriority(target, args.priority, ctx);
  else if (name === 'ui_append_bead_note') await appendBeadNote(target, args.text, ctx);
  else if (name === 'ui_update_bead_label') await updateBeadLabel(target, { op: args.op, label: args.label }, ctx);
  else if (extra) return extra.handler(args, { primary, known, fallbacks, ctx, target, client, context });
  return { ok: true, item: await fetchItem(args.refreshId || target, ctx, fallbacks, { noCache: true }) };
}
function short(value, max = 1200) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
function itemLine(item) {
  const task = item.taskDetail?.task || item.relatedTasks?.[0] || item.task || {};
  const bead = item.bead || item;
  return `- ${item.id || bead.id || task.id} [${bead.status || task.status || 'unknown'}] ${short(bead.title || task.title || '(untitled)', 200)}`;
}
function summary(payload) {
  const data = payload.data || {};
  if (data.ok === false) return `Tasks: ${short(data.error || 'not found')}`;
  if (payload.view === 'detail') {
    const bead = data.bead || {};
    const task = data.taskDetail?.task || data.relatedTasks?.[0] || data.task || {};
    const steps = data.taskDetail?.steps || [];
    const done = steps.length ? steps.filter((step) => step.status === 'done').length : task.steps_done;
    const total = steps.length || task.steps_total;
    return [
      `## ${short(bead.title || task.title || data.id || payload.id, 200)} (${data.id || payload.id})`,
      `Status: ${bead.status || task.status || 'unknown'} | Priority: ${bead.priority ?? data.priority ?? 'unknown'} | Project: ${data.project?.name || data.project?.id || payload.project || 'default'}`,
      formatDetailSummary?.({ data, payload, task, steps, done, total }) || '',
      bead.description ? `Description: ${short(bead.description)}` : '',
      bead.acceptance_criteria ? `Acceptance: ${short(bead.acceptance_criteria)}` : '',
    ].filter(Boolean).join('\n\n');
  }
  const items = data.items || [];
  const counts = data.counts || {};
  const statusCounts = Object.entries(counts).filter(([key]) => !['total', 'found'].includes(key)).map(([key, value]) => `${key}: ${value}`).join(', ');
  return [`## ${short(payload.title || (payload.view === 'batch' ? 'Task batch' : 'Tasks board'), 200)} (${counts.total ?? items.length})`, statusCounts, ...items.slice(0, 30).map(formatItemLine || itemLine), items.length > 30 ? `… ${items.length - 30} more` : ''].filter(Boolean).join('\n');
}
const server = new Server({ name: serverName, version }, { capabilities: { tools: {}, resources: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri, name: boardTitle, mimeType: 'text/html;profile=mcp-app', _meta: { ui: { prefersBorder: false } } }] }));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== uri) throw Error('Unknown resource');
  const path = (appHtmlEnvKey && process.env[appHtmlEnvKey]) || appHtmlPath;
  return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: await readFile(path, 'utf8'), _meta: { ui: { prefersBorder: false } } }] };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const name = request.params.name;
    const result = await run(name, request.params.arguments || {});
    const payload = modelNames.has(name) ? capStructuredPayload(result) : result;
    const text = modelNames.has(name) ? `${summary(result)}${payload.payloadTruncated ? '\n\nPayload truncated; use the app to load full details.' : ''}` : result.ok === false ? `Tasks: ${result.error || 'not found'}` : `Tasks: ${name} completed.`;
    return { content: [{ type: 'text', text }], structuredContent: payload };
  } catch (error) {
    const message = error.message || String(error);
    return { isError: true, content: [{ type: 'text', text: message }], structuredContent: { ok: false, error: message } };
  }
});
return { tools, run, summary, server };
}
export async function startTasksMcpServer(options = {}) {
  const core = createTasksMcpCore(options);
  await core.server.connect(new StdioServerTransport());
  return core;
}
