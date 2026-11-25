(() => {
  const formatBeadNotesForDisplay = window.__tasksUiExt?.formatNotes ||
    window.__tasksNotesFormat?.formatBeadNotesForDisplay ||
    ((notes) => typeof notes === 'string' ? notes.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '') : '');
  const inPageSearch = window.__tasksInPageSearch || {
    MAX_FIND_MARKS: 2000,
    normalizeFindQuery: (raw) => String(raw ?? '').trim(),
    splitTextByMatches: (text) => ({ segments: text ? [{ text: String(text), matched: false }] : [], truncated: false }),
    nextMatchIndex: (cur, total, delta = 1) => {
      if (!total || total <= 0) return -1;
      if (cur < 0 || cur >= total) return delta < 0 ? total - 1 : 0;
      return (((cur + delta) % total) + total) % total;
    },
    shouldHandleFindShortcut: () => null,
  };
  const {
    MAX_FIND_MARKS,
    normalizeFindQuery,
    splitTextByMatches,
    nextMatchIndex,
    shouldHandleFindShortcut,
  } = inPageSearch;
  const $ = (id) => document.getElementById(id);
  const bridge = window.__tasksMcpBridge;
  const ext = window.__tasksUiExt || {};
  if (window.__tasksUiConfig?.title) { document.title = window.__tasksUiConfig.title; $('view-title').textContent = window.__tasksUiConfig.title; }
  const apiFetch = bridge ? bridge.fetch.bind(bridge) : window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;

  // Shared project color palette
  const PROJECT_COLORS = [
    '#5b9dff',
    '#f0a44a',
    '#5fd0a6',
    '#d879e3',
    '#f26d6d',
    '#4fc4d8',
    '#b7c95b',
    '#a991f7',
  ];

  const INLINE_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
  const initialParams = new URLSearchParams(location.search);
  const state = {
    id: (initialParams.get('id') || '').trim(),
    ids: parseIds(initialParams.get('ids')),
    title: (initialParams.get('title') || '').trim(),
    repo: (initialParams.get('repo') || '').trim(),
    project: (initialParams.get('project') || '').trim(),
    conversationId: window.sidecar?.conversationId || initialParams.get('conversationId') || '',
    projects: [],
    activeProjectId: '',
    batchStatusFilter: '',
    mcpInline: false,
    inlineExpandedDetail: false,
    inlineOrigin: null,
    inlineSource: null,
    inlineSearchOpen: false,
    inlineSearchValue: '',
    inlineContextAttached: false,
    listStatusFilter: '',
    listQuery: '',
    busy: false,
    settingsOpen: false,
    settings: { version: 1, emitSidecarLinks: true },
    settingsPath: '',
  };

  const { queueNeighbors, shouldHandleQueueShortcut, shouldRestoreSavedQueue } = window.__tasksReviewQueue;
  const storageKey = window.__tasksUiConfig?.storageKey || 'beads-tasks-review-queue';
  let queue = { ids: [], metaById: {}, source: 'batch', title: '', project: '', repo: '', visitedIds: [] };
  const visitedIds = new Set();
  const detailCache = new Map();
  const inflightItemRequests = new Map();
  const cacheVersions = new Map();
  let detailRequestSeq = 0;
  let viewRequestSeq = 0;
  let scopeRefreshPending = false;
  let initialQueuePending = !initialParams.has('ids') && Boolean(state.id);
  let restoredQueue = null;
  let restoredQueueProject = '';
  let lastDetailId = '';
  let listPosition = null;
  let lastViewedId = '';
  let restorePosition = false;
  let visibleItems = [];
  let visibleSource = '';

  function saveQueue() {
    queue.visitedIds = [...visitedIds];
    queue.conversationId = state.conversationId;
    queue.activeProjectId = state.activeProjectId;
    if (bridge) { void bridge.saveReviewQueue(queue).catch(() => {}); return; }
    try { sessionStorage.setItem(storageKey, JSON.stringify(queue)); } catch { /* storage may be unavailable */ }
  }

  function restoreQueue(params) {
    let saved;
    if (typeof bridge !== 'undefined' && bridge) saved = restoredQueue;
    else { try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch { return; } }
    if (!params.has('ids') && shouldRestoreSavedQueue(saved, { id: state.id, project: state.project, repo: state.repo, conversationId: state.conversationId, activeProjectId: state.activeProjectId })) {
      queue = saved;
      restoredQueue = saved;
      restoredQueueProject = saved.project || saved.activeProjectId || '';
      if (saved.source === 'batch') state.ids = saved.batchIds || saved.ids;
      state.title = saved.title || '';
      for (const id of saved.visitedIds || []) visitedIds.add(id);
    }
  }

  function discardConflictingRestoredQueue(data) {
    if (queue !== restoredQueue || !restoredQueue) return false;
    const queueProject = restoredQueueProject;
    const detailProject = data.project?.id;
    if (!queueProject || !detailProject || queueProject === detailProject) return false;
    queue = { ids: [], metaById: {}, source: 'list', visitedIds: [] };
    restoredQueue = null;
    state.ids = [];
    state.title = '';
    visitedIds.clear();
    try { sessionStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
    return true;
  }

  function cacheKey(id) { return `${state.conversationId}::${state.project}::${state.activeProjectId}::${state.repo}::${id}`; }
  function rememberItem(item) {
    const task = item.taskDetail?.task || item.relatedTasks?.[0] || item.task;
    queue.metaById[item.id] = { id: item.id, title: item.bead?.title || item.title || task?.title || item.id, status: item.bead?.status || item.status || task?.status || '', priority: item.bead?.priority ?? item.priority ?? null };
  }
  function cacheItem(item, key = cacheKey(item.id)) {
    detailCache.set(key, { data: item, fetchedAt: Date.now() });
    rememberItem(item);
  }
  function fetchDetail(id, force = false) {
    const key = cacheKey(id);
    if (!force && inflightItemRequests.has(key)) return inflightItemRequests.get(key);
    if (force) cacheVersions.set(key, (cacheVersions.get(key) || 0) + 1);
    const version = cacheVersions.get(key) || 0;
    const request = requestJson(`/api/item?${buildScopeQuery({ id, force: force ? 1 : '' })}`).then((data) => {
      if ((cacheVersions.get(key) || 0) === version) detailCache.set(key, { data, fetchedAt: Date.now() });
      return data;
    }).finally(() => { if (inflightItemRequests.get(key) === request) inflightItemRequests.delete(key); });
    inflightItemRequests.set(key, request);
    return request;
  }
  function prefetchNeighbors(id) {
    const { prev, next } = queueNeighbors(id, queue);
    for (const neighbor of [prev, next]) {
      if (!neighbor) continue;
      const cached = detailCache.get(cacheKey(neighbor));
      if (!cached || Date.now() - cached.fetchedAt >= 30000) void fetchDetail(neighbor).catch(() => {});
    }
  }
  function activateQueue(items, source) {
    const ids = items.map((item) => item.id);
    queue = { ids, metaById: {}, source, title: state.title, project: state.project, repo: state.repo, batchIds: source === 'batch' ? [...state.ids] : [], visitedIds: [...visitedIds] };
    items.forEach(rememberItem);
    saveQueue();
  }
  function openFromList(id) {
    const visibleIds = new Set([...$('app-root').querySelectorAll('.task-card:not(.find-card-hidden)')].map((card) => card.dataset.openId));
    const items = visibleItems.filter((item) => visibleIds.has(item.id));
    if (!items.length) return;
    listPosition = { windowY: window.scrollY, rootY: $('app-root').scrollTop };
    activateQueue(items, visibleSource);
    jumpToItem(id || items.find((item) => !visitedIds.has(item.id))?.id || items[0].id);
  }
  function jumpToItem(id) {
    if (!id) return;
    state.id = id;
    syncUrl();
    void renderCurrentView();
  }
  function backToList() {
    lastViewedId = state.id;
    state.id = '';
    if (queue.source === 'list') state.ids = [];
    else if (queue.batchIds?.length) state.ids = [...queue.batchIds];
    restorePosition = true;
    syncUrl();
    void renderCurrentView();
  }
  function restoreListPosition() {
    if (!restorePosition) return;
    restorePosition = false;
    const card = [...$('app-root').querySelectorAll('[data-open-id]')].find((el) => el.dataset.openId === lastViewedId);
    if (card) {
      card.classList.add('is-last-viewed');
      setTimeout(() => card.classList.remove('is-last-viewed'), 2200);
    }
    if (listPosition) {
      $('app-root').scrollTop = listPosition.rootY;
      window.scrollTo(0, listPosition.windowY);
    }
    card?.scrollIntoView({ block: 'nearest' });
  }
  if (state.ids.length) queue = { ...queue, ids: [...state.ids], batchIds: [...state.ids], title: state.title, project: state.project, repo: state.repo };

  const findState = {
    open: false,
    query: '',
    filterCards: false,
    marks: [],
    activeIndex: -1,
    truncated: false,
    composing: false,
  };

  function parseIds(raw) {
    if (!raw) return [];
    const seen = new Set();
    const out = [];
    for (const part of String(raw).split(',')) {
      const s = part.trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function esc(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function projectColorFor(projectId) {
    const id = String(projectId ?? '');
    if (!id) return PROJECT_COLORS[0];
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) % 1000003;
    }
    return PROJECT_COLORS[hash % PROJECT_COLORS.length];
  }

  function statusClass(status) {
    const s = String(status || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `st-${s || 'unknown'}`;
  }

  function eventToneClass(val) {
    const s = String(val || '').toLowerCase();
    if (['working', 'running', 'dispatching', 'in_progress', 'active'].includes(s)) return 'ev-working';
    if (['blocked', 'needs_human', 'waiting_approval', 'action', 'deferred'].includes(s)) return 'ev-warn';
    if (['done', 'closed', 'review', 'approved'].includes(s)) return 'ev-ok';
    if (['failed', 'error', 'cancelled', 'invalid'].includes(s)) return 'ev-err';
    return 'ev-muted';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function formatShortTime(iso) {
    if (!iso) return '';
    const ms = typeof iso === 'number' ? (iso > 1e12 ? iso : iso * 1000) : Date.parse(String(iso));
    if (Number.isNaN(ms)) return String(iso);
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatElapsed(iso) {
    if (!iso) return '';
    const ms = typeof iso === 'number' ? (iso > 1e12 ? iso : iso * 1000) : Date.parse(String(iso));
    if (Number.isNaN(ms)) return '';
    const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ${min % 60}m`;
    return `${Math.floor(hr / 24)}d ${hr % 24}h`;
  }

  function sanitizeLinkUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (/^(https?:\/\/|sidecar:\/\/)/i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  function formatInlineMarkdown(escapedText) {
    const codeTokens = [];
    let out = escapedText.replace(/`([^`\n]+)`/g, (_m, code) => {
      const idx = codeTokens.length;
      codeTokens.push(`<code>${code}</code>`);
      return `@@INLINE_CODE_${idx}@@`;
    });

    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, rawHref) => {
      const unescapedHref = rawHref
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const safe = sanitizeLinkUrl(unescapedHref);
      if (!safe) return `${label} (${rawHref})`;
      return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

    out = out.replace(/@@INLINE_CODE_(\d+)@@/g, (_m, idx) => codeTokens[Number(idx)] ?? '');
    return out;
  }

  function renderMarkdown(raw) {
    const src = String(raw ?? '').replace(/\r\n?/g, '\n');
    if (!src.trim()) return '';

    const codeBlocks = [];
    const tokenized = src.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = codeBlocks.length;
      const cls = lang ? ` class="lang-${esc(lang)}"` : '';
      codeBlocks.push(`<pre><code${cls}>${esc(code.replace(/\n$/, ''))}</code></pre>`);
      return `\n@@CODE_BLOCK_${idx}@@\n`;
    });

    const lines = tokenized.split('\n');
    const html = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      const blockMatch = /^@@CODE_BLOCK_(\d+)@@$/.exec(trimmed);
      if (blockMatch) {
        html.push(codeBlocks[Number(blockMatch[1])] || '');
        i += 1;
        continue;
      }

      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        html.push('<hr />');
        i += 1;
        continue;
      }

      const hMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (hMatch) {
        const level = hMatch[1].length;
        html.push(`<h${level}>${formatInlineMarkdown(esc(hMatch[2]))}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quoteLines.push(formatInlineMarkdown(esc(lines[i].trim().replace(/^>\s?/, ''))));
          i += 1;
        }
        html.push(`<blockquote>${quoteLines.join('<br />')}</blockquote>`);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(`<li>${formatInlineMarkdown(esc(lines[i].trim().replace(/^[-*]\s+/, '')))}</li>`);
          i += 1;
        }
        html.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(`<li>${formatInlineMarkdown(esc(lines[i].trim().replace(/^\d+\.\s+/, '')))}</li>`);
          i += 1;
        }
        html.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      const paraLines = [];
      while (i < lines.length) {
        const cur = lines[i];
        const curTrim = cur.trim();
        if (
          !curTrim ||
          /^@@CODE_BLOCK_(\d+)@@$/.test(curTrim) ||
          /^(-{3,}|\*{3,})$/.test(curTrim) ||
          /^(#{1,4})\s+/.test(curTrim) ||
          /^>\s?/.test(curTrim) ||
          /^[-*]\s+/.test(curTrim) ||
          /^\d+\.\s+/.test(curTrim)
        ) {
          break;
        }
        paraLines.push(formatInlineMarkdown(esc(cur)));
        i += 1;
      }
      if (paraLines.length) {
        html.push(`<p>${paraLines.join('<br />')}</p>`);
      }
    }

    return html.join('');
  }

  function buildScopeQuery(extra = {}) {
    const q = new URLSearchParams();
    if (state.conversationId) q.set('conversationId', state.conversationId);
    if (state.project) q.set('project', state.project);
    else if (state.repo) q.set('repo', state.repo);
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && String(v) !== '') {
        q.set(k, String(v));
      }
    }
    return q.toString();
  }

  function syncUrl() {
    if (bridge) return;
    const q = new URLSearchParams();
    if (state.id) q.set('id', state.id);
    if (state.ids.length && !(state.id && queue.ids.includes(state.id))) q.set('ids', state.ids.join(','));
    if (state.title) q.set('title', state.title);
    if (state.project) q.set('project', state.project);
    if (state.repo) q.set('repo', state.repo);
    const search = q.toString();
    history.replaceState(null, '', search ? `${location.pathname}?${search}` : location.pathname);
  }

  function setRefreshing(active) {
    const btn = $('btn-refresh');
    const icon = btn?.querySelector('.btn-icon');
    if (icon) {
      icon.classList.toggle('is-spinning', Boolean(active));
    }
  }

  let toastTimer = null;
  function showToast(msg, kind = 'ok') {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast ${kind === 'err' ? 'toast-err' : 'toast-ok'}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast hidden';
    }, 3500);
  }

  async function requestJson(url, options = {}) {
    const res = await apiFetch(url, options);
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || parsed?.ok === false) {
      const err = new Error(parsed?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = parsed;
      throw err;
    }
    return parsed;
  }

  async function postJson(url, body) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.conversationId,
        project: state.project,
        repo: state.repo,
        ...body,
      }),
    });
  }

  function resolveCopyTarget(params) {
    const raw = (params.get('clip') || params.get('copy') || params.get('©') || '').trim();
    if (!raw) return '';
    if (raw === '1' || raw.toLowerCase() === 'true') {
      return (params.get('id') || '').trim();
    }
    if (/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(raw)) {
      return raw;
    }
    return '';
  }

  async function writeClipboardViaNative(text) {
    await postJson('/api/clipboard', { text });
  }

  async function copyText(text, triggerEl = null, label = '已复制', options = {}) {
    if (!text) return false;
    const preferNative = Boolean(options?.preferNative);
    const channels = preferNative
      ? [() => writeClipboardViaNative(text), () => navigator.clipboard.writeText(text)]
      : [() => navigator.clipboard.writeText(text), () => writeClipboardViaNative(text)];

    let copied = false;
    const errors = [];
    for (const writeFn of channels) {
      try {
        await writeFn();
        copied = true;
        break;
      } catch (err) {
        errors.push(err?.message || String(err));
      }
    }

    if (!copied) {
      console.error('[tasks] clipboard copy failed:', errors);
      showToast('复制失败，请手动选中复制', 'err');
      return false;
    }

    showToast(`${label}: ${text.length > 72 ? `${text.slice(0, 69)}…` : text}`, 'ok');
    if (triggerEl) {
      if (!triggerEl.dataset.origHtml) {
        const clone = triggerEl.cloneNode(true);
        for (const m of clone.querySelectorAll('mark.find-mark')) {
          m.replaceWith(document.createTextNode(m.textContent || ''));
        }
        clone.normalize();
        triggerEl.dataset.origHtml = clone.innerHTML;
      }
      if (triggerEl._copyTimer) clearTimeout(triggerEl._copyTimer);
      const origText = triggerEl.textContent.trim();
      if (origText.endsWith('⎘')) {
        triggerEl.textContent = origText.replace(/⎘$/, '✓');
      } else {
        triggerEl.textContent = '✓';
      }
      triggerEl._copyTimer = setTimeout(() => {
        if (triggerEl.isConnected && triggerEl.dataset.origHtml) {
          triggerEl.innerHTML = triggerEl.dataset.origHtml;
        }
      }, 1500);
    }
    return true;
  }

  function renderProjectSelector() {
    const sel = $('project-select');
    if (!state.projects.length) {
      sel.innerHTML = '<option value="">默认项目</option>';
      return;
    }
    const current = state.project || state.activeProjectId || state.projects[0]?.id || '';
    sel.innerHTML = state.projects
      .map((p) => `<option value="${esc(p.id)}" ${p.id === current ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
  }

  function applyProjectsMeta(meta) {
    if (!Array.isArray(meta?.projects)) return;
    state.projects = meta.projects;
    state.activeProjectId = meta.activeProjectId || '';
    renderProjectSelector();
  }

  function renderProjectBadge(projectInfo) {
    if (!projectInfo?.name) return '';
    const color = projectColorFor(projectInfo.id || projectInfo.name);
    return `<span class="badge project-chip" style="--proj-color:${esc(color)}"><span class="project-dot"></span>${esc(projectInfo.name)}</span>`;
  }

  function renderStatusBadge(status, extraText = '') {
    const label = extraText || status || 'unknown';
    return `<span class="badge ${statusClass(status)}"><span class="status-dot"></span>${esc(label)}</span>`;
  }

  function renderPriorityBadge(priority) {
    if (priority === null || priority === undefined || priority === '') return '';
    const n = Number(priority);
    const cls = Number.isInteger(n) && n >= 0 && n <= 4 ? `prio-${n}` : 'prio-3';
    return `<span class="badge ${cls}">P${esc(priority)}</span>`;
  }

  function labelClass(lbl) {
    const s = String(lbl || '');
    const extensionClass = ext.classifyLabel?.(s);
    if (extensionClass) return extensionClass;
    if (s === 'needs-review') return 'lbl-review';
    if (s.startsWith('env:')) return 'lbl-env';
    if (s === 'ephemeral' || s === 'wip') return 'lbl-ephemeral';
    return 'lbl-default';
  }

  function buildCardChips(labels = [], options = {}) {
    const chips = options.projectInfo?.name ? [renderProjectBadge(options.projectInfo)] : [];
    const result = ext.buildExtraChips?.({ labels, ...options }, { esc }) || {};
    chips.push(...(result.chips || []));
    for (const label of result.labels || labels) chips.push(`<span class="chip ${labelClass(label)}">${esc(label)}</span>`);
    return chips.join('');
  }

  function renderHeader(titleText, projectInfo) {
    $('view-title').textContent = titleText || 'Tasks';
    const badge = $('project-badge');
    const sel = $('project-select');
    const selectedName = sel.selectedOptions[0]?.textContent;
    if (projectInfo?.name && projectInfo.id !== sel.value && projectInfo.name !== selectedName) {
      const color = projectColorFor(projectInfo.id || projectInfo.name);
      badge.style.setProperty('--proj-color', color);
      badge.innerHTML = `<span class="project-dot"></span>${esc(projectInfo.name)}`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const batchNav = $('batch-nav');
    if (state.id && queue.ids.includes(state.id)) {
      const { index, total, prev, next, visitedCount } = queueNeighbors(state.id, queue);
      batchNav.classList.remove('hidden');
      batchNav.innerHTML = `
        <div class="queue-head"><div class="batch-nav-group">
          <button type="button" class="btn btn-xs" id="btn-back-batch">← ${queue.source === 'list' ? '总览' : '列表'} (${total})</button>
          <span class="muted">${index + 1} / ${total} · 已看 ${visitedCount}</span>
        </div><div class="batch-nav-group">
          <button type="button" class="btn btn-xs" id="btn-prev-item" title="← / [" ${prev ? '' : 'disabled'}>‹ 上一条</button>
          <button type="button" class="btn btn-xs" id="btn-next-item" title="→ / ]" ${next ? '' : 'disabled'}>下一条 ›</button>
        </div></div>
        <div class="queue-rail">${queue.ids.map((id) => `<button type="button" class="btn btn-xs mono ${id === state.id ? 'is-active' : visitedIds.has(id) ? 'is-visited' : ''}" data-queue-id="${esc(id)}" title="${esc(queue.metaById?.[id]?.title || id)}">${id === state.id ? '● ' : visitedIds.has(id) ? '✓ ' : ''}${esc(id.length > 20 ? `${id.slice(0, 17)}…` : id)}</button>`).join('')}</div>`;
      $('btn-back-batch').onclick = backToList;
      $('btn-prev-item').onclick = () => jumpToItem(prev);
      $('btn-next-item').onclick = () => jumpToItem(next);
      for (const btn of batchNav.querySelectorAll('[data-queue-id]')) btn.onclick = () => jumpToItem(btn.dataset.queueId);
      batchNav.querySelector('.queue-rail .is-active')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    } else {
      batchNav.classList.add('hidden');
      batchNav.innerHTML = '';
    }
  }

  function renderCardIdBadges({ beadId = '', taskId = '', fallbackId = '' }) {
    const badges = [];
    if (beadId) {
      badges.push(`<button type="button" class="id-badge" data-copy="${esc(beadId)}" title="点击复制 Bead ID">${esc(beadId)} ⎘</button>`);
    }
    if (taskId) {
      const label = beadId ? `#${taskId.slice(0, 8)}` : `#${taskId}`;
      badges.push(`<button type="button" class="id-badge-task" data-copy="${esc(taskId)}" title="点击复制 Task ID">${esc(label)} ⎘</button>`);
    }
    if (!badges.length && fallbackId) {
      badges.push(`<button type="button" class="id-badge" data-copy="${esc(fallbackId)}" title="点击复制 ID">${esc(fallbackId)} ⎘</button>`);
    }
    return badges.join('');
  }

  function bindCardListInteractions(container) {
    if (!container) return;
    for (const btn of container.querySelectorAll('[data-copy]')) {
      btn.onclick = (e) => {
        e.stopPropagation();
        copyText(btn.getAttribute('data-copy') || '', btn);
      };
    }
    const openCard = (card) => {
      openFromList(card.getAttribute('data-open-id') || '');
    };
    for (const card of container.querySelectorAll('[data-open-id]')) {
      card.onclick = (e) => {
        if (e.target?.closest?.('[data-copy]')) return;
        openCard(card);
      };
      card.onkeydown = (e) => {
        if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openCard(card);
        }
      };
    }
  }

  function inlineParts(item) {
    const bead = item.bead || {};
    const detail = item.taskDetail || {};
    const task = detail.task || item.relatedTasks?.[0] || item.task || {};
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    const total = steps.length || task.steps_total || 0;
    const done = steps.length ? steps.filter((step) => step.status === 'done').length : (task.steps_done || 0);
    const current = steps.find((step) => ['running', 'waiting_approval', 'needs_human', 'failed'].includes(step.status));
    return { bead, detail, task, steps, total, done, current, id: item.id || bead.id || task.id || '', title: bead.title || task.title || item.title || '(无标题)' };
  }

  function buildTaskContextSummary(item) {
    const { bead, task, steps, id, title } = inlineParts(item);
    const truncate = (value, limit, suffix) => typeof value === 'string' && value.length > limit ? `${value.slice(0, limit)}${suffix}` : value;
    return [
      `## ${id}: ${title}`,
      `状态: ${bead.status || task.status || 'unknown'} · 优先级: ${bead.priority ?? 'unknown'}`,
      bead.description && `### 描述\n${truncate(bead.description, 800, '…（完整内容请查看任务详情）')}`,
      bead.acceptance_criteria && `### 验收标准\n${truncate(bead.acceptance_criteria, 500, '…')}`,
      ...(ext.buildConversationPromptExtras?.(item, { inlineParts }) || []),
    ].filter(Boolean).join('\n\n');
  }

  function inlineSummary(item) {
    return buildTaskContextSummary(item);
  }

  function inlinePreview(item) {
    const { bead } = inlineParts(item);
    const description = bead.description || item.summary || '';
    return `${description ? `<div class="inline-description">${esc(description)}</div>` : ''}${ext.renderInlineMeta?.(item, { inlineParts, esc, renderStatusBadge }) || ''}`;
  }

  function inlineActions(container, item, { fullLink = false } = {}) {
    const caps = bridge.getHostCapabilities() || {};
    const add = (label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs';
      button.textContent = label;
      button.onclick = async (event) => {
        event.stopPropagation();
        try { const result = await action(); if (result !== false) showToast(result?.conversationId ? `已新开后台会话 (${result.conversationId})` : '操作成功'); }
        catch (err) { showToast(err.message, 'err'); }
      };
      container.append(button);
    };
    if (caps.updateModelContext) {
      add('附到对话', async () => { await bridge.updateModelContext(inlineSummary(item)); state.inlineContextAttached = true; renderActions(); return false; });
      if (state.inlineContextAttached) add('清除上下文', async () => { await bridge.clearModelContext(); state.inlineContextAttached = false; renderActions(); return false; });
    }
    if (caps.message) {
      add('发到当前对话', () => bridge.sendMessage(`请继续处理任务：\n${inlineSummary(item)}`));
      add('新开会话', () => bridge.sendMessage(`请继续处理任务：\n${inlineSummary(item)}`, { newConversation: true }));
    }
    ext.collectInlineActions?.(item, { inlineParts, bridge, fullLink, add });
    add(fullLink ? '在卡片内看完整详情' : '展开完整详情', () => {
      if (!state.id) state.inlineSource = inlineSnapshot();
      state.id = item.id;
      state.inlineExpandedDetail = true;
      if (fullLink) void renderCurrentView({ force: true });
      else renderDetailItem(item);
      return false;
    });
    function renderActions() { container.replaceChildren(); inlineActions(container, item, { fullLink }); }
  }

  function inlineLine(item) {
    const { bead, task, id, title } = inlineParts(item);
    return `${renderStatusBadge(bead.status || task.status || item.status || 'unknown')}${renderPriorityBadge(bead.priority ?? item.priority)}<span class="inline-id mono">${esc(id)}</span><button type="button" class="btn btn-xs inline-copy" data-copy="${esc(id)}" aria-label="复制 ID" title="复制 ID">⎘</button><span class="inline-title" title="${esc(title)}">${esc(title)}</span>${ext.renderInlineProgress?.(item, { inlineParts }) || ''}`;
  }

  function bindInlineCopy(root) {
    for (const button of root.querySelectorAll('[data-copy]')) button.onclick = (event) => { event.stopPropagation(); copyText(button.dataset.copy, button); };
  }

  function inlineSnapshot() {
    return { view: state.id ? 'detail' : state.ids.length ? 'batch' : 'list', id: state.id, ids: [...state.ids], title: state.title, status: state.listStatusFilter, query: state.listQuery };
  }

  function restoreInlineView(snapshot) {
    if (!snapshot) return;
    state.id = snapshot.id || '';
    state.ids = [...snapshot.ids];
    state.title = snapshot.title;
    state.listStatusFilter = snapshot.status;
    state.listQuery = snapshot.query;
    state.inlineSearchValue = snapshot.query;
    state.inlineSearchOpen = false;
    state.inlineExpandedDetail = false;
    state.inlineSource = null;
    void renderCurrentView();
  }

  function inlineControls() {
    const current = inlineSnapshot();
    const origin = state.inlineOrigin;
    const changed = origin && (current.view !== origin.view || current.id !== origin.id || current.ids.join('\n') !== origin.ids.join('\n') || (current.view === 'list' && (current.status !== origin.status || current.query !== origin.query)));
    return `<div class="inline-controls">${changed ? '<button type="button" class="btn btn-xs inline-back">← 返回</button>' : ''}${current.view !== 'list' ? '<button type="button" class="btn btn-xs inline-show-list">列表</button>' : ''}<button type="button" class="btn btn-xs inline-search-toggle" title="搜索 / 直达 Beads ID" aria-label="搜索 / 直达 Beads ID">🔍</button><button type="button" class="btn btn-xs inline-refresh" title="刷新" aria-label="刷新">↻</button></div>`;
  }

  function inlineSearchBar() {
    const visible = state.inlineSearchOpen || (!state.id && !state.ids.length && state.listQuery);
    return `<div class="inline-search-bar${visible ? '' : ' hidden'}"><input class="inline-search-input" type="search" placeholder="输入 Beads ID 直达，或关键词搜索…" value="${esc(state.inlineSearchValue)}" /><button type="button" class="btn btn-xs inline-search-submit">打开/搜索</button><button type="button" class="btn btn-xs inline-search-list">搜列表</button><button type="button" class="btn btn-xs inline-search-close" aria-label="关闭搜索">×</button></div>`;
  }

  function bindInlineControls(root) {
    const bar = root.querySelector('.inline-search-bar');
    const input = bar.querySelector('input');
    const submit = bar.querySelector('.inline-search-submit');
    const listSearch = (q) => {
      state.id = ''; state.ids = []; state.listQuery = q; state.inlineSearchValue = q;
      state.inlineExpandedDetail = false; state.inlineSearchOpen = false;
      void renderCurrentView();
    };
    const close = () => {
      state.inlineSearchOpen = false;
      if (!state.id && !state.ids.length && state.listQuery) listSearch('');
      else bar.classList.add('hidden');
    };
    root.querySelector('.inline-back')?.addEventListener('click', () => restoreInlineView(state.inlineOrigin));
    root.querySelector('.inline-show-list')?.addEventListener('click', () => {
      state.id = ''; state.ids = []; state.inlineExpandedDetail = false; state.inlineSearchOpen = false;
      void renderCurrentView();
    });
    root.querySelector('.inline-refresh').onclick = () => renderCurrentView({ force: true });
    root.querySelector('.inline-search-toggle').onclick = () => {
      if (!bar.classList.contains('hidden')) { close(); return; }
      state.inlineSearchOpen = true; bar.classList.remove('hidden'); input.focus();
    };
    input.oninput = () => { state.inlineSearchValue = input.value; };
    bar.querySelector('.inline-search-close').onclick = close;
    bar.querySelector('.inline-search-list').onclick = () => listSearch(input.value.trim());
    submit.onclick = async () => {
      const q = input.value.trim();
      if (!q) {
        if (!state.id && !state.ids.length) listSearch('');
        else showToast('请输入 ID 或关键词', 'err');
        return;
      }
      if (!INLINE_ID_RE.test(q)) { listSearch(q); return; }
      submit.disabled = true;
      const seq = viewRequestSeq;
      try {
        const data = await requestJson(`/api/item?${buildScopeQuery({ id: q })}`);
        if (seq !== viewRequestSeq) return;
        if (data && data.ok !== false && (data.bead || data.taskDetail || data.relatedTasks?.length)) {
          detailCache.set(cacheKey(q), { data, fetchedAt: Date.now() });
          if (!state.id) state.inlineSource = inlineSnapshot();
          state.id = q; state.ids = []; state.inlineExpandedDetail = false; state.inlineSearchOpen = false;
          void renderCurrentView();
          return;
        }
      } catch (err) {
        if (seq !== viewRequestSeq) return;
        if (err.status !== 404 && err.data?.ok !== false) { showToast(err.message, 'err'); return; }
      } finally { submit.disabled = false; }
      listSearch(q);
      showToast('未找到精确 ID，已按关键词搜索列表');
    };
    input.onkeydown = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); if (!submit.disabled) void submit.onclick(); }
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };
    if (state.inlineSearchOpen) input.focus();
  }

  function inlineRows(items) {
    return `<div class="inline-list">${items.length ? items.map((item, index) => `<div class="inline-row-wrap"><div class="inline-row" role="button" tabindex="0" aria-expanded="false" data-index="${index}">${inlineLine(item)}</div><div class="inline-row-expand hidden">${inlinePreview(item)}<div class="inline-actions"></div></div></div>`).join('') : '<div class="empty-state">没有匹配的任务</div>'}</div>`;
  }

  function bindInlineRows(root, items) {
    bindInlineCopy(root);
    for (const row of root.querySelectorAll('.inline-row')) {
      const item = items[Number(row.dataset.index)];
      const expand = row.nextElementSibling;
      const actions = expand.querySelector('.inline-actions');
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'btn btn-xs'; open.textContent = '打开单卡';
      open.onclick = () => { state.inlineSource = inlineSnapshot(); state.id = item.id; state.ids = []; state.inlineExpandedDetail = false; void renderCurrentView(); };
      actions.append(open);
      inlineActions(actions, item, { fullLink: true });
      const toggle = () => { expand.classList.toggle('hidden'); row.setAttribute('aria-expanded', String(!expand.classList.contains('hidden'))); };
      row.onclick = toggle;
      row.onkeydown = (event) => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(); } };
    }
  }

  function renderInlineCard(item) {
    const root = $('app-root');
    root.innerHTML = `<section class="inline-card"><div class="inline-card-line">${inlineLine(item)}${inlineControls()}</div>${inlineSearchBar()}${inlinePreview(item)}<div class="inline-actions"></div></section>`;
    bindInlineCopy(root);
    bindInlineControls(root);
    inlineActions(root.querySelector('.inline-actions'), item);
  }

  function renderInlineBatch(data) {
    const root = $('app-root');
    const counts = Object.entries(data.counts || {}).filter(([key, value]) => !['total', 'found'].includes(key) && typeof value === 'number' && value > 0);
    root.innerHTML = `<div class="inline-header"><strong>${esc(state.title || '本轮任务')}</strong><span class="badge chip-neutral">${esc(data.counts?.total ?? data.items.length)}</span>${counts.map(([key, value]) => `<span class="badge chip-neutral">${esc(key)} ${value}</span>`).join('')}${inlineControls()}</div>${inlineSearchBar()}${inlineRows(data.items)}${data.missing?.length ? `<div class="inline-meta">未找到: ${data.missing.map((item) => esc(item.id)).join(', ')}</div>` : ''}`;
    bindInlineControls(root);
    bindInlineRows(root, data.items);
  }

  function renderInlineList(data) {
    const root = $('app-root');
    const items = data.items || [];
    const statuses = ['', 'open', 'in_progress', 'blocked', 'closed'];
    root.innerHTML = `<div class="inline-header"><strong>任务列表</strong><span class="badge chip-neutral">${esc(data.total ?? data.counts?.total ?? items.length)}</span>${inlineControls()}</div>${inlineSearchBar()}<div class="inline-filters">${statuses.map((status) => `<button type="button" class="btn btn-xs ${state.listStatusFilter === status ? 'active' : ''}" data-inline-status="${status}">${status || '全部'}</button>`).join('')}${state.listQuery ? `<button type="button" class="btn btn-xs inline-clear-query">${esc(state.listQuery)} ×</button>` : ''}</div>${inlineRows(items)}`;
    bindInlineControls(root);
    bindInlineRows(root, items);
    for (const button of root.querySelectorAll('[data-inline-status]')) button.onclick = () => { state.listStatusFilter = button.dataset.inlineStatus; void loadListView(); };
    root.querySelector('.inline-clear-query')?.addEventListener('click', () => { state.listQuery = ''; state.inlineSearchValue = ''; void loadListView(); });
  }

  function renderBatchCard(item) {
    const b = item.bead;
    const td = item.taskDetail;
    const t = td?.task || item.relatedTasks?.[0] || null;
    const beadId = b?.id || '';
    const taskId = t?.id || '';
    const idBadgesHtml = renderCardIdBadges({ beadId, taskId, fallbackId: item.id });
    const title = b?.title || t?.title || '(无标题)';
    const status = b?.status || t?.status || 'unknown';
    const labels = Array.isArray(b?.labels) ? b.labels : [];
    const steps = Array.isArray(td?.steps) ? td.steps : [];
    const curStep = steps.find((s) => ['running', 'waiting_approval', 'needs_human', 'failed'].includes(s.status)) || steps[steps.length - 1] || null;
    const stepsDone = steps.length ? steps.filter((s) => s.status === 'done').length : (t?.steps_done ?? 0);
    const stepsTotal = steps.length || (t?.steps_total ?? 0);
    const ts = b?.updated_at || t?.updated_at || b?.created_at || t?.created_at || '';

    const modelVal = ext.resolveDispatchModelLabel?.(b, t, steps, item.dispatchModel?.label || '') || '';
    const chipsHtml = buildCardChips(labels, {
      projectInfo: item.project,
      formula: t?.formula_name || '',
      env: t?.resolved_env || '',
      model: modelVal,
      taskStatus: t?.status || '',
      beadStatus: b?.status || '',
    });

    return `
      <div class="task-card" role="button" tabindex="0" data-open-id="${esc(item.id)}">
        ${visitedIds.has(item.id) ? '<span class="visited-badge">已看</span>' : ''}
        <div class="task-card-top">
          <div class="meta-row">
            ${b?.ephemeral ? '<span class="chip lbl-ephemeral">ephemeral</span>' : ''}
            ${renderPriorityBadge(b?.priority)}
            ${idBadgesHtml}
            ${b?.issue_type ? `<span class="chip chip-neutral">${esc(b.issue_type)}</span>` : ''}
          </div>
          <div class="meta-row">
            ${renderStatusBadge(status)}
            ${t && b && t.status !== b.status ? renderStatusBadge(t.status, `task:${t.status}`) : ''}
            ${ts ? `<span class="task-card-time">${esc(formatShortTime(ts))}</span>` : ''}
          </div>
        </div>
        <div class="task-card-title">${esc(title)}</div>
        ${item.summary ? `<div class="task-card-summary">${esc(String(item.summary).slice(0, 160))}</div>` : ''}
        ${chipsHtml ? `<div class="meta-row">${chipsHtml}</div>` : ''}
        ${ext.renderCardExtras?.(item, { esc }) || ''}
      </div>
    `;
  }

  async function loadBatchView({ force = false } = {}) {
    const seq = ++viewRequestSeq;
    const ids = [...state.ids];
    const requestQuery = buildScopeQuery({ ids: ids.join(','), force: force ? 1 : '' });
    renderHeader(state.title || `本轮任务列表 (${state.ids.length})`, null);
    const root = $('app-root');
    clearFindStateForLoading();
    root.innerHTML = `<div class="card-list">${ids.map((id) => `<div class="task-card is-skeleton"><span class="id-badge">${esc(id)}</span><div class="skeleton-line"></div><div class="skeleton-line"></div></div>`).join('')}</div>`;
    if (!state.mcpInline) openFindBar({ captureSelection: false });
    setRefreshing(true);
    try {
      const data = await requestJson(`/api/batch?${requestQuery}`);
      if (seq !== viewRequestSeq) return;
      applyProjectsMeta(data);
      renderHeader(state.title || `本轮任务列表 (${data.counts?.found || 0}/${data.counts?.total || state.ids.length})`, data.primaryProject);

      data.items.forEach((item) => cacheItem(item));
      if (state.mcpInline) {
        renderInlineBatch(data);
        return;
      }
      const renderFiltered = () => {
        const items = data.items.filter((it) => {
          if (!state.batchStatusFilter) return true;
          const st = it.bead?.status || it.taskDetail?.task?.status || '';
          return st === state.batchStatusFilter;
        });

        visibleItems = items;
        visibleSource = 'batch';
        const statuses = ['open', 'in_progress', 'blocked', 'deferred', 'closed'];
        const filterTabs = [
          `<button type="button" class="segment-tab ${state.batchStatusFilter === '' ? 'active' : ''}" data-batch-st="">全部 <span class="seg-count">${data.items.length}</span></button>`,
          ...statuses
            .filter((s) => (data.counts?.[s] || 0) > 0)
            .map((s) => `<button type="button" class="segment-tab ${state.batchStatusFilter === s ? 'active' : ''}" data-batch-st="${s}">${s} <span class="seg-count">${data.counts[s]}</span></button>`),
        ].join('');

        const missingHtml = data.missing?.length
          ? `
            <div class="section-block">
              <div class="section-head"><span class="section-title">未找到的 ID (${data.missing.length})</span></div>
              <div class="panel-box panel-box-tight">
                <div class="meta-row">${data.missing.map((m) => `<button type="button" class="badge st-failed mono chip-btn" data-copy="${esc(m.id)}" title="${esc(m.error)}（点击复制）">${esc(m.id)} ⎘</button>`).join('')}</div>
              </div>
            </div>
          `
          : '';

        root.innerHTML = `
          <div class="toolbar">
            <div class="segment-tabs" role="tablist">${filterTabs}</div>
            ${items.length ? '<button type="button" class="btn btn-xs" id="btn-review-list">逐条查看 ▶</button>' : ''}
          </div>
          ${items.length ? `<div class="card-list">${items.map(renderBatchCard).join('')}</div>` : '<div class="empty-state">当前筛选条件下无匹配任务</div>'}
          ${missingHtml}
        `;

        for (const btn of root.querySelectorAll('[data-batch-st]')) {
          btn.onclick = () => {
            state.batchStatusFilter = btn.getAttribute('data-batch-st') || '';
            renderFiltered();
          };
        }
        bindCardListInteractions(root);
        if ($('btn-review-list')) $('btn-review-list').onclick = () => openFromList('');
        syncInPageFind({ scroll: false });
        restoreListPosition();
      };

      renderFiltered();
    } catch (err) {
      if (seq !== viewRequestSeq) return;
      applyProjectsMeta(err?.data);
      clearFindStateForLoading();
      root.innerHTML = `<div class="empty-state is-error">批量加载失败: ${esc(err.message)}</div>`;
    } finally {
      if (seq === viewRequestSeq) setRefreshing(false);
    }
  }

  function renderListCard(it) {
    const task = it.task;
    const isTaskOnly = it.kind === 'task' && !it.id.includes('-');
    const idBadgesHtml = renderCardIdBadges(
      task && it.kind === 'both'
        ? { beadId: it.id, taskId: task.id }
        : isTaskOnly
          ? { taskId: it.id }
          : { beadId: it.id },
    );

    const chipsHtml = buildCardChips(it.labels || [], {
      formula: task?.formula_name || (it.kind === 'task' ? it.issue_type : ''),
      env: task?.resolved_env || '',
      model: it.dispatch_model_label || '',
      taskStatus: task?.status || '',
      beadStatus: it.status || '',
    });

    return `
      <div class="task-card" role="button" tabindex="0" data-open-id="${esc(it.id)}">
        ${visitedIds.has(it.id) ? '<span class="visited-badge">已看</span>' : ''}
        <div class="task-card-top">
          <div class="meta-row">
            ${renderPriorityBadge(it.priority)}
            ${idBadgesHtml}
            ${it.issue_type && it.kind !== 'task' ? `<span class="chip chip-neutral">${esc(it.issue_type)}</span>` : ''}
          </div>
          <div class="meta-row">
            ${renderStatusBadge(it.status)}
            ${task && it.kind === 'both' && task.status !== it.status ? renderStatusBadge(task.status, `task:${task.status}`) : ''}
            ${it.updated_at ? `<span class="task-card-time">${esc(formatShortTime(it.updated_at))}</span>` : ''}
          </div>
        </div>
        <div class="task-card-title">${esc(it.title)}</div>
        ${it.summary ? `<div class="task-card-summary">${esc(String(it.summary).slice(0, 160))}</div>` : ''}
        ${chipsHtml ? `<div class="meta-row">${chipsHtml}</div>` : ''}
        ${ext.renderCardExtras?.(it, { esc }) || ''}
      </div>
    `;
  }

  async function loadListView({ force = false } = {}) {
    if (state.mcpInline) {
      const seq = ++viewRequestSeq;
      const root = $('app-root');
      root.innerHTML = '<div class="empty-state">加载中…</div>';
      setRefreshing(true);
      try {
        const data = await requestJson(`/api/list?${buildScopeQuery({ status: state.listStatusFilter, q: state.listQuery, limit: 40, force: force ? 1 : '' })}`);
        if (seq !== viewRequestSeq) return;
        applyProjectsMeta(data);
        renderInlineList(data);
      } catch (err) {
        if (seq !== viewRequestSeq) return;
        applyProjectsMeta(err?.data);
        root.innerHTML = `<div class="empty-state is-error">列表加载失败: ${esc(err.message)}</div>`;
      } finally { if (seq === viewRequestSeq) setRefreshing(false); }
      return;
    }
    if (findState.open && !normalizeFindQuery(findState.query)) closeFindBar({ restoreFocus: false });
    ++viewRequestSeq;
    renderHeader('项目任务总览', null);
    const root = $('app-root');
    const statuses = [
      { value: '', label: '全部' },
      { value: 'open', label: 'open' },
      { value: 'in_progress', label: 'in_progress' },
      { value: 'blocked', label: 'blocked' },
      { value: 'deferred', label: 'deferred' },
      { value: 'closed', label: 'closed' },
    ];

    root.innerHTML = `
      <div class="toolbar-stack">
        <div class="toolbar">
          <div class="search-box">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5"></circle>
              <path d="M10.5 10.5L14 14"></path>
            </svg>
            <input id="search-input" class="search-input" type="search" placeholder="搜索 ID / 标题 / 标签…" value="${esc(state.listQuery)}" />
            <button id="btn-clear-search" class="search-clear ${state.listQuery ? '' : 'hidden'}" type="button" title="清除搜索">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <path d="M4 4l8 8M12 4l-8 8"></path>
              </svg>
            </button>
          </div>
          <button id="btn-search" class="btn" type="button">搜索</button>
        </div>
        <div class="toolbar">
          <button type="button" class="btn btn-xs hidden" id="btn-review-list">逐条查看 ▶</button>
          <div id="status-tabs" class="segment-tabs" role="tablist">
            ${statuses.map((s) => `<button type="button" class="segment-tab ${state.listStatusFilter === s.value ? 'active' : ''}" data-list-st="${s.value}">${s.label}</button>`).join('')}
          </div>
        </div>
      </div>
      <div id="list-container"><div class="empty-state">加载中…</div></div>
    `;

    const fetchAndRender = async (forceRefresh = false) => {
      const seq = ++viewRequestSeq;
      const requestQuery = buildScopeQuery({ status: state.listStatusFilter, q: state.listQuery, limit: 40, force: forceRefresh ? 1 : '' });
      const container = $('list-container');
      clearFindStateForLoading();
      container.innerHTML = '<div class="empty-state">加载中…</div>';
      setRefreshing(true);
      try {
        const data = await requestJson(`/api/list?${requestQuery}`);
        if (seq !== viewRequestSeq) return;
        applyProjectsMeta(data);
        renderHeader('项目任务总览', data.project);
        visibleItems = data.items || [];
        visibleSource = 'list';
        visibleItems.forEach(rememberItem);
        $('btn-review-list').classList.toggle('hidden', !visibleItems.length);
        $('btn-review-list').onclick = () => openFromList('');
        if (!data.items?.length) {
          clearFindStateForLoading();
          container.innerHTML = `<div class="empty-state">${esc(window.__tasksUiConfig?.emptyTasksText || '暂无匹配的 Beads 任务')}</div>`;
          return;
        }
        container.innerHTML = `<div class="card-list">${data.items.map(renderListCard).join('')}</div>`;
        bindCardListInteractions(container);
        syncInPageFind({ scroll: false });
        restoreListPosition();
      } catch (err) {
        if (seq !== viewRequestSeq) return;
        applyProjectsMeta(err?.data);
        clearFindStateForLoading();
        container.innerHTML = `<div class="empty-state is-error">列表加载失败: ${esc(err.message)}</div>`;
      } finally {
        if (seq === viewRequestSeq) setRefreshing(false);
      }
    };

    const searchInput = $('search-input');
    const clearBtn = $('btn-clear-search');
    const syncClearBtn = () => {
      clearBtn.classList.toggle('hidden', !searchInput.value.trim());
    };

    searchInput.oninput = syncClearBtn;
    clearBtn.onclick = () => {
      searchInput.value = '';
      state.listQuery = '';
      syncClearBtn();
      fetchAndRender();
    };
    $('btn-search').onclick = () => {
      state.listQuery = searchInput.value.trim();
      fetchAndRender();
    };
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        state.listQuery = searchInput.value.trim();
        fetchAndRender();
      }
    };

    for (const tab of root.querySelectorAll('[data-list-st]')) {
      tab.onclick = () => {
        state.listStatusFilter = tab.getAttribute('data-list-st') || '';
        for (const other of root.querySelectorAll('[data-list-st]')) {
          other.classList.toggle('active', other === tab);
        }
        fetchAndRender();
      };
    }

    await fetchAndRender(force);
  }

  function extractLatestReply(td, steps) {
    if (td?.reply && String(td.reply).trim()) return String(td.reply);
    if (td?.task?.reply && String(td.task.reply).trim()) return String(td.task.reply);
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const s = steps[i];
      const attempts = Array.isArray(s.attempts) ? s.attempts : [];
      for (let j = attempts.length - 1; j >= 0; j -= 1) {
        if (attempts[j]?.reply && String(attempts[j].reply).trim()) {
          return String(attempts[j].reply);
        }
      }
      if (s.current_attempt?.reply && String(s.current_attempt.reply).trim()) {
        return String(s.current_attempt.reply);
      }
    }
    return '';
  }

  function extractStructuredSummary(data, td, steps) {
    const candidates = [data?.summary, td?.summary, td?.task?.summary];
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const s = steps[i];
      if (s?.current_attempt?.summary) candidates.push(s.current_attempt.summary);
      const attempts = Array.isArray(s?.attempts) ? s.attempts : [];
      for (let j = attempts.length - 1; j >= 0; j -= 1) {
        if (attempts[j]?.summary) candidates.push(attempts[j].summary);
      }
    }
    const found = candidates.find((val) => typeof val === 'string' && val.trim());
    return found ? found.trim() : '';
  }

  function buildMetaRows(b, td, t, steps, projectInfo, fallbackModel = '') {
    if (ext.buildMetaRows) return ext.buildMetaRows(b, td, t, steps, projectInfo, fallbackModel, { fmtTime });
    const rows = [];
    if (projectInfo?.name) rows.push({ k: 'Project', v: projectInfo.name });
    if (b?.assignee) rows.push({ k: 'Assignee', v: `@${b.assignee}` });
    for (const [key, label] of [['created_at', 'Created'], ['updated_at', 'Updated'], ['closed_at', 'Closed']]) {
      if (b?.[key]) rows.push({ k: label, v: fmtTime(b[key]) });
    }
    return rows;
  }

  // Sidecar-only action bar: send the task context into the bound conversation
  // through the Antigravity-injected `agentapi send-message` CLI.
  function renderAgentSendBar(summary) {
    const bar = document.createElement('div');
    bar.className = 'toolbar agent-send-bar';

    const makeButton = (label, extraClass = 'btn') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = extraClass;
      button.textContent = label;
      return button;
    };

    // 12px linear paper-plane icon, inherits the button text color.
    const sendIcon = '<svg class="btn-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>';

    const sendBtn = makeButton('发到当前对话', 'btn btn-agent-primary');
    sendBtn.insertAdjacentHTML('afterbegin', sendIcon);
    const noteBtn = makeButton('带说明发送', 'btn btn-agent-secondary');
    bar.append(sendBtn, noteBtn);

    const box = document.createElement('div');
    box.className = 'agent-send-box hidden';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input agent-send-input';
    input.placeholder = '补充说明 / 驳回意见…';
    const noteSend = makeButton('发送', 'btn btn-primary btn-xs');
    const noteCancel = makeButton('取消', 'btn btn-ghost btn-xs');
    box.append(input, noteSend, noteCancel);
    bar.append(box);

    const setBusy = (busy) => {
      sendBtn.disabled = busy;
      noteBtn.disabled = busy;
      noteSend.disabled = busy;
      noteCancel.disabled = busy;
    };
    const openBox = () => {
      box.classList.remove('hidden');
      noteBtn.classList.add('is-active');
      input.focus();
    };
    const closeBox = () => {
      box.classList.add('hidden');
      noteBtn.classList.remove('is-active');
      input.value = '';
    };

    const send = async (prompt) => {
      setBusy(true);
      try {
        await postJson('/api/agent/send', { prompt });
        showToast('已发送到当前对话');
        return true;
      } catch (err) {
        showToast(err.message, 'err');
        return false;
      } finally {
        setBusy(false);
      }
    };

    sendBtn.onclick = () => { void send(`请继续处理以下任务：\n${summary}`); };
    noteBtn.onclick = () => {
      if (box.classList.contains('hidden')) openBox();
      else closeBox();
    };
    const sendWithNote = async () => {
      const note = input.value.trim();
      if (!note) {
        showToast('请先输入说明内容，或直接用「发到当前对话」', 'err');
        input.focus();
        return;
      }
      if (await send(`${note}\n\n${summary}`)) closeBox();
    };
    noteSend.onclick = () => { void sendWithNote(); };
    noteCancel.onclick = () => { closeBox(); };
    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void sendWithNote();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeBox();
      }
    };
    return bar;
  }

  // Minimal 12px linear icons for bead status actions; inherit the button text color.
  const BEAD_REOPEN_ICON = '<svg class="btn-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3.2-6.9"/><path d="M3 4v5h5"/></svg>';
  const BEAD_CLOSE_ICON = '<svg class="btn-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M8.4 12.3l2.5 2.5 4.7-5"/></svg>';

  function renderDetailItem(data) {
    if (state.mcpInline && !state.inlineExpandedDetail) {
      renderInlineCard(data);
      return;
    }
    const b = data.bead;
    const td = data.taskDetail;
    const actionCacheKey = cacheKey(data.id);
    const t = td?.task || null;
    const root = $('app-root');
    const steps = Array.isArray(td?.steps) ? td.steps : [];
    const events = Array.isArray(td?.events) ? td.events : [];
    const related = Array.isArray(data.relatedTasks) ? data.relatedTasks : [];

    const headId = b?.id || t?.id || data.id;
    renderHeader(headId, data.project);

    const labels = Array.isArray(b?.labels) ? b.labels : [];
    const deps = Array.isArray(b?.dependencies) ? b.dependencies : [];
    const dependents = Array.isArray(b?.dependents) ? b.dependents : [];
    const titleText = b?.title || t?.title || headId;
    const metaRows = buildMetaRows(b, td, t, steps, data.project, data.dispatchModel?.label || '');
    const latestReply = extractLatestReply(td, steps);
    const structuredSummary = extractStructuredSummary(data, td, steps);
    const displayNotes = b?.notes ? formatBeadNotesForDisplay(b.notes) : '';
    const notesHasStructuredSummary = String(b?.notes || '').includes('**处理简介**');

    // Header quick actions
    const quickActions = ext.renderDetailActions?.(data, { esc }) || [];
    if (b && b.status !== 'closed') {
      quickActions.push(`<button type="button" class="btn btn-bead-close" id="btn-quick-close">${BEAD_CLOSE_ICON}Close Bead</button>`);
    } else if (b && b.status === 'closed') {
      quickActions.push(`<button type="button" class="btn btn-bead-reopen" id="btn-quick-reopen">${BEAD_REOPEN_ICON}Reopen Bead</button>`);
    }

    const blocks = [];

    // 1. Detail Header Block (inspector.js fixed header style)
    blocks.push(`
      <section class="detail-header">
        <div class="detail-header-top">
          <div class="meta-row">
            ${b ? `<button type="button" class="id-badge" data-copy="${esc(b.id)}" title="点击复制 Bead ID">${esc(b.id)} ⎘</button>` : ''}
            ${t ? `<button type="button" class="id-badge-task" data-copy="${esc(t.id)}" title="点击复制 Task ID">#${esc(t.id)} ⎘</button>` : ''}
            ${renderProjectBadge(data.project)}
            ${b ? renderPriorityBadge(b.priority) : ''}
            ${b?.ephemeral ? '<span class="chip lbl-ephemeral">ephemeral</span>' : ''}
            ${b ? renderStatusBadge(b.status) : ''}
            ${t ? renderStatusBadge(t.status, b ? `task:${t.status}` : t.status) : ''}
            ${b?.issue_type ? `<span class="chip chip-neutral">${esc(b.issue_type)}</span>` : ''}
          </div>
        </div>
        <h2 class="detail-title">${esc(titleText)}</h2>
        ${t?.bead_id && !b ? `<div class="meta-row"><button type="button" class="id-badge" data-jump-id="${esc(t.bead_id)}">bead: ${esc(t.bead_id)}</button></div>` : ''}
        ${b ? `
          <div class="meta-row">
            ${labels.map((l) => `
              <span class="chip ${labelClass(l)}">#${esc(l)}
                <button type="button" class="chip-remove" data-remove-label="${esc(l)}" title="移除标签">×</button>
              </span>
            `).join('')}
            <div class="control-inline">
              <input id="new-label-input" class="input" type="text" placeholder="新增标签…" style="width:112px;height:22px;font-size:11px;" />
              <button id="btn-add-label" class="btn btn-xs" type="button">+ 标签</button>
            </div>
          </div>
        ` : ''}
        ${quickActions.length ? `<div class="detail-actions">${quickActions.join('')}</div>` : ''}
      </section>
    `);

    // 2. Metadata Grid
    if (metaRows.length) {
      blocks.push(`
        <section class="section-block">
          <div class="panel-box panel-box-tight">
            <div class="meta-grid">
              ${metaRows.map((row) => `
                <div class="meta-key">${esc(row.k)}</div>
                <div class="meta-val">
                  ${row.copyable
                    ? `<div class="meta-val-row"><span>${esc(row.v)}</span><button type="button" class="btn btn-xs" data-copy="${esc(row.v)}">Copy</button></div>`
                    : esc(row.v)}
                </div>
              `).join('')}
            </div>
          </div>
        </section>
      `);
    }

    // 3. Structured processing summary (when notes do not already embed one)
    if (structuredSummary && !notesHasStructuredSummary) {
      blocks.push(`
        <section class="section-block">
          <div class="section-head">
            <span class="section-title">处理简介 / Summary</span>
            <button type="button" class="btn btn-xs" data-copy="${esc(structuredSummary)}">Copy</button>
          </div>
          <div class="panel-box md-body summary-box">${renderMarkdown(structuredSummary)}</div>
        </section>
      `);
    }

    // 4. Description
    if (b?.description) {
      blocks.push(`
        <section class="section-block">
          <div class="section-head">
            <span class="section-title">Description</span>
          </div>
          <div class="panel-box md-body">${renderMarkdown(b.description)}</div>
        </section>
      `);
    }

    // 5. Acceptance Criteria
    if (b?.acceptance_criteria) {
      blocks.push(`
        <section class="section-block">
          <div class="section-head">
            <span class="section-title">Acceptance Criteria</span>
          </div>
          <div class="panel-box md-body">${renderMarkdown(b.acceptance_criteria)}</div>
        </section>
      `);
    }

    // 5. Relations
    if (b && (b.parent || deps.length || dependents.length)) {
      blocks.push(`
        <section class="section-block">
          <div class="section-head">
            <span class="section-title">Relations</span>
          </div>
          <div class="panel-box panel-box-tight">
            <div class="meta-row">
              ${b.parent ? `<button type="button" class="chip chip-neutral chip-btn mono" data-jump-id="${esc(b.parent)}">parent: ${esc(b.parent)}</button>` : ''}
              ${deps.map((d) => {
                const depId = d.id || d.depends_on_id;
                if (!depId || depId === b.parent) return '';
                return `<button type="button" class="chip chip-neutral chip-btn mono" data-jump-id="${esc(depId)}">${d.status ? '<span class="status-dot"></span>' : ''}${esc(d.type || 'dep')}: ${esc(depId)}${d.status ? ` [${esc(d.status)}]` : ''}</button>`;
              }).join('')}
              ${dependents.map((d) => {
                const depId = d.id || d.issue_id;
                if (!depId) return '';
                return `<button type="button" class="chip chip-neutral chip-btn mono" data-jump-id="${esc(depId)}">${d.status ? '<span class="status-dot"></span>' : ''}child: ${esc(depId)}${d.status ? ` [${esc(d.status)}]` : ''}</button>`;
              }).join('')}
            </div>
          </div>
        </section>
      `);
    }

    blocks.push(ext.renderDetailExtras?.(data, { esc, renderStatusBadge, formatElapsed, formatShortTime, renderMarkdown, eventToneClass }) || '');

    // 8. Latest Reply
    if (latestReply) {
      blocks.push(`
        <section class="section-block">
          <div class="section-head">
            <span class="section-title">Latest Reply</span>
            <button type="button" class="btn btn-xs" data-copy="${esc(latestReply)}">Copy</button>
          </div>
          <div class="panel-box md-body">${renderMarkdown(latestReply)}</div>
        </section>
      `);
    }

    // 9. Notes & Close Reason
    if (b?.close_reason || displayNotes) {
      blocks.push(`
        <section class="section-block">
          <div class="section-head">
            <span class="section-title">Notes</span>
          </div>
          ${b.close_reason ? `<div class="close-reason-banner">Close reason: ${esc(b.close_reason)}</div>` : ''}
          ${displayNotes ? `<div class="panel-box md-body">${renderMarkdown(displayNotes)}</div>` : ''}
        </section>
      `);
    }

    // 10. Status, Priority & Append Note Form
    if (b) {
      blocks.push(`
        <section class="section-block">
          <div class="section-head">
            <span class="section-title">状态与备注</span>
          </div>
          <div class="panel-box" style="display:flex;flex-direction:column;gap:10px;">
            <div class="controls-grid">
              <div class="control-group">
                <label class="control-label" for="bead-status-select">状态更新</label>
                <div class="control-inline">
                  <select id="bead-status-select" class="select">
                    ${['open', 'in_progress', 'blocked', 'deferred', 'closed'].map((s) => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                  <button id="btn-save-status" class="btn btn-primary" type="button">更新</button>
                </div>
              </div>
              <div class="control-group">
                <label class="control-label" for="bead-priority-select">优先级</label>
                <div class="control-inline">
                  <select id="bead-priority-select" class="select">
                    ${[0, 1, 2, 3, 4].map((p) => `<option value="${p}" ${Number(b.priority) === p ? 'selected' : ''}>P${p}</option>`).join('')}
                  </select>
                  <button id="btn-save-priority" class="btn" type="button">应用</button>
                </div>
              </div>
            </div>

            <div id="status-reason-row" class="control-group hidden">
              <input id="status-reason-input" class="input" type="text" placeholder="可选：关闭或重开原因 (--reason)…" />
            </div>

            <div class="control-group">
              <label class="control-label" for="note-input">追加备注 (bd note / --append-notes)</label>
              <textarea id="note-input" class="textarea" placeholder="输入备注内容…"></textarea>
              <div>
                <button id="btn-append-note" class="btn btn-primary" type="button">追加 Note</button>
              </div>
            </div>
          </div>
        </section>
      `);
    }

    if (queue.ids.includes(state.id)) {
      const { prev, next } = queueNeighbors(state.id, queue);
      const preview = (id) => `<span class="queue-preview-id">${esc(id)}</span>`;
      blocks.push(`<section class="detail-queue-footer"><button type="button" class="btn queue-footer-btn" id="footer-prev" ${prev ? '' : 'disabled'}><span class="queue-preview-label">← 上一条</span>${prev ? preview(prev) : ''}</button><button type="button" class="btn btn-primary queue-footer-btn" id="footer-next"><span class="queue-preview-label">${next ? '下一条 →' : '已到队尾 · 返回列表'}</span>${next ? preview(next) : ''}</button></section>`);
    }
    root.innerHTML = blocks.join('');
    if (bridge && state.mcpInline && state.inlineExpandedDetail) {
      const bar = document.createElement('div');
      bar.className = 'inline-actions';
      const collapse = document.createElement('button');
      collapse.type = 'button'; collapse.className = 'btn btn-xs'; collapse.textContent = '← 收起为简介';
      collapse.onclick = () => { state.inlineExpandedDetail = false; renderInlineCard(data); };
      bar.append(collapse);
      const source = state.inlineSource || (['batch', 'list'].includes(state.inlineOrigin?.view) ? state.inlineOrigin : null);
      if (source) {
        const back = document.createElement('button');
        back.type = 'button'; back.className = 'btn btn-xs'; back.textContent = source.view === 'batch' ? '← 返回批处理' : '← 返回列表';
        back.onclick = () => restoreInlineView(source);
        bar.append(back);
      }
      root.prepend(bar);
    }
    if (bridge && !state.mcpInline) {
      const caps = bridge.getHostCapabilities() || {};
      const bar = document.createElement('div');
      bar.className = 'toolbar';
      const summary = buildTaskContextSummary(data);
      const add = (label, action) => { const button = document.createElement('button'); button.className = 'btn'; button.textContent = label; button.onclick = async () => { try { const result = await action(); showToast(result?.conversationId ? `已新开后台会话 (${result.conversationId})` : '操作成功'); } catch (err) { showToast(err.message, 'err'); } }; bar.append(button); };
      if (caps.updateModelContext) { add('附到对话', () => bridge.updateModelContext(summary)); add('清除上下文', () => bridge.clearModelContext()); }
      if (caps.message) { add('发到当前对话', () => bridge.sendMessage(`请继续处理任务：\n${summary}`)); add('新开会话处理', () => bridge.sendMessage(`请继续处理任务：\n${summary}`, { newConversation: true })); }
      ext.collectInlineActions?.(data, { inlineParts, bridge, fullLink: false, add });
      bar.classList.add('detail-host-bar');
      if (bar.childNodes.length) {
        const detailHeader = root.querySelector('.detail-header');
        (detailHeader || root).append(bar);
      }
    } else if (!bridge && state.conversationId && !state.mcpInline) {
      const detailHeader = root.querySelector('.detail-header');
      (detailHeader || root).append(renderAgentSendBar(buildTaskContextSummary(data)));
    }
    const neighbors = queueNeighbors(state.id, queue);
    if ($('footer-prev')) $('footer-prev').onclick = () => jumpToItem(neighbors.prev);
    if ($('footer-next')) $('footer-next').onclick = () => neighbors.next ? jumpToItem(neighbors.next) : backToList();
    const applyActionItem = (item) => {
      if (!item?.ok) return;
      cacheVersions.set(actionCacheKey, (cacheVersions.get(actionCacheKey) || 0) + 1);
      inflightItemRequests.delete(actionCacheKey);
      detailCache.set(actionCacheKey, { data: item, fetchedAt: Date.now() });
      if (state.id === data.id && cacheKey(data.id) === actionCacheKey) {
        detailRequestSeq += 1;
        viewRequestSeq += 1;
        setRefreshing(false);
        rememberItem(item);
        renderDetailItem(item);
        if (queue.ids.includes(state.id)) saveQueue();
      }
    };

    for (const btn of root.querySelectorAll('[data-copy]')) {
      btn.onclick = () => copyText(btn.getAttribute('data-copy') || '', btn);
    }
    for (const btn of root.querySelectorAll('[data-jump-id]')) {
      btn.onclick = () => {
        state.id = btn.getAttribute('data-jump-id') || '';
        syncUrl();
        renderCurrentView();
      };
    }

    if (b) {
      const statusSelect = $('bead-status-select');
      const reasonRow = $('status-reason-row');
      const toggleReason = () => {
        const next = statusSelect.value;
        if (next === 'closed' || (next === 'open' && b.status === 'closed')) {
          reasonRow.classList.remove('hidden');
        } else {
          reasonRow.classList.add('hidden');
        }
      };
      statusSelect.onchange = toggleReason;
      toggleReason();

      const updateStatusAction = async (targetStatus, triggerBtn) => {
        try {
          if (triggerBtn) triggerBtn.disabled = true;
          const res = await postJson('/api/bead/status', {
            id: b.id,
            status: targetStatus,
            currentStatus: b.status,
            reason: $('status-reason-input')?.value.trim() || '',
          });
          showToast(`状态已更新为 ${targetStatus}`);
          applyActionItem(res.item);
        } catch (err) {
          showToast(`状态更新失败: ${err.message}`, 'err');
        } finally {
          if (triggerBtn && triggerBtn.isConnected) triggerBtn.disabled = false;
        }
      };

      $('btn-save-status').onclick = () => updateStatusAction(statusSelect.value, $('btn-save-status'));

      const quickCloseBtn = $('btn-quick-close');
      if (quickCloseBtn) {
        quickCloseBtn.onclick = () => updateStatusAction('closed', quickCloseBtn);
      }
      const quickReopenBtn = $('btn-quick-reopen');
      if (quickReopenBtn) {
        quickReopenBtn.onclick = () => updateStatusAction('open', quickReopenBtn);
      }

      $('btn-save-priority').onclick = async () => {
        try {
          $('btn-save-priority').disabled = true;
          const prio = Number($('bead-priority-select').value);
          const res = await postJson('/api/bead/priority', { id: b.id, priority: prio });
          showToast(`优先级已更新为 P${prio}`);
          applyActionItem(res.item);
        } catch (err) {
          showToast(`优先级更新失败: ${err.message}`, 'err');
        } finally {
          if ($('btn-save-priority')) $('btn-save-priority').disabled = false;
        }
      };

      $('btn-append-note').onclick = async () => {
        const text = $('note-input').value.trim();
        if (!text) {
          showToast('备注内容不能为空', 'err');
          return;
        }
        try {
          $('btn-append-note').disabled = true;
          const res = await postJson('/api/bead/note', { id: b.id, text });
          showToast('已追加备注');
          applyActionItem(res.item);
        } catch (err) {
          showToast(`追加备注失败: ${err.message}`, 'err');
        } finally {
          if ($('btn-append-note')) $('btn-append-note').disabled = false;
        }
      };

      const addLabelAction = async () => {
        const label = $('new-label-input').value.trim();
        if (!label) return;
        try {
          $('btn-add-label').disabled = true;
          const res = await postJson('/api/bead/label', { id: b.id, op: 'add', label });
          showToast(`已添加标签 #${label}`);
          applyActionItem(res.item);
        } catch (err) {
          showToast(`添加标签失败: ${err.message}`, 'err');
        } finally {
          if ($('btn-add-label')) $('btn-add-label').disabled = false;
        }
      };
      $('btn-add-label').onclick = addLabelAction;
      $('new-label-input').onkeydown = (e) => {
        if (e.key === 'Enter') addLabelAction();
      };

      for (const btn of root.querySelectorAll('[data-remove-label]')) {
        btn.onclick = async () => {
          const label = btn.getAttribute('data-remove-label');
          try {
            const res = await postJson('/api/bead/label', { id: b.id, op: 'remove', label });
            showToast(`已移除标签 #${label}`);
            applyActionItem(res.item);
          } catch (err) {
            showToast(`移除标签失败: ${err.message}`, 'err');
          }
        };
      }
    }

    ext.bindDetailExtras?.(root, data, { postJson, showToast, applyActionItem });
    syncInPageFind({ scroll: false });
  }

  const FIND_SKIP_SELECTOR =
    'script, style, noscript, textarea, input, select, option, svg, .hidden, .find-empty-banner';

  function clearFindHighlights(root = $('app-root')) {
    if (root) {
      for (const banner of root.querySelectorAll('.find-empty-banner')) {
        banner.remove();
      }
      for (const card of root.querySelectorAll('.task-card.find-card-hidden')) {
        card.classList.remove('find-card-hidden');
      }
      const parents = new Set();
      for (const mark of root.querySelectorAll('mark.find-mark')) {
        if (mark.parentNode) parents.add(mark.parentNode);
        mark.replaceWith(document.createTextNode(mark.textContent || ''));
      }
      for (const parent of parents) {
        parent.normalize();
      }
    }
    findState.marks = [];
    findState.activeIndex = -1;
    findState.truncated = false;
  }

  function updateFindToolbarControls({ hasCards = false, matchedCardCount = 0 } = {}) {
    const findBtn = $('btn-find');
    const findBar = $('find-bar');
    const findInput = $('find-input');
    const clearBtn = $('btn-find-clear');
    const filterBtn = $('btn-find-filter');
    const prevBtn = $('btn-find-prev');
    const nextBtn = $('btn-find-next');
    const countEl = $('find-count');

    if (findBtn) {
      findBtn.classList.toggle('is-active', findState.open);
      findBtn.setAttribute('aria-pressed', findState.open ? 'true' : 'false');
    }
    if (findBar) {
      findBar.classList.toggle('hidden', !findState.open);
    }
    if (clearBtn && findInput) {
      clearBtn.classList.toggle('hidden', !findInput.value.trim());
    }
    if (filterBtn) {
      filterBtn.classList.toggle('hidden', !hasCards);
      filterBtn.classList.toggle('is-active', Boolean(findState.filterCards));
      filterBtn.setAttribute('aria-pressed', findState.filterCards ? 'true' : 'false');
    }

    const query = normalizeFindQuery(findState.query);
    const total = findState.marks.length;
    if (prevBtn) prevBtn.disabled = !findState.open || !query || total === 0;
    if (nextBtn) nextBtn.disabled = !findState.open || !query || total === 0;

    if (countEl) {
      if (!findState.open || !query) {
        countEl.textContent = '';
        countEl.classList.remove('is-empty');
      } else if (total === 0) {
        countEl.textContent = '0 / 0';
        countEl.classList.add('is-empty');
      } else {
        const displayIdx = findState.activeIndex >= 0 ? findState.activeIndex + 1 : 1;
        const suffix = findState.truncated ? '+' : '';
        const cardNote = findState.filterCards && hasCards ? ` · ${matchedCardCount}项` : '';
        countEl.textContent = `${displayIdx} / ${total}${suffix}${cardNote}`;
        countEl.classList.remove('is-empty');
      }
    }
  }

  function clearFindStateForLoading() {
    clearFindHighlights($('app-root'));
    updateFindToolbarControls({ hasCards: false, matchedCardCount: 0 });
  }

  function openAncestorDetails(el, root) {
    let cur = el?.parentElement || null;
    while (cur && cur !== root) {
      if (cur.tagName === 'DETAILS' && !cur.open) {
        cur.open = true;
      }
      cur = cur.parentElement;
    }
  }

  function setActiveFindMatch(index, { scroll = true, hasCards = false, matchedCardCount = 0 } = {}) {
    const total = findState.marks.length;
    if (total === 0) {
      findState.activeIndex = -1;
      updateFindToolbarControls({ hasCards, matchedCardCount });
      return;
    }

    const prev = findState.marks[findState.activeIndex];
    if (prev && prev.isConnected) {
      prev.classList.remove('is-active');
    }

    const nextIdx = Math.max(0, Math.min(total - 1, index));
    findState.activeIndex = nextIdx;
    const active = findState.marks[nextIdx];
    if (active) {
      active.classList.add('is-active');
      openAncestorDetails(active, $('app-root'));
      if (scroll) {
        active.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }

    updateFindToolbarControls({ hasCards, matchedCardCount });
  }

  function runInPageFind({ scroll = true } = {}) {
    const root = $('app-root');
    if (!root) return;

    clearFindHighlights(root);
    const cards = Array.from(root.querySelectorAll('.task-card'));
    const hasCards = cards.length > 0;
    const query = normalizeFindQuery(findState.query);

    if (!findState.open || !query) {
      updateFindToolbarControls({ hasCards, matchedCardCount: cards.length });
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(FIND_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let currentNode;
    while ((currentNode = walker.nextNode())) {
      textNodes.push(currentNode);
    }

    for (const textNode of textNodes) {
      const remaining = MAX_FIND_MARKS - findState.marks.length;
      if (remaining <= 0) {
        findState.truncated = true;
        break;
      }

      const { segments, truncated } = splitTextByMatches(textNode.nodeValue, query, { maxMatches: remaining });
      if (truncated) findState.truncated = true;
      if (!segments.some((seg) => seg.matched)) continue;

      const frag = document.createDocumentFragment();
      for (const seg of segments) {
        if (!seg.text) continue;
        if (seg.matched) {
          const mark = document.createElement('mark');
          mark.className = 'find-mark';
          mark.textContent = seg.text;
          frag.appendChild(mark);
          findState.marks.push(mark);
        } else {
          frag.appendChild(document.createTextNode(seg.text));
        }
      }
      textNode.replaceWith(frag);
    }

    let matchedCardCount = cards.length;
    if (findState.filterCards && hasCards) {
      matchedCardCount = 0;
      for (const card of cards) {
        const matched = card.querySelector('mark.find-mark') !== null;
        card.classList.toggle('find-card-hidden', !matched);
        if (matched) matchedCardCount += 1;
      }
      if (matchedCardCount === 0) {
        const cardList = root.querySelector('.card-list');
        if (cardList && cardList.parentNode) {
          const banner = document.createElement('div');
          banner.className = 'empty-state find-empty-banner';
          banner.textContent = `当前页内无匹配 “${query}” 的任务`;
          cardList.insertAdjacentElement('afterend', banner);
        }
      }
    }

    if (findState.marks.length === 0) {
      updateFindToolbarControls({ hasCards, matchedCardCount });
      return;
    }

    setActiveFindMatch(0, { scroll, hasCards, matchedCardCount });
  }

  function syncInPageFind({ scroll = false } = {}) {
    if (findState.open) {
      runInPageFind({ scroll });
      return;
    }
    const root = $('app-root');
    const hasCards = Boolean(root && root.querySelector('.task-card'));
    updateFindToolbarControls({ hasCards, matchedCardCount: 0 });
  }

  function stepFindMatch(delta) {
    if (!findState.open || !findState.marks.length) return;
    const root = $('app-root');
    const cards = root ? Array.from(root.querySelectorAll('.task-card')) : [];
    const hasCards = cards.length > 0;
    const matchedCardCount =
      findState.filterCards && hasCards
        ? cards.filter((c) => !c.classList.contains('find-card-hidden')).length
        : cards.length;
    const nextIdx = nextMatchIndex(findState.activeIndex, findState.marks.length, delta);
    if (nextIdx >= 0) {
      setActiveFindMatch(nextIdx, { scroll: true, hasCards, matchedCardCount });
    }
  }

  function openFindBar({ deferFocus = false, captureSelection = true } = {}) {
    const input = $('find-input');
    findState.open = true;
    if (input) {
      const sel = captureSelection ? window.getSelection?.()?.toString().trim() || '' : '';
      if (sel && !sel.includes('\n') && sel.length <= 80 && !input.value.trim()) {
        input.value = sel;
        findState.query = sel;
      } else {
        findState.query = input.value;
      }
    }
    runInPageFind({ scroll: Boolean(normalizeFindQuery(findState.query)) });
    if (input) {
      const focusInput = () => {
        if (!findState.open || document.activeElement === input) return;
        input.focus({ preventScroll: true });
        input.select();
      };
      if (deferFocus) {
        setTimeout(focusInput, 0);
      } else {
        focusInput();
      }
    }
  }

  function closeFindBar({ restoreFocus = false } = {}) {
    findState.open = false;
    clearFindHighlights($('app-root'));
    const hasCards = Boolean($('app-root')?.querySelector('.task-card'));
    updateFindToolbarControls({ hasCards, matchedCardCount: 0 });
    if (restoreFocus) {
      $('btn-find')?.focus();
    }
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  async function loadDetailView({ force = false } = {}) {
    if (findState.open && !normalizeFindQuery(findState.query)) closeFindBar({ restoreFocus: false });
    const id = state.id;
    const key = cacheKey(id);
    const seq = ++detailRequestSeq;
    const viewSeq = ++viewRequestSeq;
    const root = $('app-root');
    if (lastDetailId !== id) {
      root.scrollTop = 0;
      window.scrollTo(0, 0);
      lastDetailId = id;
    }
    visitedIds.add(id);
    const cached = !force && detailCache.get(key);
    if (cached) {
      renderDetailItem(cached.data);
    }
    else {
      renderHeader(id, null);
      clearFindStateForLoading();
      root.innerHTML = `<div class="empty-state">正在读取 <span class="mono">${esc(id)}</span>…</div>`;
    }
    setRefreshing(true);
    try {
      const data = await fetchDetail(id, force);
      if (viewSeq !== viewRequestSeq || seq !== detailRequestSeq || state.id !== id || cacheKey(id) !== key) return;
      applyProjectsMeta(data);
      detailCache.set(cacheKey(id), { data, fetchedAt: Date.now() });
      if (initialQueuePending) {
        initialQueuePending = false;
        restoreQueue(initialParams);
      }
      const discarded = discardConflictingRestoredQueue(data);
      rememberItem(data);
      if (queue.ids.includes(id)) saveQueue();
      prefetchNeighbors(id);
      if (discarded || !cached || JSON.stringify(cached.data) !== JSON.stringify(data)) {
        const y = window.scrollY, rootY = root.scrollTop;
        renderDetailItem(data);
        if (cached) { root.scrollTop = rootY; window.scrollTo(0, y); }
      }
    } catch (err) {
      if (viewSeq !== viewRequestSeq || seq !== detailRequestSeq || state.id !== id || cacheKey(id) !== key) return;
      applyProjectsMeta(err?.data);
      if (!cached) {
        clearFindStateForLoading();
        root.innerHTML = `<div class="empty-state is-error">读取失败 (${esc(id)}): ${esc(err.message)}</div>`;
      }
    } finally {
      if (viewSeq === viewRequestSeq && seq === detailRequestSeq) setRefreshing(false);
    }
  }

  async function renderSettingsView() {
    const seq = ++viewRequestSeq;
    detailRequestSeq += 1;
    setRefreshing(false);
    $('batch-nav').classList.add('hidden');
    renderHeader(`${window.__tasksUiConfig?.title || 'Beads Tasks'} 设置`, null);
    const root = $('app-root');
    root.innerHTML = '<div class="empty-state">加载设置中…</div>';
    try {
      const data = await requestJson('/api/settings');
      if (seq !== viewRequestSeq || !state.settingsOpen) return;
      state.settings = data.settings;
      state.settingsPath = data.path;
      root.innerHTML = `<div class="settings-page">
        <div class="settings-head"><button type="button" class="btn btn-ghost settings-back">← 返回</button><h2>Beads Tasks 设置</h2></div>
        <section class="settings-card"><h3 class="settings-group-title">聊天输出与链接</h3>
          <div class="settings-row"><div><strong>输出时携带 Sidecar 链接</strong><p>开启时，Agent 回复中的任务 ID 会附带 [⧉] / [↗] 与底部侧栏入口链接；关闭后仅输出纯行内代码（MCP Inline 卡片不受影响），无需重启、下一轮对话即生效。</p></div>
          <button type="button" role="switch" aria-label="输出时携带 Sidecar 链接" aria-checked="${state.settings.emitSidecarLinks}" class="toggle-switch${state.settings.emitSidecarLinks ? ' is-on' : ''}"><span></span></button></div></section>
        <div class="settings-footer"><div class="settings-meta"><span>配置文件</span><code>${esc(state.settingsPath)}</code><button type="button" class="btn btn-ghost settings-copy">复制路径</button></div></div></div>`;
      root.querySelector('.settings-back').onclick = () => { state.settingsOpen = false; void renderCurrentView(); };
      root.querySelector('.settings-copy').onclick = (event) => void copyText(state.settingsPath, event.currentTarget, '已复制路径');
      const toggle = root.querySelector('.toggle-switch');
      toggle.onclick = async () => {
        const previous = state.settings.emitSidecarLinks;
        const next = !previous;
        toggle.disabled = true;
        toggle.classList.toggle('is-on', next);
        toggle.setAttribute('aria-checked', String(next));
        try {
          const result = await postJson('/api/settings', { emitSidecarLinks: next });
          state.settings = result.settings;
          state.settingsPath = result.path;
          showToast(`已${next ? '开启' : '关闭'}输出 Sidecar 链接（下一轮对话生效）`);
        } catch (err) {
          toggle.classList.toggle('is-on', previous);
          toggle.setAttribute('aria-checked', String(previous));
          showToast(`设置保存失败: ${err.message}`, 'err');
        } finally { toggle.disabled = false; }
      };
    } catch (err) {
      if (seq === viewRequestSeq && state.settingsOpen) root.innerHTML = `<div class="empty-state is-error">读取设置失败: ${esc(err.message)}</div>`;
    }
  }

  async function renderCurrentView(options = {}) {
    $('btn-settings').setAttribute('aria-pressed', String(state.settingsOpen));
    if (state.settingsOpen) {
      await renderSettingsView();
    } else if (state.id) {
      await loadDetailView(options);
    } else if (state.ids.length > 0) {
      detailRequestSeq += 1;
      lastDetailId = '';
      await loadBatchView(options);
    } else {
      detailRequestSeq += 1;
      lastDetailId = '';
      await loadListView(options);
    }
  }

  function handlePendingCopy(params) {
    const target = resolveCopyTarget(params);
    if (!target) return;
    syncUrl();
    void copyText(target, null, '已复制 ID', { preferNative: true });
  }

  async function refreshProjectsScope(seq) {
    try {
      const proj = await requestJson(`/api/projects?${buildScopeQuery()}`);
      if (seq !== viewRequestSeq) return;
      state.projects = Array.isArray(proj.projects) ? proj.projects : [];
      state.activeProjectId = proj.activeProjectId || '';
    } catch {
      if (seq !== viewRequestSeq) return;
      state.activeProjectId = '';
    }
    renderProjectSelector();
  }

  async function initMcpBridge() {
    let received = false;
    let fallbackTimer;
    const applyPayload = (payload) => {
      if (!payload) return;
      received = true;
      clearTimeout(fallbackTimer);
      state.id = payload.id || '';
      state.ids = Array.isArray(payload.ids) ? payload.ids : [];
      state.title = payload.title || '';
      state.project = payload.project || '';
      state.repo = payload.repo || '';
      state.listStatusFilter = payload.status || '';
      state.listQuery = payload.query || '';
      if (payload.view === 'batch' || state.ids.length) {
        queue = { ids: [...state.ids], batchIds: [...state.ids], metaById: {}, source: 'batch', title: state.title, project: state.project, repo: state.repo, visitedIds: [] };
        visitedIds.clear();
      }
      state.projects = payload.projects || [];
      state.activeProjectId = payload.activeProjectId || '';
      state.mcpInline = Boolean(bridge && payload.surface === 'inline');
      state.inlineExpandedDetail = false;
      state.inlineOrigin = inlineSnapshot();
      state.inlineSource = null;
      state.inlineSearchOpen = false;
      state.inlineSearchValue = state.listQuery;
      document.body.classList.toggle('is-mcp-inline', state.mcpInline);
      renderProjectSelector();
      void renderCurrentView();
    };
    bridge.onToolResult(applyPayload);
    bridge.onToolInput(() => {
      ++viewRequestSeq;
      $('app-root').innerHTML = '<div class="empty-state">加载中…</div>';
    });
    try { restoredQueue = await bridge.loadReviewQueue(); } catch { /* queue persistence is optional */ }
    const initial = bridge.getInitialPayload();
    if (!received && initial) applyPayload(initial);
    if (!received) fallbackTimer = setTimeout(() => { if (!received) void renderCurrentView(); }, 1500);
  }

  async function init() {
    handlePendingCopy(initialParams);
    $('project-select').onchange = (e) => {
      state.settingsOpen = false;
      state.project = e.target.value;
      state.repo = '';
      queue = { ids: [], metaById: {}, source: 'list', visitedIds: [] };
      visitedIds.clear();
      try { sessionStorage.removeItem(storageKey); } catch { /* unavailable */ }
      if (bridge) void bridge.clearReviewQueue().catch(() => {});
      syncUrl();
      renderCurrentView();
    };
    $('btn-home').onclick = () => {
      state.settingsOpen = false;
      state.id = '';
      state.ids = [];
      state.title = '';
      queue = { ids: [], metaById: {}, source: 'list', visitedIds: [] };
      visitedIds.clear();
      try { sessionStorage.removeItem(storageKey); } catch { /* unavailable */ }
      if (bridge) void bridge.clearReviewQueue().catch(() => {});
      syncUrl();
      renderCurrentView();
    };
    $('btn-settings').onclick = () => {
      state.settingsOpen = !state.settingsOpen;
      void renderCurrentView();
    };
    $('btn-refresh').onclick = () => {
      renderCurrentView({ force: true });
    };

    const findInput = $('find-input');
    $('btn-find').onclick = () => {
      if (findState.open) {
        closeFindBar({ restoreFocus: false });
      } else {
        openFindBar();
      }
    };
    $('btn-find-clear').onclick = () => {
      if (findInput) findInput.value = '';
      findState.query = '';
      runInPageFind({ scroll: false });
      findInput?.focus();
    };
    $('btn-find-filter').onclick = () => {
      findState.filterCards = !findState.filterCards;
      runInPageFind({ scroll: true });
    };
    $('btn-find-prev').onclick = () => stepFindMatch(-1);
    $('btn-find-next').onclick = () => stepFindMatch(1);
    $('btn-find-close').onclick = () => closeFindBar({ restoreFocus: true });

    if (findInput) {
      findInput.addEventListener('compositionstart', () => {
        findState.composing = true;
      });
      findInput.addEventListener('compositionend', () => {
        findState.composing = false;
        findState.query = findInput.value;
        runInPageFind({ scroll: true });
      });
      findInput.addEventListener('input', () => {
        findState.query = findInput.value;
        if (findState.composing) {
          updateFindToolbarControls({
            hasCards: Boolean($('app-root')?.querySelector('.task-card')),
          });
          return;
        }
        runInPageFind({ scroll: true });
      });
      findInput.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229 || findState.composing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          stepFindMatch(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFindBar({ restoreFocus: true });
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      const action = shouldHandleFindShortcut(e, {
        isEditable: isEditableTarget(e.target),
        findOpen: findState.open,
        hasQuery: Boolean(normalizeFindQuery(findState.query)),
      });
      if (action) {
        e.preventDefault();
        if (action === 'open') openFindBar({ deferFocus: e.key === '/' });
        else if (action === 'next') stepFindMatch(1);
        else if (action === 'prev') stepFindMatch(-1);
        else if (action === 'close') closeFindBar({ restoreFocus: true });
        return;
      }
      if (e.defaultPrevented) return;
      const queueAction = shouldHandleQueueShortcut(e, {
        view: state.id ? 'detail' : 'list', hasQueue: queue.ids.includes(state.id),
        isEditable: isEditableTarget(e.target), composing: findState.composing,
        findOpen: findState.open, hasSelection: Boolean(window.getSelection?.()?.toString()),
      });
      if (!queueAction) return;
      e.preventDefault();
      const { prev, next } = queueNeighbors(state.id, queue);
      if (queueAction === 'prev') jumpToItem(prev);
      else if (queueAction === 'next') jumpToItem(next);
      else if (queueAction === 'back') backToList();
      else if (queueAction === 'copy') void copyText(state.id);
    });

    if (bridge) {
      await initMcpBridge();
      return;
    }
    window.addEventListener('popstate', async () => {
      initialQueuePending = false;
      const seq = ++viewRequestSeq;
      const p = new URLSearchParams(location.search);
      const project = (p.get('project') || '').trim();
      const repo = (p.get('repo') || '').trim();
      const conversationId = window.sidecar?.conversationId || p.get('conversationId') || '';
      const scopeChanged = project !== state.project || repo !== state.repo || conversationId !== state.conversationId;
      state.id = (p.get('id') || '').trim();
      state.ids = parseIds(p.get('ids'));
      state.title = (p.get('title') || '').trim();
      state.project = project;
      state.repo = repo;
      state.conversationId = conversationId;
      if (scopeChanged || scopeRefreshPending) {
        scopeRefreshPending = true;
        state.activeProjectId = '';
        await refreshProjectsScope(seq);
        if (seq !== viewRequestSeq) return;
        scopeRefreshPending = false;
      }
      if (state.ids.length) queue = { ids: [...state.ids], batchIds: [...state.ids], metaById: {}, source: 'batch', title: state.title, project: state.project, repo: state.repo, visitedIds: [...visitedIds] };
      else {
        queue = { ids: [], metaById: {}, source: 'list', visitedIds: [] };
        restoreQueue(p);
      }
      renderProjectSelector();
      handlePendingCopy(p);
      renderCurrentView();
    });

    await renderCurrentView();
  }

  init().catch((err) => {
    console.error('[tasks] init failed:', err);
    const root = $('app-root');
    if (root) {
      root.innerHTML = `<div class="empty-state is-error">初始化失败: ${esc(err?.message || String(err))}</div>`;
    }
  });
})();
