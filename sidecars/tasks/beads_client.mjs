import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
export const ALLOWED_STATUSES = new Set(['open', 'in_progress', 'blocked', 'deferred', 'closed']);
export const LABEL_RE = /^[a-z0-9][a-z0-9:._/-]{0,63}$/i;
export const MAX_BATCH_IDS = 50;

export function resolveBdBin(deps = {}) {
  if (process.env.BD_BIN) return process.env.BD_BIN;
  const fsExists = deps.existsSync || existsSync;
  const home = deps.homedir ? deps.homedir() : homedir();
  const candidates = [
    join(home, '.local', 'bin', 'bd'),
    join(home, '.local', 'share', 'mise', 'shims', 'bd'),
    '/opt/homebrew/bin/bd',
    '/usr/local/bin/bd',
  ];
  for (const p of candidates) {
    if (fsExists(p)) return p;
  }
  return 'bd';
}

export function buildExecEnv(deps = {}) {
  const home = deps.homedir ? deps.homedir() : homedir();
  const extraPath = [
    join(home, '.local', 'bin'),
    join(home, '.local', 'share', 'mise', 'shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].join(':');
  return {
    ...process.env,
    PATH: `${extraPath}:${process.env.PATH || ''}`,
    // Force the v1 JSON shape; a user-enabled v2 envelope would break parsing.
    BD_JSON_ENVELOPE: '0',
  };
}

function extractBalancedJson(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

export function parseJsonFromOutput(stdout) {
  const text = String(stdout || '');
  const idxArr = text.indexOf('[');
  const idxObj = text.indexOf('{');
  let start = -1;
  if (idxArr !== -1 && idxObj !== -1) start = Math.min(idxArr, idxObj);
  else start = Math.max(idxArr, idxObj);
  if (start === -1) {
    throw new Error('command did not emit JSON');
  }
  // `bd --json` may print `NOTE:` / `Showing ...` hints before or after the
  // payload, so slice out the first fully balanced JSON value.
  const balanced = extractBalancedJson(text, start);
  if (balanced) {
    try {
      return JSON.parse(balanced);
    } catch {
      // fall through to the legacy slice-and-parse below
    }
  }
  return JSON.parse(text.slice(start).trim());
}

const DOLT_SERVER_ENV_KEYS = [
  'BEADS_DOLT_SERVER_MODE',
  'BEADS_DOLT_SERVER_HOST',
  'BEADS_DOLT_SERVER_PORT',
  'BEADS_DOLT_SERVER_USER',
  'BEADS_DOLT_PASSWORD',
  'BEADS_DOLT_AUTO_START',
  'BEADS_DOLT_SHARED_SERVER',
  'BEADS_DOLT_PROXIED_SERVER',
  'BEADS_DOLT_SERVER_DATABASE',
  'BEADS_DOLT_SERVER_SOCKET',
  'BEADS_DOLT_SERVER_TLS',
];

/**
 * Read `<bdDir>/metadata.json` and return its `dolt_mode`, or null when the file
 * is missing/unparsable. Injected `deps.readFileSync` keeps the tests hermetic.
 */
function readBeadsDoltMode(bdDir, deps = {}) {
  if (!bdDir) return null;
  const readFile = deps.readFileSync || readFileSync;
  try {
    const raw = readFile(join(bdDir, 'metadata.json'), 'utf8');
    const meta = JSON.parse(String(raw));
    const mode = meta?.dolt_mode;
    return typeof mode === 'string' ? mode : null;
  } catch {
    return null;
  }
}

/**
 * A host-wide `BEADS_DOLT_SERVER_MODE=1` overrides `<bdDir>/metadata.json` and makes
 * embedded-Dolt projects fail with `database "<name>" not found on Dolt server`,
 * so drop the server variables for embedded (or any non-server) mode.
 */
export function applyDoltModeEnv(env, bdDir, deps = {}) {
  const mode = readBeadsDoltMode(bdDir, deps);
  if (!mode || mode.trim().toLowerCase() === 'server') return env;
  for (const key of DOLT_SERVER_ENV_KEYS) delete env[key];
  return env;
}

/**
 * Direct Beads CLI invocation.
 */
export async function execBd(bdArgs, projectCtx, deps = {}, timeout = 15000) {
  const bin = resolveBdBin(deps);
  const runExec = deps.execFile || execFileAsync;
  const env = buildExecEnv(deps);
  const fsExists = deps.existsSync || existsSync;
  if (projectCtx?.bdDir) {
    env.BEADS_DIR = projectCtx.bdDir;
    applyDoltModeEnv(env, projectCtx.bdDir, deps);
  }
  let cwd;
  if (projectCtx?.repo && fsExists(projectCtx.repo)) cwd = projectCtx.repo;
  else if (projectCtx?.bdDir) cwd = dirname(projectCtx.bdDir);
  try {
    return await runExec(bin, bdArgs, {
      cwd,
      env,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    if (isEnoentError(err)) {
      const wrapped = new Error('未检测到 bd 命令（Beads CLI），请先安装 bd 并确保其在 PATH 中');
      wrapped.code = 'ENOENT';
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  }
}

export function formatExecError(err) {
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  if (stderr) return stderr;
  return err?.message || String(err);
}

export function isEnoentError(err) {
  if (!err) return false;
  if (err.code === 'ENOENT') return true;
  return /spawn .* ENOENT|command not found|not found as a command|no such file or directory: .*|executable file not found/i.test(String(err.message || ''));
}

export function isNotFoundError(msg) {
  return /not found|no issue|no such|unknown task|does not exist|0 rows/i.test(String(msg || ''));
}

export function normalizeIdList(rawIds) {
  const list = Array.isArray(rawIds)
    ? rawIds
    : String(rawIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id) || !ID_RE.test(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_BATCH_IDS) break;
  }
  return out;
}

function pickBead(parsed) {
  const bead = Array.isArray(parsed) ? parsed[0] : parsed;
  return bead && bead.id ? bead : null;
}

async function showBeadEphemeralViaBd(id, projectCtx, deps = {}) {
  try {
    const { stdout } = await execBd(['list', '--include-ephemeral', '--id', id, '--json'], projectCtx, deps);
    const parsed = parseJsonFromOutput(stdout);
    const list = Array.isArray(parsed) ? parsed : parsed?.issues || parsed?.beads || [];
    return list.find((b) => b?.id === id) || null;
  } catch {
    return null;
  }
}

async function showBeadViaBd(id, projectCtx, deps = {}) {
  let missing = false;
  try {
    const { stdout } = await execBd(['show', '--json', id], projectCtx, deps);
    const bead = pickBead(parseJsonFromOutput(stdout));
    if (bead) return bead;
    missing = true;
  } catch (err) {
    const msg = formatExecError(err);
    if (!isNotFoundError(msg)) throw new Error(msg);
    missing = true;
  }
  if (missing && deps.ephemeralFallback !== false) {
    return showBeadEphemeralViaBd(id, projectCtx, deps);
  }
  return null;
}

async function showBeadsBatchViaBd(ids, projectCtx, deps = {}) {
  const fetchOne = async (id) => {
    try {
      return await showBeadViaBd(id, projectCtx, deps);
    } catch {
      return null;
    }
  };
  if (ids.length === 1) {
    const bead = await fetchOne(ids[0]);
    return new Map(bead ? [[bead.id, bead]] : []);
  }
  try {
    const { stdout } = await execBd(['show', '--json', ...ids], projectCtx, deps);
    const parsed = parseJsonFromOutput(stdout);
    const list = (Array.isArray(parsed) ? parsed : [parsed]).filter((b) => b?.id);
    return new Map(list.map((b) => [b.id, b]));
  } catch (err) {
    const msg = formatExecError(err);
    // Older `bd show` only accepts a single id; fall back to per-id lookups.
    const perIdFallback = /requires exactly one bead id|exactly one bead|too many arguments|unexpected argument|unrecognized argument|usage:/i.test(msg);
    if (perIdFallback || isNotFoundError(msg)) {
      const beads = await mapLimit(ids, 6, fetchOne);
      return new Map(beads.filter(Boolean).map((b) => [b.id, b]));
    }
    throw new Error(msg);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await worker(items[current], current);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

export function summarizeProject(ctx) {
  if (!ctx) return null;
  return {
    id: ctx.id,
    name: ctx.name,
    repo: ctx.repo || '',
    bdDir: ctx.bdDir || '',
    source: ctx.source || '',
  };
}

async function updateBeadStatus(id, { status, currentStatus, reason, force } = {}, projectCtx, deps = {}) {
  if (!ID_RE.test(id)) throw new Error('invalid bead id');
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`unsupported status: ${status}`);

  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  let bdArgs;

  if (status === 'closed') {
    bdArgs = ['close', id];
    if (cleanReason) bdArgs.push('--reason', cleanReason);
    if (force) bdArgs.push('--force');
  } else if (status === 'open' && currentStatus === 'closed') {
    bdArgs = ['reopen', id];
    if (cleanReason) bdArgs.push('--reason', cleanReason);
  } else {
    bdArgs = ['update', id, '--status', status];
  }

  try {
    await execBd(bdArgs, projectCtx, deps);
    invalidateCaches(projectCtx);
  } catch (err) {
    throw new Error(formatExecError(err));
  }
}

async function appendBeadNote(id, text, projectCtx, deps = {}) {
  if (!ID_RE.test(id)) throw new Error('invalid bead id');
  const noteText = typeof text === 'string' ? text.trim() : '';
  if (!noteText) throw new Error('note text cannot be empty');
  if (noteText.length > 4000) throw new Error('note text exceeds 4000 characters');

  try {
    await execBd(['update', id, '--append-notes', noteText], projectCtx, deps);
    invalidateCaches(projectCtx);
  } catch (err) {
    throw new Error(formatExecError(err));
  }
}

async function updateBeadPriority(id, priority, projectCtx, deps = {}) {
  if (!ID_RE.test(id)) throw new Error('invalid bead id');
  const num = Number(priority);
  if (!Number.isInteger(num) || num < 0 || num > 4) {
    throw new Error('priority must be an integer between 0 and 4');
  }
  try {
    await execBd(['update', id, '--priority', String(num)], projectCtx, deps);
    invalidateCaches(projectCtx);
  } catch (err) {
    throw new Error(formatExecError(err));
  }
}

async function updateBeadLabel(id, { op, label } = {}, projectCtx, deps = {}) {
  if (!ID_RE.test(id)) throw new Error('invalid bead id');
  const cleanLabel = typeof label === 'string' ? label.trim() : '';
  if (!LABEL_RE.test(cleanLabel)) throw new Error('invalid label');
  if (op !== 'add' && op !== 'remove') throw new Error('op must be add or remove');

  const flag = op === 'add' ? '--add-label' : '--remove-label';
  try {
    await execBd(['update', id, flag, cleanLabel], projectCtx, deps);
    invalidateCaches(projectCtx);
  } catch (err) {
    throw new Error(formatExecError(err));
  }
}


export function invalidateCaches() {}

function contexts(primary, fallbacks) {
  const seen = new Set();
  return [primary, ...fallbacks].filter((ctx) => {
    if (!ctx || seen.has(ctx.bdDir)) return false;
    seen.add(ctx.bdDir);
    return true;
  });
}
function item(id, ctx, bead) {
  return { ok: true, id, kind: 'bead', project: summarizeProject(ctx), bead, taskDetail: null, relatedTasks: [], summary: '', structuredSummary: '', dispatchModel: { provider: '', model: '', label: '' } };
}
async function showBead(id, ctx, deps = {}) {
  if (!ID_RE.test(id)) throw new Error('invalid bead id');
  if (ctx?.bdDir && !(deps.existsSync || existsSync)(ctx.bdDir)) return null;
  return showBeadViaBd(id, ctx, deps);
}
async function showBeadsBatch(rawIds, ctx, deps = {}) {
  const ids = normalizeIdList(rawIds);
  if (!ids.length || !ctx?.bdDir || !(deps.existsSync || existsSync)(ctx.bdDir)) return new Map();
  return showBeadsBatchViaBd(ids, ctx, deps);
}
async function fetchItem(id, primary, fallbacks = [], deps = {}) {
  const cleanId = String(id || '').trim();
  if (!ID_RE.test(cleanId)) return { ok: false, id: cleanId, error: 'invalid task or bead id' };
  let error = '';
  for (const ctx of contexts(primary, fallbacks)) {
    try {
      const bead = await showBead(cleanId, ctx, deps);
      if (bead) return item(cleanId, ctx, bead);
    } catch (err) { error = formatExecError(err); }
  }
  return { ok: false, id: cleanId, project: summarizeProject(primary), error: error || `未找到任务或 Bead: ${cleanId}` };
}
async function fetchBatch(rawIds, primary, fallbacks = [], deps = {}) {
  const ids = normalizeIdList(rawIds);
  if (!ids.length) return { ok: false, error: 'no valid ids provided', items: [], missing: [] };
  const found = new Map();
  for (const ctx of contexts(primary, fallbacks)) {
    const remaining = ids.filter((id) => !found.has(id));
    if (!remaining.length) break;
    const beads = await showBeadsBatch(remaining, ctx, deps).catch(() => new Map());
    for (const id of remaining) if (beads.has(id)) found.set(id, item(id, ctx, beads.get(id)));
  }
  const items = [], missing = [];
  const counts = { total: ids.length, found: 0, open: 0, in_progress: 0, blocked: 0, closed: 0, deferred: 0, other: 0 };
  for (const id of ids) {
    const hit = found.get(id);
    if (!hit) { missing.push({ id, error: `未找到任务或 Bead: ${id}` }); continue; }
    items.push(hit); counts.found++;
    const status = hit.bead.status || 'other';
    if (Object.hasOwn(counts, status)) counts[status]++; else counts.other++;
  }
  return { ok: true, primaryProject: summarizeProject(primary), items, missing, counts };
}
async function fetchProjectList(ctx, opts = {}, deps = {}) {
  if (!ctx) return { ok: false, error: 'no project context resolved', items: [] };
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 40));
  const status = typeof opts.status === 'string' ? opts.status.trim() : '';
  const query = typeof opts.query === 'string' ? opts.query.trim().toLowerCase() : '';
  const closedLoaded = status === 'closed' || Boolean(opts.includeClosed) || Boolean(query);
  let beads = [];
  if (ctx.bdDir && (deps.existsSync || existsSync)(ctx.bdDir)) {
    try {
      const args = closedLoaded ? ['list', '--all', '--limit', String(limit), '--json'] : ['list', '--limit', String(limit), '--json'];
      const parsed = parseJsonFromOutput((await execBd(args, ctx, deps)).stdout);
      if (Array.isArray(parsed)) beads = parsed;
    } catch (err) { return { ok: false, project: summarizeProject(ctx), error: formatExecError(err), items: [] }; }
  }
  const items = beads.map((b) => ({ id: b.id, kind: 'bead', title: b.title, status: b.status, priority: b.priority, issue_type: b.issue_type, labels: Array.isArray(b.labels) ? b.labels : [], updated_at: b.updated_at || b.created_at || '', summary: '', dispatch_provider: '', dispatch_model: '', dispatch_model_label: '', task: null }))
    .sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .filter((b) => (closedLoaded || b.status !== 'closed') && (!status || b.status === status) && (!query || `${b.id} ${b.title} ${b.labels.join(' ')}`.toLowerCase().includes(query))).slice(0, limit);
  return { ok: true, project: summarizeProject(ctx), closedLoaded, items };
}
export function createTasksClient(provider = null) {
  const defaults = { showBead, showBeadsBatch, fetchItem, fetchBatch, fetchProjectList, updateBeadStatus, appendBeadNote, updateBeadPriority, updateBeadLabel, invalidateCaches };
  return Object.fromEntries(Object.entries(defaults).map(([name, fn]) => [name, provider?.[name] ? provider[name].bind(provider) : fn]));
}

export { showBead, showBeadsBatch, fetchItem, fetchBatch, fetchProjectList, updateBeadStatus, appendBeadNote, updateBeadPriority, updateBeadLabel };

export function createCacheTools() {
  const cacheVersions = new WeakMap();
  let cacheGeneration = 0;
  function invalidateInflight(...inflight) {
    cacheGeneration += 1;
    for (const requests of inflight) requests.clear();
  }
function cachedRequest(cache, inflight, key, deps, freshTtl, staleTtl, load) {
  const now = () => deps.now ? deps.now() : Date.now();
  const cached = cache.get(key);
  const age = now() - (cached?.at ?? -Infinity);
  const refresh = () => {
    const flightKey = deps.noCache ? `${key}::force` : key;
    if (inflight.has(flightKey)) return inflight.get(flightKey);
    let versions = cacheVersions.get(cache);
    if (!versions) { versions = new Map(); cacheVersions.set(cache, versions); }
    if (deps.noCache) {
      versions.set(key, (versions.get(key) || 0) + 1);
      inflight.delete(key);
    }
    const version = versions.get(key) || 0;
    const generation = cacheGeneration;
    const promise = (async () => {
      const data = await load();
      if (data !== null && generation === cacheGeneration && (versions.get(key) || 0) === version) cache.set(key, { at: now(), data });
      return data;
    })().finally(() => { if (inflight.get(flightKey) === promise) inflight.delete(flightKey); });
    inflight.set(flightKey, promise);
    return promise;
  };
  if (!deps.noCache && cached && age < freshTtl) return Promise.resolve(cached.data);
  if (!deps.noCache && cached && age < staleTtl) {
    void refresh().catch(() => {});
    return Promise.resolve(cached.data);
  }
  return refresh();
}


  return { cachedRequest, invalidateInflight };
}
