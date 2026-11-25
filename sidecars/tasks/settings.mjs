import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_SETTINGS = Object.freeze({ version: 1, emitSidecarLinks: true, locale: 'auto' });
export const ALLOWED_LOCALES = new Set(['auto', 'en', 'zh-CN']);
export function resolveSettingsFile(deps = {}) {
  return deps.settingsFile || process.env.BEADS_TASKS_SETTINGS_FILE || (deps.extraEnvKeys || []).map((key) => process.env[key]).find(Boolean) || join(homedir(), '.config', 'beads-tasks', 'settings.json');
}
export function normalizeSettings(raw) {
  return { version: 1, emitSidecarLinks: raw?.emitSidecarLinks !== false, locale: ALLOWED_LOCALES.has(raw?.locale) ? raw.locale : 'auto' };
}
export async function loadSettings(deps = {}) {
  try {
    const text = await readFile(resolveSettingsFile(deps), 'utf8');
    return text.trim() ? normalizeSettings(JSON.parse(text)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export async function saveSettings(patch, deps = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || ('emitSidecarLinks' in patch && typeof patch.emitSidecarLinks !== 'boolean') || ('locale' in patch && !ALLOWED_LOCALES.has(patch.locale))) {
    throw Object.assign(new Error('invalid settings'), { code: 'EINVALID' });
  }
  const path = resolveSettingsFile(deps);
  const settings = normalizeSettings({ ...await loadSettings(deps), ...patch });
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { settings, path };
}
