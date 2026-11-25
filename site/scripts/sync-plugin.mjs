#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 同仓相对路径：site/scripts -> <repo>/sidecars/tasks/web
const source = resolve(root, '../sidecars/tasks/web');
const names = ['index.html', 'styles.css', 'notes_format.mjs', 'in_page_search.mjs', 'review_queue.mjs', 'i18n.mjs', 'app.js'];
const [html, css, notes, find, queue, i18n, app] = await Promise.all(names.map(n => readFile(resolve(source, n), 'utf8')));
const wrap = (code, name, exports) => `(() => {\n${code.replace(/\bexport\s+(const|function)\s+/g, '$1 ')}\nwindow.${name} = { ${exports} };\n})();`;
const bundle = { html, css, scripts: ['window.__tasksUiConfig = { ...window.__tasksUiConfig, title: "Beads Tasks", storageKey: "beads-tasks-review-queue" };', wrap(notes, '__tasksNotesFormat', 'formatBeadNotesForDisplay'), wrap(find, '__tasksInPageSearch', 'MAX_FIND_MARKS, normalizeFindQuery, findTextRanges, splitTextByMatches, nextMatchIndex, shouldHandleFindShortcut'), wrap(queue, '__tasksReviewQueue', 'queueNeighbors, shouldHandleQueueShortcut, shouldRestoreSavedQueue'), wrap(i18n, '__tasksI18n', 'SUPPORTED_LOCALES, normalizeLocale, resolveLocale, MESSAGES, createTranslator'), app.replaceAll('new URLSearchParams(location.search)', 'new URLSearchParams(window.__tasksInitialSearch ?? location.search)')] };
function pluginPreload(config) {
  let seq = 0, currentTheme = config.theme, currentLocale = config.locale || 'en';
  const pending = new Map(), inputListeners = new Set(), resultListeners = new Set();
  const rpc = (type, payload) => new Promise((resolve, reject) => {
    const reqId = `${config.hostId}:${++seq}`;
    pending.set(reqId, { resolve, reject });
    window.parent.postMessage({ kind: 'beads-plugin', hostId: config.hostId, reqId, type, ...payload }, '*');
  });
  window.addEventListener('message', e => {
    if (e.source !== window.parent) return;
    const msg = e.data;
    if (msg?.kind !== 'beads-host') return;
    if (msg.reqId && pending.has(msg.reqId)) {
      const request = pending.get(msg.reqId); pending.delete(msg.reqId);
      if (msg.error) request.reject(new Error(msg.error)); else request.resolve(msg);
    } else if (msg.type === 'theme') {
      currentTheme = msg.theme; document.documentElement.dataset.theme = msg.theme;
      window.dispatchEvent(new Event('tasks-host-context'));
    } else if (msg.type === 'locale') {
      currentLocale = msg.locale || 'en';
      window.__tasksUiConfig = { ...window.__tasksUiConfig, locale: currentLocale };
      window.dispatchEvent(new Event('tasks-host-context'));
    } else if (msg.type === 'tool_result') resultListeners.forEach(cb => cb(msg.data));
    else if (msg.type === 'tool_input') inputListeners.forEach(cb => cb(msg.data));
    else if (msg.type === 'refresh') document.getElementById('btn-refresh')?.click();
  });
  for (const name of ['localStorage', 'sessionStorage']) {
    try { void window[name]; } catch (_) {
      const values = new Map();
      const storage = { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: key => values.get(String(key)) ?? null, setItem: (key, value) => values.set(String(key), String(value)), removeItem: key => values.delete(String(key)), clear: () => values.clear() };
      Object.defineProperty(window, name, { configurable: true, value: storage });
    }
  }
  window.__tasksInitialSearch = config.search;
  window.__tasksUiConfig = { ...window.__tasksUiConfig, locale: currentLocale };
  document.documentElement.dataset.theme = currentTheme;
  const replace = history.replaceState.bind(history);
  history.replaceState = (state, title, url) => {
    const query = String(url || '').includes('?') ? '?' + String(url).split('?').slice(1).join('?') : '';
    window.__tasksInitialSearch = query;
    try { replace(state, title, url); } catch (_) {}
    window.parent.postMessage({ kind: 'beads-plugin', hostId: config.hostId, type: 'route_sync', query }, '*');
  };
  const makeResponse = res => ({ ok: Boolean(res.ok), status: res.status || (res.ok ? 200 : 400), text: async () => JSON.stringify(res.data), json: async () => res.data });
  const fetch = (url, options = {}) => rpc('fetch', { url: String(url), method: options.method || 'GET', body: options.body ?? null }).then(makeResponse);
  window.sidecar = { conversationId: config.conversationId, fetch };
  if (config.mode !== 'sidecar') window.__tasksMcpBridge = {
    isMcpApp: true, fetch,
    onToolInput: cb => { inputListeners.add(cb); return () => inputListeners.delete(cb); },
    onToolResult: cb => { resultListeners.add(cb); return () => resultListeners.delete(cb); },
    getInitialPayload: () => config.initialPayload,
    getHostCapabilities: () => config.mode === 'mcp-inline' ? { serverTools: {}, message: {}, updateModelContext: {} } : { serverTools: {} },
    getHostContext: () => ({ theme: currentTheme, locale: currentLocale }),
    updateModelContext: text => rpc('update_model_context', { text }).then(res => res.data),
    clearModelContext: () => rpc('clear_model_context', {}).then(res => res.data),
    sendMessage: text => rpc('send_message', { text }).then(res => res.data),
    openFileInSidePane: path => rpc('open_link', { path }).then(res => res.data),
    openLink: path => rpc('open_link', { path }).then(res => res.data),
    loadReviewQueue: () => rpc('review_queue_get', {}).then(res => res.data),
    getReviewQueue: () => rpc('review_queue_get', {}).then(res => res.data),
    saveReviewQueue: queue => rpc('review_queue_set', { queue }).then(res => res.data),
    clearReviewQueue: () => rpc('review_queue_clear', {}).then(res => res.data),
  };
  if (config.mode === 'mcp-inline') {
    const style = document.createElement('style');
    style.textContent = 'html, body, html.is-mcp-inline, html.is-mcp-inline body, body.is-mcp-inline { height: auto !important; min-height: 0 !important; } html body .shell, html.is-mcp-inline .shell, body.is-mcp-inline .shell { min-height: 0 !important; }';
    document.head.appendChild(style);
    const target = document.querySelector('.shell') || document.body;
    const measure = () => Math.max(80, Math.min(560, Math.ceil(target.getBoundingClientRect().height) + 2));
    let lastHeight = 0;
    const resize = () => {
      const height = measure();
      if (height === lastHeight) return;
      lastHeight = height;
      window.parent.postMessage({ kind: 'beads-plugin', hostId: config.hostId, type: 'resize', height }, '*');
    };
    new ResizeObserver(resize).observe(target);
    new MutationObserver(() => requestAnimationFrame(resize)).observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    setTimeout(resize, 500);
  }
}
const output = `// Generated by scripts/sync-plugin.mjs; do not edit.\nexport const PLUGIN_SOURCE_VERSION = ${JSON.stringify('beads-tasks-antigravity sidecars/tasks/web')};\nconst source = ${JSON.stringify(bundle)};\nconst pluginPreload = ${pluginPreload.toString()};\nexport function buildPluginSrcdoc({ mode = 'sidecar', hostId = '', search = '', theme = 'light', locale = 'en', conversationId = '', initialPayload = null } = {}) {\n  const config = JSON.stringify({ mode, hostId, search, theme, locale, conversationId, initialPayload }).replace(/</g, () => '\\\\u003c');\n  const preload = '(' + pluginPreload.toString() + ')(' + config + ');';\n  const safe = text => text.replace(/<\\/script/gi, '<\\\\/script');\n  const scripts = [preload, ...source.scripts].map(s => '<script>' + safe(s) + '</' + 'script>').join('\\n');\n  return source.html.replace(/<script\\b[^>]*src=[^>]*><\\/script>/gi, '').replace(/<link\\b[^>]*href=[^>]*>/gi, () => '<style>' + source.css.replace(/<\\/style/gi, '<\\\\/style') + '</style>').replace('</body>', () => scripts + '</body>');\n}\n`;
await writeFile(resolve(root, 'js/plugin_bundle.js'), output);
console.log('已同步真实插件到 js/plugin_bundle.js');
