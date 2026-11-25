import test from 'node:test';
import assert from 'node:assert/strict';
import { createTasksClient, execBd } from '../beads_client.mjs';
import { defaultPaths, normalizeProject, resolveProjectContext } from '../project_resolver.mjs';

const ctx = { id: 'p', name: 'Project', repo: '/repo', bdDir: '/repo/.beads' };
function fixture() {
  const calls = [];
  const deps = {
    existsSync: () => true,
    readFileSync: () => '{"dolt_mode":"embedded"}',
    execFile: async (bin, args, options) => {
      calls.push({ bin, args, options });
      if (args[0] === 'show') return { stdout: JSON.stringify(args.slice(2).map((id) => ({ id, title: id, status: 'open' }))) };
      if (args[0] === 'list') return { stdout: JSON.stringify([{ id: 'abc-1', title: 'Example', status: 'open' }]) };
      return { stdout: '' };
    },
  };
  return { calls, deps };
}

test('pure client reads items, batches and project list with bd', async () => {
  const client = createTasksClient();
  const { calls, deps } = fixture();
  assert.equal((await client.fetchItem('abc-1', ctx, [], deps)).bead.id, 'abc-1');
  const batch = await client.fetchBatch(['abc-1', 'abc-2'], ctx, [], deps);
  assert.deepEqual(batch.items.map((i) => i.id), ['abc-1', 'abc-2']);
  const list = await client.fetchProjectList(ctx, { includeClosed: true }, deps);
  assert.equal(list.items[0].id, 'abc-1');
  assert.deepEqual(calls.map((c) => c.args), [
    ['show', '--json', 'abc-1'], ['show', '--json', 'abc-1', 'abc-2'], ['list', '--all', '--limit', '40', '--json'],
  ]);
});

test('pure client writes status, priority, notes and labels with bd', async () => {
  const client = createTasksClient();
  const { calls, deps } = fixture();
  await client.updateBeadStatus('abc-1', { status: 'closed', reason: 'done' }, ctx, deps);
  await client.updateBeadPriority('abc-1', 2, ctx, deps);
  await client.appendBeadNote('abc-1', ' note ', ctx, deps);
  await client.updateBeadLabel('abc-1', { op: 'add', label: 'test' }, ctx, deps);
  assert.deepEqual(calls.map((c) => c.args), [
    ['close', 'abc-1', '--reason', 'done'], ['update', 'abc-1', '--priority', '2'],
    ['update', 'abc-1', '--append-notes', 'note'], ['update', 'abc-1', '--add-label', 'test'],
  ]);
});

test('embedded dolt clears server settings and missing bd gives guidance', async () => {
  const { calls, deps } = fixture();
  const previous = process.env.BEADS_DOLT_SERVER_MODE;
  process.env.BEADS_DOLT_SERVER_MODE = '1';
  try {
    await execBd(['list'], ctx, deps);
    assert.equal(calls[0].options.env.BEADS_DOLT_SERVER_MODE, undefined);
    assert.equal(calls[0].options.env.BEADS_DIR, ctx.bdDir);
    await assert.rejects(execBd(['list'], ctx, { ...deps, execFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }), /未检测到 bd 命令/);
  } finally {
    if (previous === undefined) delete process.env.BEADS_DOLT_SERVER_MODE;
    else process.env.BEADS_DOLT_SERVER_MODE = previous;
  }
});

test('pure project resolver reads only the beads configuration and omits extension fields', async () => {
  const paths = defaultPaths({ homedir: () => '/home/test', existsSync: () => false });
  assert.deepEqual(paths.projectsFileCandidates, ['/home/test/.config/beads-tasks/projects.json']);
  const project = normalizeProject({ id: 'p', repo: '/repo', db: '/db', config: '/config' });
  assert.equal('db' in project, false);
  assert.equal('config' in project, false);
  const reads = [];
  const resolved = await resolveProjectContext({}, { homedir: () => '/home/test', fsApi: { existsSync: () => true, readFileSync: (p) => { reads.push(p); return JSON.stringify({ projects: [{ id: 'p', repo: '/repo', db: '/db' }] }); } } });
  assert.deepEqual(reads, ['/home/test/.config/beads-tasks/projects.json']);
  assert.equal('db' in resolved, false);
  assert.equal('config' in resolved, false);
});
