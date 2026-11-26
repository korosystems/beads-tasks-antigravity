import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { queueNeighbors, shouldHandleQueueShortcut, shouldRestoreSavedQueue } from '../web/review_queue.mjs';

const queue = { ids: ['a', 'b', 'c'], visitedIds: ['a', 'c', 'other'] };

test('inline first paint restores theme and isolates conversation snapshots', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 2);
  const values = new Map([
    ['q:theme', JSON.stringify({ cssVariables: { '--bg': '#123' }, dataTheme: 'dark' })],
    ['q:view-paint:A', JSON.stringify({ conversationId: 'A', title: 'saved', projectBadgeText: 'p', projectBadgeHidden: false, projectBadgeColor: 'red', batchNavHtml: 'nav', batchNavHidden: false, appRootHtml: '<p>saved</p>', settingsPressed: 'true' })],
    ['q:scroll:A', JSON.stringify({ id: 'a', rootScrollTop: 42 })],
    ['q:view-paint:B', JSON.stringify({ conversationId: 'A', appRootHtml: 'wrong' })],
  ]);
  const storage = { getItem: key => values.get(key) ?? null };
  const run = search => {
    const nodes = new Map();
    const node = id => {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: id === 'app-root' ? '加载中…' : '', textContent: '', scrollTop: 0, style: { setProperty() {} }, classList: { toggle() {} }, setAttribute() {} });
      return nodes.get(id);
    };
    const css = {};
    const document = { getElementById: node, documentElement: { dataset: {}, style: { setProperty: (k, v) => { css[k] = v; } } } };
    const context = { window: { __tasksUiConfig: { storageKey: 'q' } }, location: { search }, document, sessionStorage: storage, localStorage: storage, URLSearchParams };
    scripts.forEach(script => runInNewContext(script, context));
    assert.equal(css['--bg'], '#123'); assert.equal(document.documentElement.dataset.theme, 'dark');
    return node;
  };
  let node = run('?clip=abc&conversationId=A');
  assert.equal(node('app-root').innerHTML, '<p>saved</p>'); assert.equal(node('app-root').scrollTop, 42); assert.equal(node('view-title').textContent, 'saved');
  node = run('?clip=abc&conversationId=B'); assert.equal(node('app-root').innerHTML, '');
  node = run('?id=abc&clip=abc&conversationId=A'); assert.equal(node('app-root').innerHTML, '加载中…');
  for (const clip of ['0', 'a%20b', 'true']) assert.equal(run(`?clip=${clip}&conversationId=A`)('app-root').innerHTML, '加载中…');
});

test('detail scrolling writes only the small scroll key and coalesces frames', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const helpers = app.slice(app.indexOf('  function viewStorageKey('), app.indexOf('  function saveView()'));
  const listener = app.slice(app.indexOf('    let scrollFramePending'), app.indexOf("    window.addEventListener('popstate'"));
  const values = new Map([['q:view-data:A', 'large snapshot']]); const writes = []; const handlers = {}; const frames = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } };
  const root = { scrollTop: 27, addEventListener: (name, fn) => { handlers.root = fn; } };
  const context = { bridge: null, storageKey: 'q', state: { id: 'a', conversationId: 'A', settingsOpen: false }, sessionStorage: storage, localStorage: storage, Blob,
    $: () => root, window: { scrollY: 12, addEventListener: (name, fn) => { handlers[name] = fn; }, requestAnimationFrame: fn => frames.push(fn) } };
  runInNewContext(`${helpers}\n${listener}\nthis.readViewScroll = readViewScroll;`, context);
  handlers.scroll(); handlers.root(); assert.equal(frames.length, 1); assert.equal(writes.length, 0); frames[0]();
  assert.deepEqual(writes, ['q:scroll:A', 'q:scroll:A']); assert.equal(values.get('q:view-data:A'), 'large snapshot');
  assert.equal(context.readViewScroll().rootScrollTop, 27); context.state.id = 'b'; assert.equal(context.readViewScroll(), null);
});

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
    t: (key) => key,
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
    t: (key) => key,
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
    t: (key) => key,
    state: { ids: ['a'], title: '', batchStatusFilter: '' }, findState: { open: false, query: '' },
    document: { activeElement: null }, window: { getSelection: () => ({ toString: () => 'unrelated selection' }) },
    $: (id) => id === 'app-root' ? root : id === 'find-input' ? input : null,
    viewRequestSeq: 0, visibleItems: [], visibleSource: '',
    buildScopeQuery: () => '', renderHeader() {}, clearFindStateForLoading() {}, setRefreshing() {}, applyProjectsMeta: (data) => { context.meta = data; },
    requestJson: () => new Promise((resolve) => { resolveBatch = resolve; }),
    cacheItem() {}, saveView() {}, saveViewData() {}, saveViewPaint() {}, bindCardListInteractions() {}, restoreListPosition() {}, renderBatchCard: () => '', esc: String,
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
        t: (key) => key,
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
    renderProjectSelector() {}, handlePendingCopy() {}, isCopyOnlyNavigation: () => false, renderCurrentView: () => renders.push(context.state.activeProjectId),
  };
  runInNewContext(`${section('  function restoreQueue(', '  function discardConflictingRestoredQueue(')}
    ${section('  async function refreshProjectsScope(', '  async function init(')}
    ${section("    window.addEventListener('popstate'", '    if (restoredFromSnapshot) return;')}`, context);
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
    t: (key) => key,
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
  for (const key of ['上一条', '下一条', '已到队尾 · 返回列表']) assert.ok(footer[0].includes(`t('${key}')`));
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

test('copy-only navigation preserves the current view and legacy links still navigate', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  const calls = [];
  const context = {
    URLSearchParams, location: { search: '' }, window: { addEventListener: (_, fn) => { context.navigate = fn; } },
    state: { id: 'old', ids: ['old', 'next'], title: 'batch', project: 'p', repo: '', conversationId: 'c', settingsOpen: true },
    queue: { ids: ['old', 'next'] }, visitedIds: new Set(), viewRequestSeq: 7, scopeRefreshPending: true, initialQueuePending: true,
    t: String, copyText: (...args) => calls.push(['copy', args[0]]), syncUrl: () => calls.push(['sync']),
    parseIds: raw => raw ? raw.split(',') : [], refreshProjectsScope: async () => calls.push(['request']),
    restoreQueue() {}, renderProjectSelector() {}, handlePendingCopy: p => { const target = context.resolveCopyTarget(p); if (target) calls.push(['copy', target]); },
    renderCurrentView: () => calls.push(['render']),
  };
  runInNewContext(`${section('  function resolveCopyTarget(', '  async function writeClipboardViaNative(')}
    this.resolveCopyTarget = resolveCopyTarget; this.isCopyOnlyNavigation = isCopyOnlyNavigation;
    ${section("    window.addEventListener('popstate'", '    if (restoredFromSnapshot) return;')}`, context);
  for (const query of ['?clip=abc', '?clip=abc&token=t&conversationId=c', '?clip=abc&project=other']) assert.equal(context.isCopyOnlyNavigation(new URLSearchParams(query)), true);
  for (const query of ['?id=abc&clip=1', '?ids=a,b&clip=a', '?id=abc', '?clip=1', '']) assert.equal(context.isCopyOnlyNavigation(new URLSearchParams(query)), false);
  for (const view of [{ id: 'old', ids: [], settingsOpen: false }, { id: '', ids: ['old', 'next'], settingsOpen: false }, { id: 'old', ids: [], settingsOpen: true }]) {
    Object.assign(context.state, view);
    const before = JSON.stringify([context.state, context.queue, context.viewRequestSeq, context.scopeRefreshPending, context.initialQueuePending]);
    context.location.search = '?clip=xyz&project=other';
    await context.navigate();
    assert.equal(JSON.stringify([context.state, context.queue, context.viewRequestSeq, context.scopeRefreshPending, context.initialQueuePending]), before);
    assert.deepEqual(calls.splice(0), [['copy', 'xyz'], ['sync']]);
  }
  context.scopeRefreshPending = false;
  context.location.search = '?id=abc&clip=1';
  await context.navigate();
  assert.equal(context.state.id, 'abc');
  assert.deepEqual(calls, [['request'], ['copy', 'abc'], ['render']]);
});

test('copy-only initial navigation restores only the same conversation snapshot', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  for (const saved of [
    { id: 'old', ids: [], settingsOpen: false, conversationId: 'c' },
    { id: '', ids: ['old', 'next'], settingsOpen: false, conversationId: 'c' },
    { id: '', ids: [], settingsOpen: true, conversationId: 'c' },
    { id: 'secret', ids: [], settingsOpen: false, conversationId: 'other' }, null,
  ]) {
    const calls = [];
    const context = { URLSearchParams, bridge: null, initialParams: new URLSearchParams('?clip=xyz&project=other'),
      state: { id: '', ids: [], title: '', project: '', repo: '', settingsOpen: false, conversationId: 'c' },
      queue: { ids: [] }, initialQueuePending: false, storageKey: 'queue',
      sessionStorage: { getItem: () => JSON.stringify(saved) },
      t: String, syncUrl: () => calls.push('sync'), copyText: id => calls.push(id), handlePendingCopy: () => calls.push('legacy'),
      readViewStorage: () => JSON.stringify(saved), viewStorageKey: () => 'key', renderProjectSelector() {}, restoreRenderedSnapshot: () => false, restoredFromSnapshot: false,
    };
    runInNewContext(`${section('  function restoreView(', '  function syncUrl(')}
      ${section('  function resolveCopyTarget(', '  async function writeClipboardViaNative(')}
      (function () { ${section('    if (!bridge && isCopyOnlyNavigation(initialParams)) {', "    try { const data = await requestJson('/api/settings')")} })();`, context);
    const matches = saved && saved.conversationId === 'c';
    assert.equal(context.state.id, matches ? saved.id : '');
    assert.equal(context.state.settingsOpen, matches ? saved.settingsOpen : false);
    assert.deepEqual(Array.from(context.state.ids), matches ? saved.ids : []);
    assert.equal(context.initialQueuePending, Boolean(matches && saved.id && !saved.ids.length));
    if (matches && saved.ids.length) assert.deepEqual(Array.from(context.queue.ids), saved.ids);
    assert.deepEqual(calls, ['sync', 'xyz']);
  }
});


test('view snapshots are isolated by conversation and survive session storage loss', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const local = new Map();
  let session = new Map();
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
  const state = { conversationId: 'A', id: 'a', ids: [], title: '', project: 'p', repo: '', settingsOpen: false, activeProjectId: 'p', projects: [{ id: 'p' }], listStatusFilter: 'open', listQuery: 'needle', batchStatusFilter: 'closed' };
  const context = { state, storageKey: 'q', bridge: null, sessionStorage: storage(session), localStorage: storage(local), Blob, queue: {}, initialQueuePending: false };
  runInNewContext(`${app.slice(app.indexOf('  function viewStorageKey('), app.indexOf('  function syncUrl('))} this.saveView = saveView; this.saveViewData = saveViewData; this.restoreView = restoreView; this.readData = () => JSON.parse(readViewStorage(viewStorageKey('view-data')));`, context);
  context.saveView(); context.saveViewData({ kind: 'detail', data: { id: 'a' } });
  Object.assign(state, { conversationId: 'B', id: 'b', listQuery: 'other' });
  context.saveView(); context.saveViewData({ kind: 'detail', data: { id: 'b' } });
  session = new Map(); context.sessionStorage = storage(session);
  Object.assign(state, { conversationId: 'A', id: '', listQuery: '' });
  context.restoreView();
  assert.equal(state.id, 'a'); assert.equal(state.listQuery, 'needle'); assert.equal(state.activeProjectId, 'p');
  assert.equal(context.readData().data.id, 'a');
  state.conversationId = 'B'; context.restoreView();
  assert.equal(state.id, 'b'); assert.equal(context.readData().data.id, 'b');
});

test('copy-only snapshots synchronously restore each view and reject mismatches', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('  function restoreRenderedSnapshot('), app.indexOf('  async function renderCurrentView('));
  for (const kind of ['detail', 'batch', 'list', 'settings']) {
    const calls = [];
    const state = { id: kind === 'detail' ? 'a' : '', ids: kind === 'batch' ? ['a'] : [], title: kind === 'batch' ? 'batch' : '', project: 'p', repo: '', listStatusFilter: '', listQuery: '', settingsOpen: kind === 'settings' };
    const snapshot = { kind, id: 'a', ids: ['a'], title: 'batch', project: 'p', repo: '', listStatusFilter: '', listQuery: '', data: { items: [] }, scrollY: 12, rootScrollTop: 3 };
    const root = { scrollTop: 0 };
    const context = { state, initialQueuePending: true, initialParams: new URLSearchParams(), detailCache: new Map(), lastDetailId: '',
      readViewStorage: () => JSON.stringify(snapshot), readViewScroll: () => null, viewStorageKey: () => '', cacheKey: id => id,
      $: id => id === 'app-root' ? root : { setAttribute() {} }, window: { scrollTo: (_x, y) => calls.push(['scroll', y]) },
      applyProjectsMeta() {}, rememberItem() {}, restoreQueue() {}, renderHeader() {}, cacheItem() {},
      renderDetailItem: () => calls.push(['detail']), renderBatchViewData: () => calls.push(['batch']),
      renderListViewFromSnapshot: () => calls.push(['list']), renderSettingsContent: () => calls.push(['settings']),
    };
    runInNewContext(`${source} this.restore = restoreRenderedSnapshot;`, context);
    assert.equal(context.restore(), true, kind);
    assert.equal(calls[0][0], kind);
    if (kind === 'detail') { assert.equal(root.scrollTop, 3); assert.deepEqual(calls[1], ['scroll', 12]); }
    snapshot.kind = 'wrong'; assert.equal(context.restore(), false);
  }
});


test('copy-only init restores synchronously and fetches only on a snapshot miss', async () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const init = app.slice(app.indexOf('  async function init()'), app.indexOf('  init().catch('));
  const restore = app.slice(app.indexOf('  function restoreRenderedSnapshot('), app.indexOf('  async function renderCurrentView('));
  for (const kind of ['detail', 'batch', 'list', 'settings', 'missing']) {
    const calls = [];
    const nodes = new Map();
    const node = id => {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', scrollTop: 0, value: '', setAttribute() {}, addEventListener() {}, classList: { toggle() {} } });
      return nodes.get(id);
    };
    const state = { id: kind === 'detail' ? 'a' : '', ids: kind === 'batch' ? ['a'] : [], title: kind === 'batch' ? 'batch' : '', project: 'p', repo: '', listStatusFilter: '', listQuery: '', settingsOpen: kind === 'settings' };
    const snapshot = kind === 'missing' ? null : { kind, id: 'a', ids: ['a'], title: 'batch', project: 'p', repo: '', listStatusFilter: '', listQuery: '', data: { items: [] } };
    const context = { state, bridge: null, initialParams: new URLSearchParams('?clip=a'), $: node, initialQueuePending: false, detailCache: new Map(),
      window: { addEventListener() {}, scrollTo() {} }, findState: {}, readViewStorage: () => JSON.stringify(snapshot), readViewScroll: () => null, viewStorageKey: () => '', cacheKey: id => id,
      t: String, applyLocale() {}, requestJson: async () => ({ settings: {}, path: '' }), isCopyOnlyNavigation: () => true, resolveCopyTarget: () => 'a', restoreView() {}, syncUrl() {}, renderProjectSelector() {}, copyText() {},
      applyProjectsMeta() {}, rememberItem() {}, restoreQueue() {}, renderHeader() {}, cacheItem() {},
      renderDetailItem: () => calls.push('detail'), renderBatchViewData: () => calls.push('batch'), renderListViewFromSnapshot: () => calls.push('list'), renderSettingsContent: () => calls.push('settings'),
      renderCurrentView: () => calls.push('fetch'),
    };
    runInNewContext(`${restore}\n${init}\nthis.start = init;`, context);
    const started = context.start();
    assert.deepEqual(calls, kind === 'missing' ? [] : [kind]);
    assert.doesNotMatch(node('app-root').innerHTML, /加载中|正在读取|skeleton/);
    await started;
    assert.deepEqual(calls, [kind === 'missing' ? 'fetch' : kind]);
  }
});
