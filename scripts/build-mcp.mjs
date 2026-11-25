import { build } from '../mcp/node_modules/esbuild/lib/main.js';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildMcpBundle(options = {}) {
const { root = defaultRoot, webDir = 'sidecars/tasks/web', distDir = 'mcp/dist', serverEntry = 'mcp/src/server.mjs', bridgeEntry = 'mcp/web/bridge.mjs', external = ['../../sidecars/tasks/*'], extraScripts = [], extraCss = [], uiConfig = { title: 'Beads Tasks', storageKey: 'beads-tasks-review-queue' }, htmlTitle = 'Beads Tasks' } = options;
const web = resolve(root, webDir);
const dist = resolve(root, distDir);
await mkdir(dist, { recursive: true });
await build({
  entryPoints: [resolve(root, serverEntry)],
  outfile: resolve(dist, 'server.mjs'),
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
const bridge = await build({
  entryPoints: [resolve(root, bridgeEntry)],
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  target: 'es2022',
});
async function moduleWrapper(file, exports) {
  const text = (await readFile(resolve(web, file), 'utf8')).replace(/\bexport\s+(const|function)\s+/g, '$1 ');
  return `(()=>{\n${text}\nwindow.${exports};\n})();`;
}
const scripts = [
  `window.__tasksUiConfig = ${JSON.stringify(uiConfig).replace(/</g, '\\u003c')};`,
  ...await Promise.all(extraScripts.map(file => readFile(resolve(root, file), 'utf8'))),
  bridge.outputFiles[0].text,
  await moduleWrapper('i18n.mjs', '__tasksI18n = { SUPPORTED_LOCALES, normalizeLocale, resolveLocale, MESSAGES, createTranslator }'),
  await moduleWrapper('notes_format.mjs', '__tasksNotesFormat = { formatBeadNotesForDisplay }'),
  await moduleWrapper('in_page_search.mjs', '__tasksInPageSearch = { MAX_FIND_MARKS, normalizeFindQuery, findTextRanges, splitTextByMatches, nextMatchIndex, shouldHandleFindShortcut }'),
  await moduleWrapper('review_queue.mjs', '__tasksReviewQueue = { queueNeighbors, shouldHandleQueueShortcut, shouldRestoreSavedQueue }'),
  await readFile(resolve(web, 'app.js'), 'utf8'),
]
  // Join with an explicit `;\n` so a minified statement without a trailing semicolon
  // cannot glue onto the next chunk's leading `(()=>{`.
  .join(';\n')
  .replace(/<\/script/gi, () => '<\\/script');
const styles = [await readFile(resolve(web, 'styles.css'), 'utf8'), ...await Promise.all(extraCss.map(file => readFile(resolve(root, file), 'utf8')))].join('\n');
let html = await readFile(resolve(web, 'index.html'), 'utf8');
html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${String(htmlTitle).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`);
// Every replacement uses a function callback: the host and injected sources contain
// `$&` / `$'` sequences that String.prototype.replace would otherwise interpret.
html = html.replace(/\s*<script src="\/preload\.js"><\/script>/, () => '')
  .replace(/<link rel="stylesheet" href="\/styles\.css\?v=\d+"\s*\/>/, () => `<style>${styles}</style>`)
  .replace(/\s*<script src="\/(?:i18n|notes_format|in_page_search|review_queue|app)\.js\?v=\d+"><\/script>/g, () => '');
html = html.replace('</body>', () => `<script type="module">\n${scripts}\n</script>\n</body>`);
await writeFile(resolve(dist, 'app.html'), html);

// Fail the build if the inline module cannot be parsed by the browser.
const inline = /<script type="module">\n([\s\S]*?)\n<\/script>\n<\/body>/.exec(html)?.[1];
if (!inline) throw Error('build-mcp: failed to locate the inline <script type="module"> block in app.html');
if (/<!doctype html>|<html[\s>]/i.test(inline)) throw Error('build-mcp: inline script contains injected HTML, replacement went wrong');
for (const part of [bridge.outputFiles[0].text, await readFile(resolve(web, 'app.js'), 'utf8')]) {
  if (!inline.includes(part.slice(0, 200))) throw Error('build-mcp: inline script is missing an injected bundle chunk');
}
const checkDir = await mkdtemp(join(tmpdir(), 'beads-tasks-build-'));
try {
  const checkFile = join(checkDir, 'app-inline.mjs');
  await writeFile(checkFile, inline);
  const check = spawnSync(process.execPath, ['--check', checkFile], { encoding: 'utf8' });
  if (check.status !== 0) throw Error(`build-mcp: inline module failed node --check\n${check.stderr || check.stdout}`);
} finally {
  await rm(checkDir, { recursive: true, force: true });
}
console.log(`build-mcp: wrote dist/app.html (${html.length} bytes) and dist/server.mjs; inline module passed node --check`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMcpBundle();
}
