import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';

const execFileAsync = promisify(execFile);

async function fixture(t, { override = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-mcp-'));
  const dist = join(dir, 'mcp/dist');
  const side = join(dir, 'sidecars/tasks');
  await mkdir(dist, { recursive: true });
  await mkdir(side, { recursive: true });
  await writeFile(join(side, 'beads_client.mjs'), `import * as client from './fixture_client.mjs'; export function createTasksClient(){return client}`);
  await copyFile(resolve('mcp/dist/server.mjs'), join(dist, 'server.mjs'));
  await copyFile(resolve('mcp/dist/app.html'), join(dist, 'app.html'));
  await copyFile(resolve('sidecars/tasks/settings.mjs'), join(side, 'settings.mjs'));
  await writeFile(join(side, 'project_resolver.mjs'), `export async function resolveProjectContext(){return {id:'p'}}; export async function listKnownProjects(){return {projects:[{id:'p',name:'Project'}],activeProjectId:'p'}};`);
  await writeFile(join(side, 'fixture_client.mjs'), `
    export async function fetchItem(id){return {ok:true,id,project:{id:'p',name:'Project'},bead:{id,title:'Test '+id,status:'open',priority:1,description:id==='huge'?'x'.repeat(1200000):'description',acceptance_criteria:'accept'},taskDetail:{task:{id:'task',status:'running'},steps:[{status:'done'},{status:'running'}]}}};
    export async function fetchBatch(ids){return {ok:true,items:await Promise.all(ids.map(fetchItem)),counts:{total:ids.length,open:ids.length}}};
    export async function fetchProjectList(ctx,opts){return {ok:true,items:[{id:'ab',title:'Test ab',status:'open'}],opts}};
    export async function updateBeadStatus(){}; export async function updateBeadPriority(){}; export async function appendBeadNote(){}; export async function updateBeadLabel(){}; export async function runTaskAction(){};
  `);
  await writeFile(join(side, 'clipboard.mjs'), 'export const MAX_CLIPBOARD_LEN=10000; export async function writeSystemClipboard(){};');
  const overridePath = join(dir, 'override.html');
  await writeFile(overridePath, '<html>override</html>');
  const proc = spawn(process.execPath, [join(dist, 'server.mjs'), `--data-dir=${join(dir, 'data')}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BEADS_TASKS_SETTINGS_FILE: join(dir, 'settings.json'), ...(override ? { BEADS_TASKS_MCP_APP_HTML: overridePath } : { BEADS_TASKS_MCP_APP_HTML: '' }) },
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => { stderr += chunk; });
  const pending = new Map();
  let id = 0;
  createInterface({ input: proc.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(Error(`timeout ${method}: ${stderr}`)), 5000);
    pending.set(requestId, (message) => { clearTimeout(timer); resolveCall(message); });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
  });
  t.after(async () => {
    proc.stdin.end();
    if (proc.exitCode === null) {
      proc.kill();
      await new Promise((done) => proc.once('exit', done));
    }
    await rm(dir, { recursive: true, force: true });
  });
  assert.ok((await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).result);
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return { call, dir, tool: async (name, args = {}) => (await call('tools/call', { name, arguments: args })).result };
}

test('initialize and self-contained resource', async (t) => {
  const { call } = await fixture(t);
  const [resource] = (await call('resources/list')).result.resources;
  assert.match(resource.uri, /^ui:\/\//);
  assert.equal(resource.name, 'Beads Tasks');
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  const [content] = (await call('resources/read', { uri: resource.uri })).result.contents;
  assert.equal(content.mimeType, resource.mimeType);
  assert.ok(Buffer.byteLength(content.text) > 0 && Buffer.byteLength(content.text) < 10 * 1024 * 1024);
  assert.doesNotMatch(content.text, /<script\s+[^>]*src=|<link\s+[^>]*href=/i);
});

test('resource HTML environment override', async (t) => {
  const { call } = await fixture(t, { override: true });
  const resource = (await call('resources/list')).result.resources[0];
  assert.equal((await call('resources/read', { uri: resource.uri })).result.contents[0].text, '<html>override</html>');
});

test('tool metadata and descriptions', async (t) => {
  const { call } = await fixture(t);
  const tools = (await call('tools/list')).result.tools;
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  for (const name of ['show_task_card', 'show_task_batch', 'open_tasks_board']) {
    assert.ok(byName[name].description.length > 20);
    assert.match(byName[name]._meta.ui.resourceUri, /^ui:\/\//);
    for (const property of Object.values(byName[name].inputSchema.properties)) assert.ok(property.description);
  }
  assert.deepEqual(byName.open_tasks_board._meta['com.google.antigravity/ui'].entrypoints, [{ type: 'global', title: 'Beads Tasks' }]);
  const appTools = tools.filter((tool) => tool.name.startsWith('ui_'));
  assert.equal(tools.length, 15);
  assert.equal(appTools.length, 12);
  assert.equal(byName.ui_run_task_action, undefined);
  assert.ok(byName.ui_get_settings && byName.ui_update_settings);
  for (const tool of appTools) assert.deepEqual(tool._meta.ui.visibility, ['app']);
});

test('settings app tools persist settings through the protocol', async (t) => {
  const { tool, dir } = await fixture(t);
  const initial = (await tool('ui_get_settings')).structuredContent;
  assert.deepEqual(initial, { ok: true, settings: { version: 1, emitSidecarLinks: true, locale: 'auto' }, path: join(dir, 'settings.json') });
  assert.equal((await tool('ui_update_settings', { emitSidecarLinks: false })).structuredContent.settings.emitSidecarLinks, false);
  assert.equal((await tool('ui_get_settings')).structuredContent.settings.emitSidecarLinks, false);
  assert.equal((await tool('ui_update_settings', { emitSidecarLinks: 'no' })).isError, true);
});

test('model tools return readable summaries and board filters', async (t) => {
  const { tool } = await fixture(t);
  const card = await tool('show_task_card', { id: 'ab' });
  assert.equal(card.structuredContent.view, 'detail');
  for (const text of ['ab', 'Test ab', 'open', 'description', 'accept']) assert.ok(card.content[0].text.includes(text));
  const batch = await tool('show_task_batch', { ids: ['ab', 'cd'], title: 'Work' });
  assert.equal(batch.structuredContent.view, 'batch');
  assert.match(batch.content[0].text, /Work \(2\)/);
  assert.match(batch.content[0].text, /- ab \[open\] Test ab/);
  for (const [args, view] of [[{}, 'list'], [{ id: 'ab' }, 'detail'], [{ ids: ['ab', 'cd'] }, 'batch'], [{ status: 'open', query: 'Test' }, 'list']]) {
    const board = await tool('open_tasks_board', args);
    assert.equal(board.structuredContent.view, view);
    assert.match(board.content[0].text, /ab/);
    assert.match(board.content[0].text, /Test ab/);
    assert.match(board.content[0].text, /open/);
    if (args.status) {
      assert.equal(board.structuredContent.status, 'open');
      assert.equal(board.structuredContent.query, 'Test');
      assert.deepEqual(board.structuredContent.data.opts, { status: 'open', query: 'Test' });
    }
  }
});

test('all app tools and persisted review queue', async (t) => {
  const { tool, dir } = await fixture(t);
  for (const [name, args] of [
    ['ui_get_projects', {}], ['ui_get_item', { id: 'ab' }], ['ui_get_batch', { ids: ['ab'] }], ['ui_list_tasks', {}],
    ['ui_update_bead_status', { id: 'ab', status: 'closed' }], ['ui_update_bead_priority', { id: 'ab', priority: 2 }],
    ['ui_append_bead_note', { id: 'ab', text: 'note' }], ['ui_update_bead_label', { id: 'ab', op: 'add', label: 'test' }],
    ['ui_copy_clipboard', { text: 'copy' }],
  ]) assert.equal((await tool(name, args)).structuredContent.ok, true, name);
  assert.equal((await tool('ui_copy_clipboard', { text: '' })).isError, true);
  const queue = { ids: ['ab'] };
  assert.deepEqual((await tool('ui_review_queue', { op: 'set', queue })).structuredContent.queue, queue);
  assert.deepEqual((await tool('ui_review_queue', { op: 'get' })).structuredContent.queue, queue);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'data/review-queue.json'), 'utf8')), queue);
  assert.equal((await tool('ui_review_queue', { op: 'clear' })).structuredContent.queue, null);
  assert.equal(JSON.parse(await readFile(join(dir, 'data/review-queue.json'), 'utf8')), null);
});

test('large model payload is capped but app reads complete data', async (t) => {
  const { tool } = await fixture(t);
  const card = await tool('show_task_card', { id: 'huge' });
  assert.equal(card.structuredContent.payloadTruncated, true);
  assert.match(card.content[0].text, /truncated/i);
  assert.ok(Buffer.byteLength(JSON.stringify(card)) < 1024 * 1024);
  const item = await tool('ui_get_item', { id: 'huge' });
  assert.notEqual(item.structuredContent.payloadTruncated, true);
  assert.equal(item.structuredContent.bead.description, 'x'.repeat(1200000));
});

test('inline module in dist/app.html is syntactically valid', async (t) => {
  const html = await readFile(resolve('mcp/dist/app.html'), 'utf8');
  assert.match(html, /\.inline-row\b/);
  assert.match(html, /\.inline-card\b/);
  assert.match(html, /renderInlineList/);
  assert.match(html, /renderSettingsView/);
  assert.match(html, /toggle-switch/);
  assert.match(html, /inline-search-bar/);
  assert.match(html, /INLINE_ID_RE/);
  const match = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'app.html must contain an inline <script type="module"> block');
  const inline = match[1];
  // A string replace that leaks the host document into the bundle is the regression we guard against.
  assert.doesNotMatch(inline, /<!doctype html>|<html[\s>]/i);
  const dir = await mkdtemp(join(tmpdir(), 'tasks-app-inline-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'app-inline.mjs');
  await writeFile(file, inline);
  await execFileAsync(process.execPath, ['--check', file]);
});

test('issue tracker badges color open green and closed neutral', async () => {
  const css = await readFile(resolve('sidecars/tasks/web/styles.css'), 'utf8');
  const html = await readFile(resolve('mcp/dist/app.html'), 'utf8');
  const badge = (source, selector) => new RegExp(`[^{}]*\\${selector}\\b[^{}]*\\{([^}]*)\\}`).exec(source)?.[1] ?? '';
  for (const source of [css, html]) {
    const open = badge(source, '.st-open');
    assert.match(open, /color:\s*var\(--rt-ok\)/, '.st-open must use --rt-ok');
    assert.match(open, /background:\s*color-mix\(in srgb, var\(--rt-ok\) 13%, transparent\)/);
    const closed = badge(source, '.st-closed');
    assert.ok(closed, '.st-closed must keep a badge rule');
    assert.doesNotMatch(closed, /--rt-ok/);
    assert.match(closed, /color:\s*var\(--rt-(?:fg-muted|fg-2)\)/);
    assert.match(closed, /background:\s*var\(--rt-raised\)/);
    assert.match(closed, /border-color:\s*var\(--rt-border\)/);
  }
});

test('unknown tool and resource return errors', async (t) => {
  const { call, tool } = await fixture(t);
  assert.equal((await tool('does_not_exist')).isError, true);
  assert.ok((await call('resources/read', { uri: 'ui://unknown' })).error);
});
