import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { queueNeighbors, shouldHandleQueueShortcut, shouldRestoreSavedQueue } from '../web/review_queue.mjs';

const queue = { ids: ['a', 'b', 'c'], visitedIds: ['a', 'c', 'other'] };

test('host preload path and queue status styles are present', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.ok(html.includes('<script src="/preload.js"></script>'));
  assert.ok(!html.includes('/preload.js?'));
  assert.ok(html.includes('/app.js?v=8'));
  assert.match(css, /\.skeleton-line\s*\{/);
  assert.match(css, /\.queue-rail\s+\.btn\.is-active\b/);
  assert.match(css, /\.queue-rail\s+\.btn\.is-visited\s*\{/);
});

test('business metadata updates the project selector and initial detail restores its scoped queue', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  const saved = { ids: ['a', 'b'], metaById: {}, source: 'list', activeProjectId: 'p', conversationId: 'c', visitedIds: [] };
  const rendered = [];
  const context = {
    state: { id: 'a', ids: [], title: '', project: '', repo: '', conversationId: 'c', activeProjectId: '', projects: [] },
    initialParams: new URLSearchParams('id=a'), initialQueuePending: true,
    queue: { ids: [] }, restoredQueue: null, restoredQueueProject: '', visitedIds: new Set(),
    sessionStorage: { getItem: () => JSON.stringify(saved) }, storageKey: 'q', shouldRestoreSavedQueue,
    detailCache: new Map(), detailRequestSeq: 0, viewRequestSeq: 0, lastDetailId: '',
    $: () => ({ innerHTML: '', scrollTop: 0 }), window: { scrollY: 0, scrollTo() {} },
    renderProjectSelector: () => rendered.push('selector'), renderDetailItem: () => rendered.push('detail'),
    renderHeader() {}, clearFindStateForLoading() {}, setRefreshing() {}, findState: { open: false },
    normalizeFindQuery: String, closeFindBar() {}, esc: String, rememberItem() {}, saveQueue() {}, prefetchNeighbors() {},
    fetchDetail: async () => ({ id: 'a', project: { id: 'p' }, projects: [{ id: 'p' }], activeProjectId: 'p' }),
  };
  runInNewContext(`${section('  function restoreQueue(', '  function rememberItem(')}
    ${section('  function applyProjectsMeta(', '  function renderProjectBadge(')}
    ${section('  async function loadDetailView(', '  async function renderCurrentView(')}
    this.loadDetailView = loadDetailView;`, context);
  await context.loadDetailView();
  assert.equal(context.state.activeProjectId, 'p');
  assert.deepEqual(Array.from(context.queue.ids), saved.ids);
  assert.deepEqual(rendered, ['selector', 'detail']);
});

test('queue neighbors preserve order and count only visited queue items', () => {
  assert.deepEqual(queueNeighbors('b', queue), { index: 1, total: 3, prev: 'a', next: 'c', visitedCount: 2 });
  assert.deepEqual(queueNeighbors('x', queue), { index: -1, total: 3, prev: '', next: '', visitedCount: 2 });
  assert.equal(queueNeighbors('c', queue).next, '');
});

test('queue shortcuts respect focus, selection, composition and find', () => {
  const ctx = { view: 'detail', hasQueue: true };
  for (const key of ['ArrowLeft', '[', 'k', 'K']) assert.equal(shouldHandleQueueShortcut({ key }, ctx), 'prev');
  for (const key of ['ArrowRight', ']', 'j', 'J']) assert.equal(shouldHandleQueueShortcut({ key }, ctx), 'next');
  assert.equal(shouldHandleQueueShortcut({ key: 'Escape' }, { ...ctx, findOpen: true }), null);
  assert.equal(shouldHandleQueueShortcut({ key: 'Escape' }, { ...ctx, hasQueue: false }), 'back');
  assert.equal(shouldHandleQueueShortcut({ key: 'c' }, ctx), 'copy');
  assert.equal(shouldHandleQueueShortcut({ key: 'c' }, { ...ctx, hasSelection: true }), null);
  for (const event of [{ key: 'j', ctrlKey: true }, { key: 'j', metaKey: true }, { key: 'j', altKey: true }, { key: 'j', isComposing: true }]) assert.equal(shouldHandleQueueShortcut(event, ctx), null);
  for (const key of ['ArrowLeft', 'ArrowRight', 'j', 'J', 'k', 'K', 'c', 'C']) assert.equal(shouldHandleQueueShortcut({ key, shiftKey: true }, ctx), null);
  assert.equal(shouldHandleQueueShortcut({ key: 'j' }, { ...ctx, isEditable: true }), null);
  assert.equal(shouldHandleQueueShortcut({ key: 'j' }, { ...ctx, composing: true }), null);
  assert.equal(shouldHandleQueueShortcut({ key: 'j' }, { ...ctx, view: 'list' }), null);
});

test('queue restoration requires membership, conversation and compatible scope', () => {
  const saved = { ids: ['a', 'b'], project: 'p', conversationId: 'conversation' };
  const target = { id: 'a', conversationId: 'conversation', activeProjectId: 'p' };
  assert.equal(shouldRestoreSavedQueue(saved, target), true);
  assert.equal(shouldRestoreSavedQueue(saved, { ...target, project: 'p' }), true);
  assert.equal(shouldRestoreSavedQueue(saved, { ...target, id: 'c' }), false);
  assert.equal(shouldRestoreSavedQueue(saved, { ...target, conversationId: 'other' }), false);
  assert.equal(shouldRestoreSavedQueue(saved, { ...target, conversationId: '' }), false);
  assert.equal(shouldRestoreSavedQueue({ ...saved, conversationId: '' }, target), false);
  assert.equal(shouldRestoreSavedQueue(saved, { ...target, project: 'other' }), false);
  assert.equal(shouldRestoreSavedQueue(saved, { ...target, activeProjectId: 'other' }), false);
  assert.equal(shouldRestoreSavedQueue(saved, { ...target, activeProjectId: '' }), false);
  const crossRepo = { ...saved, repo: '/repo' };
  assert.equal(shouldRestoreSavedQueue(crossRepo, target), false);
  assert.equal(shouldRestoreSavedQueue(crossRepo, { ...target, repo: '/other' }), false);
  assert.equal(shouldRestoreSavedQueue(crossRepo, { ...target, repo: '/repo' }), true);
  const implicit = { ids: ['a'], conversationId: 'conversation', activeProjectId: 'p' };
  assert.equal(shouldRestoreSavedQueue(implicit, { ...target, project: 'p' }), true);
  assert.equal(shouldRestoreSavedQueue(implicit, { ...target, activeProjectId: 'other' }), false);
  assert.equal(shouldRestoreSavedQueue(null, target), false);
});

test('stale list, batch and detail responses cannot replace the current view', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', value: '', scrollTop: 0, classList: { toggle() {} }, querySelectorAll: () => [] });
    return nodes.get(id);
  };
  const pending = [];
  const updates = [];
  const context = {
    state: { id: '', ids: ['a'], project: 'p', repo: '', title: '', listStatusFilter: '', listQuery: '', batchStatusFilter: '' },
    $: node, window: { scrollY: 0, scrollTo() {} },
    requestJson: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
    buildScopeQuery: (args) => new URLSearchParams(args).toString(),
    renderHeader: (...args) => updates.push(['header', ...args]), applyProjectsMeta() {}, initialQueuePending: false,
    setRefreshing: (value) => updates.push(['refresh', value]),
    clearFindStateForLoading() {}, openFindBar() {}, findState: { open: false }, normalizeFindQuery: (value) => String(value || '').trim(), closeFindBar() {}, cacheItem: () => updates.push(['cache']), rememberItem() {},
    bindCardListInteractions() {}, syncInPageFind() {}, restoreListPosition() {},
    esc: String, renderBatchCard: () => '', renderListCard: () => '',
    openFromList() {}, cacheKey: (id) => `key:${id}`, visitedIds: new Set(), queue: { ids: [] },
    saveQueue() {}, detailCache: new Map(), prefetchNeighbors() {}, discardConflictingRestoredQueue: () => false,
    fetchDetail: (id) => new Promise((resolve, reject) => pending.push({ id, resolve, reject })),
    renderDetailItem: (data) => updates.push(['detail', data.id]),
    visibleItems: [], visibleSource: '', lastDetailId: '', detailRequestSeq: 0, viewRequestSeq: 0,
  };
  runInNewContext(`${section('  async function loadBatchView(', '  function renderListCard(')}
    ${section('  async function loadListView(', '  function extractLatestReply(')}
    ${section('  async function loadDetailView(', '  async function renderCurrentView(')}
    this.loadBatchView = loadBatchView; this.loadListView = loadListView; this.loadDetailView = loadDetailView;`, context);

  const batch = context.loadBatchView();
  const list = context.loadListView();
  pending[1].resolve({ items: [], project: 'new' });
  await list;
  const afterList = JSON.stringify(updates);
  const listHtml = node('app-root').innerHTML;
  pending[0].resolve({ items: [{ id: 'old' }], counts: {} });
  await batch;
  assert.equal(JSON.stringify(updates), afterList);
  assert.equal(node('app-root').innerHTML, listHtml);

  const oldList = context.loadListView();
  context.state.id = 'detail';
  const detail = context.loadDetailView();
  pending[3].resolve({ id: 'detail' });
  await detail;
  const afterDetail = JSON.stringify(updates);
  pending[2].reject(new Error('late list failure'));
  await oldList;
  assert.equal(JSON.stringify(updates), afterDetail);

  const oldDetail = context.loadDetailView();
  context.state.id = '';
  const newBatch = context.loadBatchView();
  pending[5].resolve({ items: [], counts: {} });
  await newBatch;
  const afterBatch = JSON.stringify(updates);
  pending[4].resolve({ id: 'detail' });
  await oldDetail;
  assert.equal(JSON.stringify(updates), afterBatch);
});

test('batch find opens immediately, preserves typing and stays closed when filtering', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  let resolveBatch;
  const focusCalls = [];
  let selections = 0;
  let syncs = 0;
  const tab = { getAttribute: () => 'in_progress' };
  const root = { innerHTML: '', querySelectorAll: (selector) => selector === '[data-batch-st]' ? [tab] : [], querySelector: () => null };
  const input = { value: '', focus: (options) => { focusCalls.push(options.preventScroll); context.document.activeElement = input; }, select: () => { selections += 1; } };
  const context = {
    state: { ids: ['a'], title: '', batchStatusFilter: '' }, findState: { open: false, query: '' },
    document: { activeElement: null }, window: { getSelection: () => ({ toString: () => 'unrelated selection' }) },
    $: (id) => id === 'app-root' ? root : id === 'find-input' ? input : null,
    viewRequestSeq: 0, visibleItems: [], visibleSource: '',
    buildScopeQuery: () => '', renderHeader() {}, clearFindStateForLoading() {}, setRefreshing() {}, applyProjectsMeta: (data) => { context.meta = data; },
    requestJson: () => new Promise((resolve) => { resolveBatch = resolve; }),
    cacheItem() {}, bindCardListInteractions() {}, restoreListPosition() {}, renderBatchCard: () => '', esc: String,
    syncInPageFind: () => { syncs += 1; }, runInPageFind() {}, clearFindHighlights() {}, updateFindToolbarControls() {},
    normalizeFindQuery: (value) => String(value || '').trim(),
  };
  runInNewContext(`${section('  async function loadBatchView(', '  function renderListCard(')}
    ${section('  function openFindBar(', '  function isEditableTarget(')}
    this.loadBatchView = loadBatchView; this.openFindBar = openFindBar; this.closeFindBar = closeFindBar;`, context);
  const loading = context.loadBatchView();
  assert.equal(context.findState.open, true);
  assert.match(root.innerHTML, /task-card is-skeleton/);
  assert.match(root.innerHTML, />a<\/span>/);
  assert.match(root.innerHTML, /skeleton-line/);
  assert.equal(context.document.activeElement, input);
  assert.deepEqual(focusCalls, [true]);
  assert.equal(input.value, '');
  input.value = 'typed';
  context.findState.query = 'typed';
  resolveBatch({ items: [{ id: 'a', bead: { status: 'in_progress' } }], counts: { in_progress: 1 }, projects: [{ id: 'p' }], activeProjectId: 'p' });
  await loading;
  assert.equal(context.meta.activeProjectId, 'p');
  assert.equal(input.value, 'typed');
  assert.equal(selections, 1);
  assert.equal(syncs, 1);
  context.openFindBar({ captureSelection: false });
  assert.equal(selections, 1);
  context.closeFindBar();
  tab.onclick();
  assert.equal(context.findState.open, false);
  assert.equal(context.state.batchStatusFilter, 'in_progress');
  assert.equal(syncs, 2);
});

test('leaving batch closes an empty find bar and preserves nonempty searches', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  for (const destination of ['list', 'detail']) {
    for (const query of ['', '  ', 'keyword']) {
      const nodes = new Map();
      const node = (id) => {
        if (!nodes.has(id)) nodes.set(id, { innerHTML: '', value: '', scrollTop: 0, classList: { toggle() {} }, querySelectorAll: () => [], querySelector: () => null });
        return nodes.get(id);
      };
      const calls = [];
      const context = {
        state: { id: 'a', ids: [], listStatusFilter: '', listQuery: '' }, findState: { open: true, query },
        normalizeFindQuery: (value) => value.trim(), closeFindBar: (options) => { calls.push(options.restoreFocus); context.findState.open = false; },
        $: node, window: { scrollY: 0, scrollTo() {} }, viewRequestSeq: 0, detailRequestSeq: 0, lastDetailId: '',
        renderHeader() {}, buildScopeQuery: () => '', clearFindStateForLoading() {}, setRefreshing() {}, applyProjectsMeta() {}, initialQueuePending: false,
        requestJson: async () => ({ items: [] }), cacheKey: (id) => id, visitedIds: new Set(), detailCache: new Map(),
        fetchDetail: async () => ({ id: 'a' }), discardConflictingRestoredQueue: () => false, rememberItem() {},
        queue: { ids: [] }, prefetchNeighbors() {}, renderDetailItem() {}, esc: String,
      };
      runInNewContext(`${section('  async function loadListView(', '  function extractLatestReply(')}
        ${section('  async function loadDetailView(', '  async function renderCurrentView(')}
        this.loadListView = loadListView; this.loadDetailView = loadDetailView;`, context);
      await context[destination === 'list' ? 'loadListView' : 'loadDetailView']();
      assert.deepEqual(calls, query.trim() ? [] : [false], `${destination}: ${JSON.stringify(query)}`);
      assert.equal(context.findState.open, Boolean(query.trim()));
    }
  }
});

test('history navigation resolves the new scope before restoring a queue and ignores stale resolutions', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  const pending = [];
  const renders = [];
  const saved = { ids: ['a', 'b'], project: 'p', conversationId: 'c', source: 'list', visitedIds: [] };
  const context = {
    URLSearchParams, location: { search: '?id=a' }, window: { sidecar: { conversationId: 'c' }, addEventListener: (name, fn) => { context.navigate = fn; } },
    state: { id: 'a', ids: [], title: '', project: 'p', repo: '', conversationId: 'c', activeProjectId: 'p', projects: [] },
    queue: {}, restoredQueue: null, restoredQueueProject: '', visitedIds: new Set(), viewRequestSeq: 0, scopeRefreshPending: false, initialQueuePending: false,
    sessionStorage: { getItem: () => JSON.stringify(saved) }, storageKey: 'queue', shouldRestoreSavedQueue,
    parseIds: (ids) => ids ? ids.split(',') : [],
    buildScopeQuery: () => new URLSearchParams({ conversationId: context.state.conversationId, ...(context.state.project && { project: context.state.project }) }).toString(),
    requestJson: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
    renderProjectSelector() {}, handlePendingCopy() {}, renderCurrentView: () => renders.push(context.state.activeProjectId),
  };
  runInNewContext(`${section('  function restoreQueue(', '  function discardConflictingRestoredQueue(')}
    ${section('  async function refreshProjectsScope(', '  async function init(')}
    ${section("    window.addEventListener('popstate'", '\n\n    await renderCurrentView();')}`, context);
  const first = context.navigate();
  assert.equal(context.state.activeProjectId, '');
  assert.match(pending[0].url, /conversationId=c/);
  const second = context.navigate();
  pending[1].resolve({ projects: [], activeProjectId: 'q' });
  await second;
  assert.equal(context.queue.ids.length, 0);
  assert.deepEqual(renders, ['q']);
  pending[0].resolve({ projects: [], activeProjectId: 'p' });
  await first;
  assert.equal(context.state.activeProjectId, 'q');
  assert.deepEqual(renders, ['q']);
});

test('implicit project changes isolate detail cache and cached data cannot discard a restored queue', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  const saved = { ids: ['a'], metaById: {}, activeProjectId: 'q', source: 'list', visitedIds: [] };
  const rendered = [];
  let resolveDetail;
  let removed = false;
  const context = {
    state: { id: 'a', ids: [], title: '', conversationId: 'c', project: '', activeProjectId: 'p', repo: '' },
    queue: saved, restoredQueue: saved, restoredQueueProject: 'q', visitedIds: new Set(),
    sessionStorage: { removeItem: () => { removed = true; } }, storageKey: 'queue',
    detailCache: new Map(), detailRequestSeq: 0, viewRequestSeq: 0, lastDetailId: '',
    $: () => ({ scrollTop: 0, innerHTML: '' }), window: { scrollY: 0, scrollTo() {} },
    renderDetailItem: (data) => rendered.push(data.project.id), renderHeader() {}, clearFindStateForLoading() {},
    findState: { open: false }, normalizeFindQuery: (value) => String(value || '').trim(), closeFindBar() {},
    setRefreshing() {}, esc: String, rememberItem() {}, saveQueue() {}, prefetchNeighbors() {}, applyProjectsMeta() {}, initialQueuePending: false,
    fetchDetail: () => new Promise((resolve) => { resolveDetail = resolve; }),
  };
  runInNewContext(`${section('  function discardConflictingRestoredQueue(', '  function rememberItem(')}
    ${section('  async function loadDetailView(', '  async function renderCurrentView(')}
    this.cacheKey = cacheKey; this.loadDetailView = loadDetailView;`, context);
  const oldData = { id: 'a', project: { id: 'p' } };
  context.detailCache.set(context.cacheKey('a'), { data: oldData });
  context.state.activeProjectId = 'q';
  assert.equal(context.detailCache.has(context.cacheKey('a')), false);
  const freshLoad = context.loadDetailView();
  assert.deepEqual(rendered, []);
  assert.equal(removed, false);
  resolveDetail({ id: 'a', project: { id: 'q' } });
  await freshLoad;
  assert.deepEqual(rendered, ['q']);
  assert.equal(removed, false);
  assert.equal(context.queue, saved);

  context.detailCache.set(context.cacheKey('a'), { data: oldData });
  const cachedLoad = context.loadDetailView();
  assert.deepEqual(rendered, ['q', 'p']);
  assert.equal(removed, false);
  assert.equal(context.queue, saved);
  resolveDetail({ id: 'a', project: { id: 'q' } });
  await cachedLoad;
  assert.equal(removed, false);
  assert.equal(context.queue, saved);
});

test('detail project conflict discards a restored queue', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const saved = { ids: ['a', 'b'], project: 'p', activeProjectId: 'p', source: 'batch' };
  let removed = false;
  const context = { queue: saved, restoredQueue: saved, restoredQueueProject: 'p', state: { ids: ['a', 'b'], title: 'old' }, visitedIds: new Set(['a']), sessionStorage: { removeItem: () => { removed = true; } }, storageKey: 'queue' };
  runInNewContext(`${app.slice(app.indexOf('  function discardConflictingRestoredQueue('), app.indexOf('  function cacheKey('))} this.discard = discardConflictingRestoredQueue;`, context);
  assert.equal(context.discard({ project: { id: 'q' } }), true);
  assert.equal(context.queue.ids.length, 0);
  assert.equal(context.state.ids.length, 0);
  assert.equal(removed, true);
});

test('review queue static route serves executable browser exports', () => {
  const main = readFileSync(new URL('../app_factory.mjs', import.meta.url), 'utf8');
  const route = main.match(/for \(const \[name, global, exports\] of \[[\s\S]*?\n\}\n\n(?=app\.api\('\/styles\.css')/);
  assert.ok(route);
  let handler;
  class Response { constructor(body, options) { this.body = body; this.options = options; } }
  const webDir = new URL('../web/', import.meta.url).pathname;
  runInNewContext(route[0], { app: { api: (path, fn, method) => { assert.equal(method, 'GET'); if (path === '/review_queue.js') handler = fn; } }, readFileSync, join, WEB_DIR: webDir, Response });
  assert.ok(handler);
  const response = handler();
  assert.match(response.options.contentType, /javascript/);
  assert.equal(response.options.headers['Cache-Control'], 'no-store');
  const browser = { window: {} };
  runInNewContext(response.body, browser);
  assert.equal(browser.window.__tasksReviewQueue.shouldHandleQueueShortcut({ key: 'j' }, { view: 'detail', hasQueue: true }), 'next');
});

test('detail queue footer previews ids only and keeps the compound button rule', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  const dist = readFileSync(new URL('../../../mcp/dist/app.html', import.meta.url), 'utf8');
  const preview = app.match(/const preview = \(id\) => `[^`]*`;/);
  assert.ok(preview, 'app.js must define the queue preview renderer');
  assert.match(preview[0], /class="queue-preview-id"/);
  assert.ok(!app.includes('queue-preview-title'));
  const footer = app.match(/<section class="detail-queue-footer">[\s\S]*?<\/section>/);
  assert.ok(footer, 'app.js must render the detail queue footer');
  assert.match(footer[0], /id="footer-prev"/);
  assert.match(footer[0], /id="footer-next"/);
  assert.ok(footer[0].includes('← 上一条') && footer[0].includes('下一条 →') && footer[0].includes('已到队尾 · 返回列表'));
  for (const [label, text] of [['styles.css', css], ['mcp/dist/app.html', dist]]) {
    const rule = text.match(/\.btn\.queue-footer-btn\s*\{([^}]*)\}/);
    assert.ok(rule, `${label} must style .btn.queue-footer-btn`);
    assert.match(rule[1], /height:\s*auto/, `${label} must reset the fixed .btn height`);
    const padding = rule[1].match(/padding:\s*(\d+)px\s+(\d+)px/);
    assert.ok(padding, `${label} must set a two-value padding`);
    assert.ok(Number(padding[1]) > 0, `${label} must keep a non-zero vertical padding`);
    assert.match(rule[1], /min-height:\s*44px/);
    assert.match(rule[1], /flex-direction:\s*column/);
    assert.ok(!text.includes('.queue-preview-title'), `${label} must not keep .queue-preview-title rules or markup`);
    assert.match(text, /\.queue-preview-id\s*\{[^}]*flex-shrink:\s*0/);
  }
});
