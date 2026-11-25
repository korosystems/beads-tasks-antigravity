import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, resolveSettingsFile, normalizeSettings, loadSettings, saveSettings } from '../settings.mjs';

test('settings environment extensions are opt-in', () => {
  const previousCore = process.env.BEADS_TASKS_SETTINGS_FILE;
  const previousExtra = process.env.TASKS_TEST_SETTINGS_FILE;
  delete process.env.BEADS_TASKS_SETTINGS_FILE;
  process.env.TASKS_TEST_SETTINGS_FILE = '/tmp/extension-settings.json';
  try {
    assert.notEqual(resolveSettingsFile(), process.env.TASKS_TEST_SETTINGS_FILE);
    assert.equal(resolveSettingsFile({ extraEnvKeys: ['TASKS_TEST_SETTINGS_FILE'] }), process.env.TASKS_TEST_SETTINGS_FILE);
    process.env.BEADS_TASKS_SETTINGS_FILE = '/tmp/core-settings.json';
    assert.equal(resolveSettingsFile({ extraEnvKeys: ['TASKS_TEST_SETTINGS_FILE'] }), '/tmp/core-settings.json');
  } finally {
    if (previousCore === undefined) delete process.env.BEADS_TASKS_SETTINGS_FILE;
    else process.env.BEADS_TASKS_SETTINGS_FILE = previousCore;
    if (previousExtra === undefined) delete process.env.TASKS_TEST_SETTINGS_FILE;
    else process.env.TASKS_TEST_SETTINGS_FILE = previousExtra;
  }
});

test('settings default, validation, persistence and damaged files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const deps = { settingsFile: join(dir, 'nested/settings.json') };
  assert.equal(resolveSettingsFile(deps), deps.settingsFile);
  assert.deepEqual(await loadSettings(deps), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ version: 9, emitSidecarLinks: 0, other: true }), DEFAULT_SETTINGS);
  assert.deepEqual(await saveSettings({ emitSidecarLinks: false }, deps), { settings: { version: 1, emitSidecarLinks: false }, path: deps.settingsFile });
  assert.equal((await loadSettings(deps)).emitSidecarLinks, false);
  await assert.rejects(saveSettings({ emitSidecarLinks: 'false' }, deps), { code: 'EINVALID' });
  await writeFile(deps.settingsFile, '{broken');
  assert.deepEqual(await loadSettings(deps), DEFAULT_SETTINGS);
  await writeFile(deps.settingsFile, '');
  assert.deepEqual(await loadSettings(deps), DEFAULT_SETTINGS);
});
