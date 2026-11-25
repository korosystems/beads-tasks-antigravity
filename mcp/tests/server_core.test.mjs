import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTasksMcpCore } from '../src/server_factory.mjs';

test('pure core exposes Beads tools and handles settings and cards', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'beads-core-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const client = { fetchItem: async (...args) => { calls.push(args); return { ok: true, id: args[0], bead: { id: args[0], title: 'Example' } }; } };
  const core = createTasksMcpCore({ client, settingsDeps: { settingsFile: join(dir, 'settings.json') } });
  assert.ok(!core.tools.some((tool) => tool.name === 'ui_run_task_action'));
  assert.ok(core.tools.every((tool) => tool.name !== 'ui_run_task_action'));
  assert.equal((await core.run('ui_get_settings', {})).ok, true);
  const card = await core.run('show_task_card', { id: 'abc-1' });
  assert.equal(card.view, 'detail');
  assert.equal(card.data.bead.title, 'Example');
  assert.equal(calls[0][0], 'abc-1');
});
