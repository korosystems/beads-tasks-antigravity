#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings } from '../sidecars/tasks/settings.mjs';

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const data = input.trim() ? JSON.parse(input) : {};
  const id = typeof data?.conversationId === 'string' ? data.conversationId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 128) : '';
  const current = (await loadSettings()).emitSidecarLinks;
  let previous = true;
  const dir = process.env.BEADS_TASKS_HOOK_STATE_DIR || join(tmpdir(), 'beads-tasks-hook-state');
  // Dot-only names must not escape or alias the state directory.
  const file = id && id !== '.' && id !== '..' ? join(dir, `${id}.json`) : '';
  if (file) {
    try { previous = JSON.parse(await readFile(file, 'utf8')).emitSidecarLinks !== false; } catch { /* default on */ }
  }
  let output = {};
  if ((!file && !current) || (file && previous !== current)) {
    if (file) {
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify({ emitSidecarLinks: current }));
    }
    const message = current
      ? '[Beads Tasks Settings] Sidecar links enabled / 用户已重新开启侧栏链接：follow the Beads Tasks link rules in subsequent replies.'
      : '[Beads Tasks Settings] Sidecar links disabled / 用户已关闭侧栏链接：omit all sidecar:// links, keep IDs as inline code; show_task_batch remains available.';
    output = { injectSteps: [{ systemMessage: { systemMessage: message } }] };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch {
  process.stdout.write('{}\n');
}
