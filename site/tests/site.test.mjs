import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initialTasks } from '../js/data.js';
import * as data from '../js/data.js';
import { createStore, buildSidecarURL, parseSidecarURL, findTaskIdInText } from '../js/store.js';
import { buildPluginSrcdoc } from '../js/plugin_bundle.js';
import { createMockApi } from '../js/mock_api.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
// dist/ 是构建产物（site/dist/ 不入 Git）：缺失时按需生成本地单文件版，
// 这样新克隆的仓库可直接跑测试；CI 会先执行 build-standalone.mjs 再测试。
const ensureStandalone = async () => {
  try {
    await access(new URL('../dist/antigravity-showcase.html', import.meta.url));
    return;
  } catch {}
  const build = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/build-standalone.mjs', import.meta.url))], { encoding: 'utf8' });
  if (build.status !== 0)
    throw new Error(`缺少 dist/antigravity-showcase.html，且自动构建失败，请先运行 node scripts/build-standalone.mjs：\n${build.stderr || build.stdout}`);
};
test('test-repo 四条任务及关系', () => {
  const tasks = createStore().state.tasks;
  assert.deepEqual(tasks, initialTasks);
  assert.deepEqual(tasks.slice(0, 4).map(t => [t.id,t.type,t.status,t.priority,t.created_by]), [
    ['demo-ptv','epic','open',1,'kokoroX'], ['demo-ptv.1','feature','in_progress',2,'kokoroX'],
    ['demo-ptv.2','task','blocked',3,'kokoroX'], ['demo-o3t','bug','closed',2,'kokoroX']]);
  assert.deepEqual(tasks[2].blockedBy, ['demo-ptv.1']);
});
test('多对话共享任务但独立消息及附着上下文', () => {
  const a = createStore(); a.message('user','旧对话'); a.attachContext({id:'demo-ptv.1',title:'Feature'});
  const id = a.createConversation(); assert.equal(a.state.messages.length,0); assert.equal(a.state.context.length,0);
  a.updatePriority('demo-ptv.1',0); a.attachContext({id:'demo-ptv',title:'Epic'}); a.message('user','查看');
  assert.equal(a.state.messages[0].context[0].id,'demo-ptv'); assert.equal(a.state.context.length,0);
  a.switchConversation('default'); assert.equal(a.state.messages[0].text,'旧对话'); assert.equal(a.state.context[0].id,'demo-ptv.1');
  assert.equal(a.state.tasks[1].priority,0); a.clearContext('demo-ptv.1'); assert.equal(a.state.context.length,0);
  a.switchConversation(id); assert.equal(a.state.messages[0].text,'查看');
  assert.ok(a.state.logs.some(x => x.event === 'ui/update-model-context'));
});
test('MCP 工具与写操作闭环', () => {
  const a = createStore(); a.updateStatus('demo-o3t','open'); a.updatePriority('demo-ptv',0);
  a.appendNote('demo-ptv','备注'); a.addLabel('demo-ptv','新'); a.removeLabel('demo-ptv','新');
  a.copyId('demo-ptv'); a.navigate({ids:['demo-ptv','demo-ptv.1']});
  const calls = a.state.logs.filter(x=>x.event==='app.callServerTool').map(x=>x.payload.params);
  for (const name of ['ui_update_bead_status','ui_update_bead_priority','ui_append_bead_note','ui_update_bead_label','ui_copy_clipboard','ui_review_queue']) assert.ok(calls.some(c=>c.name===name),name);
  assert.deepEqual(calls.filter(c=>c.name==='ui_update_bead_label').map(c=>c.arguments.op).sort(),['add','remove']);
  assert.ok(a.state.logs.some(x=>x.event.includes('bd reopen demo-o3t')));
  assert.throws(()=>a.updatePriority('demo-ptv',5));
});
test('Sidecar 链接一次消费 clip 与评审队列', () => {
  const a=createStore(), route={id:'demo-ptv.1',ids:['demo-ptv','demo-ptv.1'],clip:true,repo:'/test repo',title:'评审'};
  const url=buildSidecarURL(route); assert.deepEqual(parseSidecarURL(url),route);
  assert.equal(parseSidecarURL(a.navigate(url)).clip,false); assert.ok(a.state.logs.some(x=>x.payload.requested===url));
  a.queueMove(0); a.markRead('demo-ptv'); a.queueMove(1); assert.equal(a.state.route.id,'demo-ptv.1');
  a.navigate({ids:route.ids}); assert.deepEqual(a.state.queue.readIds,['demo-ptv']);
});
test('重置生成哈希并保留任务拓扑',()=>{
  const a=createStore(); a.createConversation(); a.message('user','旧内容'); const ids=a.resetTestRepo();
  assert.match(ids[0],/^demo-[a-z0-9]{3}$/); assert.match(ids[3],/^demo-[a-z0-9]{3}$/); assert.notEqual(ids[0],ids[3]);
  assert.equal(ids[1],ids[0]+'.1'); assert.equal(ids[2],ids[0]+'.2'); assert.equal(a.state.tasks[1].parent,ids[0]);
  assert.deepEqual(a.state.tasks[2].blockedBy,[ids[1]]); assert.ok(a.state.conversations.every(c=>!c.messages.length));
});
test('插件桥接使用跨源消息及序列化初始数据', async () => {
  for (const file of ['js/plugin_bundle.js', 'js/workbench.js']) {
    assert.doesNotMatch(await read(file), /window\.parent\.__rscMockHost|contentDocument/);
  }
  const payload = { view: 'batch', ids: ['demo-ptv'], surface: 'inline', projects: [], activeProjectId: 'test-repo' };
  const html = buildPluginSrcdoc({ mode: 'mcp-inline', hostId: 'inline-1', initialPayload: payload });
  assert.match(html, /window\.parent\.postMessage/);
  assert.ok(html.includes(JSON.stringify(payload)));
  assert.match(html, /addEventListener\('message'/);
});
test('真实插件资源与 mock 接口', async () => {
  const html = buildPluginSrcdoc({mode:'sidecar',hostId:'sidecar',search:'?id=demo-ptv'});
  for (const marker of ['--rt-bg', 'id="find-bar"', 'id="batch-nav"', 'id="app-root"', '.is-mcp-inline']) assert.ok(html.includes(marker), marker);
  nesting(html);
  const store = createStore(); let sent = ''; const api = createMockApi(store, {send: text => { sent = text; }, copy: async () => {}});
  const call = async (url, body) => (await api.fetch('sidecar', url, body ? {method:'POST',body:JSON.stringify(body)} : {})).json();
  assert.equal((await call('/api/projects')).projects.length, 2);
  assert.deepEqual((await call('/api/list?project=docs-repo')).items.map(x => x.id), ['docs-a1b']);
  assert.equal((await call('/api/item?project=docs-repo&id=docs-a1b')).bead.title, '完善项目文档');
  assert.equal((await call('/api/bead/status', {project:'docs-repo', id:'demo-ptv', status:'closed'})).ok, false);
  assert.equal(store.state.tasks[0].status, 'open');
  assert.equal((await call('/api/bead/status', {project:'docs-repo', id:'docs-a1b', status:'in_progress'})).item.bead.status, 'in_progress');
  assert.deepEqual((await call('/api/list?project=test-repo&q=demo-ptv.1')).items.map(x => x.id), ['demo-ptv.1']);
  assert.equal((await call('/api/settings', {emitSidecarLinks:false})).settings.emitSidecarLinks, false);
  assert.equal((await call('/api/settings')).settings.emitSidecarLinks, false);
  assert.equal((await call('/api/list')).items.length, 4);
  assert.equal((await call('/api/batch?ids=demo-ptv,missing')).missing.length, 1);
  const batch = await call('/api/batch?ids=demo-ptv,demo-ptv.1,demo-ptv.2,demo-o3t');
  assert.equal(batch.counts.found, 4);
  assert.equal(batch.counts.total, 4);
  assert.deepEqual(Object.keys(batch.counts).sort(), ['blocked', 'closed', 'deferred', 'found', 'in_progress', 'open', 'other', 'total']);
  for (const st of ['open', 'in_progress', 'blocked', 'closed']) assert.equal(batch.counts[st], 1, st);
  assert.equal(batch.counts.other, 0);
  assert.equal((await call('/api/batch?ids=demo-ptv,missing')).counts.found, 1);
  assert.equal((await call('/api/item?id=demo-ptv')).bead.issue_type, 'epic');
  assert.equal((await call('/api/bead/status', {id:'demo-ptv', status:'blocked'})).item.bead.status, 'blocked');
  assert.equal((await call('/api/bead/priority', {id:'demo-ptv', priority:0})).item.bead.priority, 0);
  assert.match((await call('/api/bead/note', {id:'demo-ptv', text:'测试'})).item.bead.notes, /测试/);
  assert.ok((await call('/api/bead/label', {id:'demo-ptv', op:'add', label:'新'})).item.bead.labels.includes('新'));
  assert.equal((await call('/api/clipboard', {text:'demo-ptv'})).ok, true);
  assert.equal((await call('/api/agent/send', {prompt:'你好'})).ok, true); assert.equal(sent,'你好');
  assert.doesNotMatch(await read('styles.css'), /\.(?:view|info-view|info-inner|info-grid|custom-strip|mechanisms)\b/);
});
test('Inline iframe 调高基于 .shell 且可随内容收缩', async () => {
  const bundle = await read('js/plugin_bundle.js');
  assert.match(bundle, /const target = document\.querySelector\('\.shell'\) \|\| document\.body;/);
  assert.match(bundle, /target\.getBoundingClientRect\(\)\.height/);
  assert.match(bundle, /new ResizeObserver\(resize\)\.observe\(target\)/);
  assert.match(bundle, /new MutationObserver\(\(\) => requestAnimationFrame\(resize\)\)\.observe\(target, \{ childList: true, subtree: true, attributes: true, attributeFilter: \['class', 'hidden', 'style'\] \}\)/);
  assert.match(bundle, /if \(height === lastHeight\) return;/);
  assert.match(bundle, /height: auto !important; min-height: 0 !important/);
  assert.doesNotMatch(bundle, /document\.documentElement\.scrollHeight/);
  const inlineHtml = buildPluginSrcdoc({ mode: 'mcp-inline', hostId: 'inline-1', initialPayload: { surface: 'inline', ids: [] } });
  assert.ok(inlineHtml.includes("querySelector('.shell')"));
  const workbench = await read('js/workbench.js');
  assert.match(workbench, /frame\.style\.height = `\$\{Math\.max\(80, Math\.min\(560, msg\.height\)\)\}px`/);
  assert.doesNotMatch(workbench, /Math\.max\(parseFloat\(frame\.style\.height/);
  assert.match(await read('styles.css'), /\.inline-frame\{[^}]*min-height:80px/);
});
const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function nesting(html) {
  const stack=[]; let raw='';
  for (const m of html.matchAll(/<!--(?:[\s\S]*?)-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if(m[0].startsWith('<!--')) continue;
    const close=!!m[1], tag=m[2].toLowerCase();
    if(raw && !(close && tag===raw)) continue;
    if(raw) raw='';
    if(voids.has(tag)||/\/\s*$/.test(m[3])) continue;
    if(close) assert.equal(stack.pop(),tag,`标签 ${tag}`);
    else { stack.push(tag); if(['script','style','textarea','title'].includes(tag)) raw=tag; }
  }
  assert.deepEqual(stack,[]);
}
test('精简架构、本地资源与标签配对',async()=>{
  const html=await read('index.html'); nesting(html);
  for(const id of ['intro','playground','install','workbench-root']) assert.match(html,new RegExp(`id="${id}"`));
  const introIdx=html.indexOf('id="intro"'), installIdx=html.indexOf('id="install"'), playgroundIdx=html.indexOf('id="playground"');
  assert.ok(introIdx>0 && installIdx>0 && playgroundIdx>0);
  assert.ok(introIdx<installIdx && installIdx<playgroundIdx,'段落顺序应为 intro < install < playground');
  assert.equal([...html.matchAll(/<section id="([^"]+)"/g)].at(-1)[1],'playground','#playground 应位于页面最底部');
  const footerIdx=html.indexOf('<footer');
  assert.ok(footerIdx>installIdx && footerIdx<playgroundIdx,'页脚应位于 #install 与 #playground 之间');
  assert.ok(html.indexOf('id="workbench-root"')>playgroundIdx);
  assert.doesNotMatch(html,/关于 Antigravity|Antigravity CLI|Python SDK|id="(?:about|extensions)"/);
  assert.deepEqual(Object.keys(data).sort(), ['initialTasks','projects']);
  for(const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)){if (!m[1].startsWith('#') && !m[1].startsWith('https://')) await access(new URL('../'+m[1],import.meta.url));}
  const css=await read('styles.css'); assert.doesNotMatch(css,/@import|url\(["']?https?:|overscroll-behavior\s*:\s*contain/);
  assert.match(css,/#playground\s*\{[^}]*height\s*:\s*calc\(100vh\s*-\s*48px\)/);
  const app=await read('js/app.js'); assert.match(app,/IntersectionObserver/); assert.match(app,/hostThemeChanged\(theme\)/); assert.doesNotMatch(app,/data-view/);
  const workbench=await read('js/workbench.js'); assert.doesNotMatch(workbench,/window\.alert/);
  for(const name of ['/list','/show','/batch','/board','/reopen','/reset','show_task_card','show_task_batch','open_tasks_board','ui/notifications/host-context-changed']) assert.ok(workbench.includes(name),name);
});
test('侧栏回传多行 Markdown 识别任务而非误判 /show', async () => {
  const prompt = '请继续处理任务：\n\n## 任务上下文\n\n- ID: demo-ptv.1\n- 标题: Feature: 侧栏回传\n- 类型: Feature\n- 状态: in_progress\n\n详情见任务卡片。';
  assert.equal(findTaskIdInText(prompt, initialTasks), 'demo-ptv.1');
  assert.equal(findTaskIdInText('## 任务上下文\nFeature 详情', initialTasks), '');
  const store = createStore();
  const api = createMockApi(store, { copy: async () => {} });
  const res = await (await api.fetch('sidecar', '/api/agent/send', {method:'POST',body:JSON.stringify({prompt})})).json();
  assert.equal(res.ok, true);
  const msgs = store.state.messages;
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].text, prompt);
  const last = msgs[msgs.length - 1];
  assert.equal(last.role, 'assistant');
  assert.equal(last.kind, 'card');
  assert.deepEqual(last.ids, ['demo-ptv.1']);
  assert.match(last.text, /demo-ptv\.1/);
  assert.equal(last.tool?.name, 'show_task_card');
  assert.doesNotMatch(JSON.stringify(msgs), /任务不存在/);
});
test('dist 单文件完整内联且脚本有效',async()=>{
  await ensureStandalone();
  const html=await read('dist/antigravity-showcase.html'); nesting(html);
  const outerHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  assert.doesNotMatch(outerHtml,/<link\b[^>]*styles\.css|<script\b[^>]*\bsrc=|type="module"/i);
  assert.match(html,/<style>[\s\S]*--color-background-primary/);
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]; assert.equal(scripts.length,1);
  assert.doesNotThrow(()=>new Function(scripts[0][1])); assert.doesNotMatch(scripts[0][1],/^\s*(?:import|export)\b/m);
  assert.match(html,/id="workbench-root"/);
});
