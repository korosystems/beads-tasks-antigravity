import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { saveSettings } from '../settings.mjs';

test('hook injects only on transitions and fails open', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-hook-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsFile = join(dir, 'settings.json');
  const run = (input) => new Promise((ok, fail) => {
    const proc = spawn(process.execPath, [resolve('scripts/hook-settings.mjs')], { env: { ...process.env, BEADS_TASKS_SETTINGS_FILE: settingsFile, BEADS_TASKS_HOOK_STATE_DIR: join(dir, 'state') } });
    let out = '';
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.on('error', fail);
    proc.on('close', (code) => { try { assert.equal(code, 0); ok(JSON.parse(out)); } catch (err) { fail(err); } });
    proc.stdin.end(input);
  });
  const input = JSON.stringify({ conversationId: 'test' });
  assert.deepEqual(await run(input), {});
  await saveSettings({ emitSidecarLinks: false }, { settingsFile });
  assert.match((await run(input)).injectSteps[0].systemMessage.systemMessage, /\[Beads Tasks Settings\].*已关闭/);
  assert.deepEqual(await run(input), {});
  await saveSettings({ emitSidecarLinks: true }, { settingsFile });
  assert.match((await run(input)).injectSteps[0].systemMessage.systemMessage, /重新开启/);
  await saveSettings({ emitSidecarLinks: false }, { settingsFile });
  assert.match((await run(input)).injectSteps[0].systemMessage.systemMessage, /已关闭/);
  assert.match((await run('')).injectSteps[0].systemMessage.systemMessage, /已关闭/);
  assert.deepEqual(await run('{broken'), {});
});
