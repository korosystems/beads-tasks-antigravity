import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MESSAGES, normalizeLocale, resolveLocale, createTranslator } from '../web/i18n.mjs';

test('translations have matching nonempty keys', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES['zh-CN']).sort());
  for (const messages of Object.values(MESSAGES)) for (const value of Object.values(messages)) assert.ok(value.trim());
});
test('English translations contain no Chinese characters', () => {
  for (const [key, value] of Object.entries(MESSAGES.en)) {
    assert.doesNotMatch(value, /[\u4e00-\u9fff]/, key);
  }
});
test('app source routes Chinese UI strings through registered translations', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const withoutTranslations = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g, (_match, _quote, key) => {
      assert.ok(Object.hasOwn(MESSAGES.en, key), `Missing translation: ${key}`);
      return 't(';
    });
  assert.doesNotMatch(withoutTranslations, /[\u4e00-\u9fff]/);
});
test('locale normalization and precedence', () => {
  assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('fr'), '');
  assert.equal(resolveLocale({ setting: 'en', hostLocale: 'zh' }), 'en');
  assert.equal(resolveLocale({ hostLocale: 'zh', configLocale: 'en', navigatorLocale: 'en' }), 'zh-CN');
  assert.equal(resolveLocale({ configLocale: 'zh', navigatorLocale: 'en' }), 'zh-CN');
  assert.equal(resolveLocale({ navigatorLocale: 'zh' }), 'zh-CN');
  assert.equal(resolveLocale(), 'en');
  assert.equal(resolveLocale({ hostLocale: 'fr', navigatorLocale: 'zh' }), 'en');
});
test('translator interpolates and falls back', () => {
  const t = createTranslator('unknown');
  assert.equal(t('设置'), 'Settings');
  assert.equal(t('Hello {name}', { name: 'Ada' }), 'Hello Ada');
  assert.equal(t('missing'), 'missing');
});
test('MCP bundle contains i18n', async () => {
  assert.match(await readFile(new URL('../../../mcp/dist/app.html', import.meta.url), 'utf8'), /__tasksI18n/);
});
