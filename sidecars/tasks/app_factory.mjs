import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import { MAX_CLIPBOARD_LEN, writeSystemClipboard } from './clipboard.mjs';
import { sendAgentMessage } from './agentapi.mjs';
import { loadSettings, saveSettings, resolveSettingsFile } from './settings.mjs';
import { listKnownProjects, resolveProjectContext } from './project_resolver.mjs';
import { createTasksClient } from './beads_client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export function createSidecarApp(options = {}) {
const { client = createTasksClient(), settingsDeps = {}, defaultTitle = 'Beads Tasks', uiConfig, extraWebScripts = [], extraWebStyles = [], extraRoutes, onStart } = options;
const { fetchItem, fetchBatch, fetchProjectList, updateBeadStatus, appendBeadNote, updateBeadPriority, updateBeadLabel } = client;
const WEB_DIR = options.webDir || join(__dirname, 'web');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    contentType: 'application/json; charset=utf-8',
  });
}

async function resolveContextAndFallbacks(data, defaultConvId) {
  const params = {
    project: data?.project,
    repo: data?.repo,
    conversationId: data?.conversationId || defaultConvId || '',
  };
  const [primaryCtx, known] = await Promise.all([
    resolveProjectContext(params, projectDeps()),
    listKnownProjects(params, projectDeps()),
  ]);
  const fallbacks = known.projects.filter((p) => !primaryCtx || p.id !== primaryCtx.id);
  return { primaryCtx, fallbacks, known };
}

async function resolveWriteContext(data, id, defaultConvId) {
  const { primaryCtx, fallbacks } = await resolveContextAndFallbacks(data, defaultConvId);
  // If no explicit repo/project was given, locate where the item actually lives first
  if (!data?.project && !data?.repo && id) {
    const item = await fetchItem(id, primaryCtx, fallbacks);
    if (item.ok && item.project) {
      const matched = [primaryCtx, ...fallbacks].find((p) => p && p.id === item.project.id);
      if (matched) return { ctx: matched, fallbacks };
    }
  }
  return { ctx: primaryCtx, fallbacks };
}

const app = new SidecarApp();
const projectDeps = () => {
  const injected = typeof app.getConversationMetadata === 'function' ? { getConversationMetadata: app.getConversationMetadata.bind(app) } : {};
  return typeof options.projectDeps === 'function' ? { ...options.projectDeps(injected), ...injected } : { ...options.projectDeps, ...injected };
};
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
app.page('/', () => {
  let html = readFileSync(join(WEB_DIR, 'index.html'), 'utf-8');
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(defaultTitle)}</title>`);
  html = html.replace(/(<h1 id="view-title"[^>]*>)[^<]*(<\/h1>)/, (_, start, end) => `${start}${escapeHtml(defaultTitle)}${end}`);
  const styles = extraWebStyles.map(({ route }) => `<link rel="stylesheet" href="${escapeHtml(route)}" />`).join('\n');
  const scripts = extraWebScripts.map(({ route }) => `<script src="${escapeHtml(route)}"></script>`).join('\n');
  const config = uiConfig ? `<script>window.__tasksUiConfig = ${JSON.stringify(uiConfig).replace(/</g, '\\u003c')};</script>` : '';
  return html.replace('</head>', () => `${styles}\n${config}\n${scripts}\n</head>`);
});
for (const [entries, contentType] of [[extraWebScripts, 'application/javascript; charset=utf-8'], [extraWebStyles, 'text/css; charset=utf-8']]) {
  for (const { route, filePath } of entries) app.api(route, () => new Response(readFileSync(filePath, 'utf-8'), { contentType, headers: { 'Cache-Control': 'no-store' } }), 'GET');
}

for (const [name, global, exports] of [
  ['i18n', '__tasksI18n', 'SUPPORTED_LOCALES, normalizeLocale, resolveLocale, MESSAGES, createTranslator'],
  ['notes_format', '__tasksNotesFormat', 'formatBeadNotesForDisplay'],
  ['in_page_search', '__tasksInPageSearch', 'MAX_FIND_MARKS, normalizeFindQuery, findTextRanges, splitTextByMatches, nextMatchIndex, shouldHandleFindShortcut'],
  ['review_queue', '__tasksReviewQueue', 'queueNeighbors, shouldHandleQueueShortcut, shouldRestoreSavedQueue'],
]) {
  app.api(`/${name}.js`, () => {
    const source = readFileSync(join(WEB_DIR, `${name}.mjs`), 'utf8').replace(/\bexport\s+(const|function)\s+/g, '$1 ');
    return new Response(`(() => {\n${source}\nwindow.${global} = { ${exports} };\n})();\n`, {
      contentType: 'application/javascript; charset=utf-8', headers: { 'Cache-Control': 'no-store' },
    });
  }, 'GET');
}

app.api('/styles.css', () => new Response(readFileSync(join(WEB_DIR, 'styles.css'), 'utf-8'), {
  contentType: 'text/css; charset=utf-8',
  headers: { 'Cache-Control': 'no-store' },
}), 'GET');

app.api('/app.js', () => new Response(readFileSync(join(WEB_DIR, 'app.js'), 'utf-8'), {
  contentType: 'application/javascript; charset=utf-8',
  headers: { 'Cache-Control': 'no-store' },
}), 'GET');

app.api('/notes_format.mjs', () => new Response(readFileSync(join(WEB_DIR, 'notes_format.mjs'), 'utf-8'), {
  contentType: 'application/javascript; charset=utf-8',
  headers: { 'Cache-Control': 'no-store' },
}), 'GET');

app.api('/in_page_search.mjs', () => new Response(readFileSync(join(WEB_DIR, 'in_page_search.mjs'), 'utf-8'), {
  contentType: 'application/javascript; charset=utf-8',
  headers: { 'Cache-Control': 'no-store' },
}), 'GET');

app.api('/api/projects', async (data) => {
  const convId = data?.conversationId || app.config.conversationId || '';
  const known = await listKnownProjects({
    project: data?.project,
    repo: data?.repo,
    conversationId: convId,
  }, projectDeps());
  return { ok: true, ...known };
}, 'GET');

app.api('/api/settings', async () => ({ ok: true, settings: await loadSettings(settingsDeps), path: resolveSettingsFile(settingsDeps) }), 'GET');
app.api('/api/settings', async (data) => {
  try {
    const patch = data?.settings && typeof data.settings === 'object' ? data.settings : data;
    return { ok: true, ...await saveSettings(patch, settingsDeps) };
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, err?.code === 'EINVALID' ? 400 : 500);
  }
}, 'POST');

function requestDeps(data) {
  return { noCache: data?.force === '1' || data?.force === 'true' || data?.force === true };
}

app.api('/api/item', async (data) => {
  const id = typeof data?.id === 'string' ? data.id.trim() : '';
  const { primaryCtx, fallbacks, known } = await resolveContextAndFallbacks(data, app.config.conversationId);
  return { ...await fetchItem(id, primaryCtx, fallbacks, requestDeps(data)), ...known };
}, 'GET');

app.api('/api/batch', async (data) => {
  const { primaryCtx, fallbacks, known } = await resolveContextAndFallbacks(data, app.config.conversationId);
  return { ...await fetchBatch(data?.ids, primaryCtx, fallbacks, requestDeps(data)), ...known };
}, 'GET');

app.api('/api/list', async (data) => {
  const { primaryCtx, known } = await resolveContextAndFallbacks(data, app.config.conversationId);
  return { ...await fetchProjectList(primaryCtx, {
    status: data?.status,
    query: data?.q,
    limit: data?.limit,
  }, requestDeps(data)), ...known };
}, 'GET');

app.api('/api/bead/status', async (data) => {
  const id = typeof data?.id === 'string' ? data.id.trim() : '';
  if (!id) return jsonResponse({ ok: false, error: 'missing bead id' }, 400);
  try {
    const { ctx, fallbacks } = await resolveWriteContext(data, id, app.config.conversationId);
    await updateBeadStatus(id, {
      status: data?.status,
      currentStatus: data?.currentStatus,
      reason: data?.reason,
      force: Boolean(data?.force),
    }, ctx);
    const item = await fetchItem(id, ctx, fallbacks, { noCache: true });
    return { ok: true, item };
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 400);
  }
}, 'POST');

app.api('/api/bead/note', async (data) => {
  const id = typeof data?.id === 'string' ? data.id.trim() : '';
  if (!id) return jsonResponse({ ok: false, error: 'missing bead id' }, 400);
  try {
    const { ctx, fallbacks } = await resolveWriteContext(data, id, app.config.conversationId);
    await appendBeadNote(id, data?.text, ctx);
    const item = await fetchItem(id, ctx, fallbacks, { noCache: true });
    return { ok: true, item };
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 400);
  }
}, 'POST');

app.api('/api/bead/priority', async (data) => {
  const id = typeof data?.id === 'string' ? data.id.trim() : '';
  if (!id) return jsonResponse({ ok: false, error: 'missing bead id' }, 400);
  try {
    const { ctx, fallbacks } = await resolveWriteContext(data, id, app.config.conversationId);
    await updateBeadPriority(id, data?.priority, ctx);
    const item = await fetchItem(id, ctx, fallbacks, { noCache: true });
    return { ok: true, item };
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 400);
  }
}, 'POST');

app.api('/api/bead/label', async (data) => {
  const id = typeof data?.id === 'string' ? data.id.trim() : '';
  if (!id) return jsonResponse({ ok: false, error: 'missing bead id' }, 400);
  try {
    const { ctx, fallbacks } = await resolveWriteContext(data, id, app.config.conversationId);
    await updateBeadLabel(id, { op: data?.op, label: data?.label }, ctx);
    const item = await fetchItem(id, ctx, fallbacks, { noCache: true });
    return { ok: true, item };
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 400);
  }
}, 'POST');

app.api('/api/clipboard', async (data) => {
  const text = typeof data?.text === 'string' ? data.text : '';
  if (!text || text.length > MAX_CLIPBOARD_LEN || text.includes('\0')) {
    return jsonResponse({ ok: false, error: 'invalid clipboard text' }, 400);
  }
  try {
    await writeSystemClipboard(text);
    return { ok: true };
  } catch (err) {
    console.error('[clipboard] write failed:', err?.message || err);
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500);
  }
}, 'POST');

app.api('/api/agent/send', async (data) => {
  const conversationId =
    (typeof data?.conversationId === 'string' ? data.conversationId.trim() : '') ||
    (app.config.conversationId || '').trim();
  const prompt = typeof data?.prompt === 'string' ? data.prompt.trim() : '';
  if (!conversationId) {
    return jsonResponse({ ok: false, error: '当前侧栏未绑定会话，无法发送到对话' }, 400);
  }
  if (!prompt) {
    return jsonResponse({ ok: false, error: '消息内容不能为空' }, 400);
  }
  try {
    await sendAgentMessage(conversationId, prompt, typeof app.sendMessage === 'function' ? { sendMessage: app.sendMessage.bind(app) } : {});
    return { ok: true };
  } catch (err) {
    const message = err?.message || String(err);
    const badRequest = err?.code === 'EINVALID' || err?.code === 'ENOENT' || /未检测到 agentapi/.test(message);
    console.error('[agentapi] send failed:', message);
    return jsonResponse({ ok: false, error: message }, badRequest ? 400 : 500);
  }
}, 'POST');

const helpers = { jsonResponse, resolveContextAndFallbacks, resolveWriteContext, requestDeps, projectDeps, client };
extraRoutes?.(app, helpers);
return { app, run() { const result = app.run(); onStart?.(app, helpers); return result; } };
}
