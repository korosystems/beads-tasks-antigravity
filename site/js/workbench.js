import { createStore, buildSidecarURL, findTaskIdInText, statuses } from "./store.js";
import { buildPluginSrcdoc } from "./plugin_bundle.js";
import { createMockApi } from "./mock_api.js";
import { getSiteCopy, localizeDemoTask } from "./i18n.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const PLUGIN_ICON_DATA_URI = "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\" width=\"128\" height=\"128\" fill=\"none\">\n  <defs>\n    <linearGradient id=\"bg\" x1=\"64\" y1=\"12\" x2=\"64\" y2=\"116\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#4BA3FA\"/><stop offset=\"1\" stop-color=\"#2463D8\"/></linearGradient>\n    <linearGradient id=\"gold\" x1=\"30\" y1=\"31\" x2=\"30\" y2=\"53\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#FFD447\"/><stop offset=\"1\" stop-color=\"#F7B22A\"/></linearGradient>\n  </defs>\n  <rect x=\"12\" y=\"12\" width=\"104\" height=\"104\" rx=\"26\" fill=\"url(#bg)\"/>\n  <g transform=\"translate(12 12) scale(1.625)\">\n    <path d=\"M 13.5 40.2 Q 13.5 38.2 14.9 39.6 L 21.9 46.6 A 6.5 6.5 0 0 0 31.1 46.6 L 45.1 32.6 Q 46.5 31.2 46.5 33.2 L 46.5 49 A 4 4 0 0 1 42.5 53 L 17.5 53 A 4 4 0 0 1 13.5 49 Z\" fill=\"url(#gold)\"/>\n    <path d=\"M 15.5 31 L 26.5 42 L 51.5 17\" stroke=\"#fff\" stroke-width=\"7.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  </g>\n</svg>");
const pluginIcon = (extra = "") => `<img class="plugin-icon ${extra}" src="${PLUGIN_ICON_DATA_URI}" alt="" aria-hidden="true" />`;
const statusName = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  deferred: "Deferred",
  closed: "Closed",
};
export function mountWorkbench(root, options = {}) {
  let currentLocale = options.locale === "zh-CN" ? "zh-CN" : "en";
  const originalText = new WeakMap(), originalAttributes = new WeakMap();
  function translateChrome() {
    const copy = getSiteCopy(currentLocale);
    const translate = value => {
      const trimmed = value.trim();
      if (copy[trimmed]) return value.replace(trimmed, copy[trimmed]);
      if (/^新对话 \d+$/.test(trimmed)) return currentLocale === "en" ? trimmed.replace("新对话", "New conversation") : value;
      if (/^这里是 .+ 的任务详情。$/.test(trimmed)) return currentLocale === "en" ? trimmed.replace(/^这里是 (.+) 的任务详情。$/, "Task details for $1.") : value;
      for (const key of Object.keys(copy).sort((a, b) => b.length - a.length)) {
        if (value.includes(key) && (/[\u4e00-\u9fff]/.test(key) || ['New Conversation', 'Settings', 'Ran', 'events', 'tasks'].includes(key))) value = value.replaceAll(key, copy[key]);
      }
      return value;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest("iframe, pre, .context-pills")) continue;
      if (!originalText.has(node)) originalText.set(node, node.nodeValue);
      node.nodeValue = translate(originalText.get(node));
    }
    root.querySelectorAll("[title], [placeholder], [aria-label]").forEach(el => {
      for (const attr of ["title", "placeholder", "aria-label"]) {
        if (!el.hasAttribute(attr)) continue;
        if (!originalAttributes.has(el)) originalAttributes.set(el, {});
        const attrs = originalAttributes.get(el);
        if (!(attr in attrs)) attrs[attr] = el.getAttribute(attr);
        el.setAttribute(attr, translate(attrs[attr]));
      }
    });
  }
  const store = createStore(),
    s = store.state;
  const ui = {
    view: "chat",
    sideSearch: "",
    inlineSearch: "",
    boardSearch: "",
    sideStatus: "all",
    inlineStatus: "all",
    boardStatus: "all",
    expanded: "",
    find: false,
    findText: "",
    findIndex: 0,
    only: false,
    explain: false,
    inspector: true,
    channel: "all",
    openLogs: new Set(),
    toast: "",
    sidebar: !window.matchMedia("(max-width: 760px)").matches, auxiliary: !window.matchMedia("(max-width: 760px)").matches, tab: "side", settings: false,
    prompt: "", menu: "", menuIndex: 0, model: "Gemini", permission: "Ask first",
  };
  const commands = [["/list", "列出全部任务"], ["/show", "查看进行中 Feature"], ["/batch", "打开评审队列"], ["/board", "打开全页看板"], ["/reopen", "重新打开 Bug"], ["/reset", "重置沙盒"]];
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.append(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
  };
  let toastTimer;
  function toast(text) {
    ui.toast = text;
    renderToast();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast = "";
      renderToast();
    }, 3000);
  }
  const buttons = (id) =>
    `<button class="sidecar-pill" data-action="copy-id" data-id="${esc(id)}" title="复制 ID 并打开侧栏">${pluginIcon("sidecar-pill-icon")}<span>⧉</span></button><button class="sidecar-pill" data-action="open" data-id="${esc(id)}" title="在侧栏打开">${pluginIcon("sidecar-pill-icon")}<span>↗</span></button>`;
  const statusSelect = (value, which) =>
    `<select aria-label="状态筛选" data-filter="${which}Status"><option value="all">所有状态</option>${statuses.map((x) => `<option value="${x}" ${value === x ? "selected" : ""}>${statusName[x]}</option>`).join("")}</select>`;
  const statusButtons = (t) =>
    `<div class="status-buttons">${statuses.map((x) => `<button data-action="status" data-id="${esc(t.id)}" data-value="${x}" class="${t.status === x ? "active" : ""}">${statusName[x]}</button>`).join("")}</div>`;
  const matching = (tasks, query, status) =>
    tasks.filter(
      (t) =>
        (status === "all" || t.status === status) &&
        `${t.id} ${t.title} ${t.description} ${t.labels.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  function cards(tasks, scope) {
    return tasks.length
      ? tasks
          .map(
            (t) =>
              `<article class="task-card"><div class="task-top"><span class="type ${esc(t.type)}">${esc(t.type)}</span><span class="pill ${esc(t.status)}">${statusName[t.status]}</span>${scope === "side" && s.queue.ids.includes(t.id) && s.queue.readIds.includes(t.id) ? '<span class="pill closed">✓ 已读</span>' : ""}<span class="priority">P${t.priority}</span></div><button class="task-title" data-action="${scope === "side" ? "open" : "expand"}" data-id="${esc(t.id)}">${esc(t.title)}</button><div class="task-bottom"><code>${esc(t.id)}</code><span>${buttons(t.id)}</span></div>${(ui.expanded === t.id || scope === "single") && scope !== "side" ? `<p>${esc(t.description)}</p>${statusButtons(t)}<button class="text-button" data-action="attach" data-id="${esc(t.id)}">◈ 附着到下一条消息</button>` : scope !== "side" ? `<button class="text-button" data-action="attach" data-id="${esc(t.id)}">◈ 附着上下文</button>` : ""}</article>`,
          )
          .join("")
      : '<p class="empty">没有匹配的任务。</p>';
  }
  function list(scope, ids = s.tasks.filter((t) => t.projectId === "test-repo").map((t) => t.id)) {
    const search = ui[scope + "Search"],
      status = ui[scope + "Status"];
    let tasks = matching(
      s.tasks.filter((t) => ids.includes(t.id)),
      search,
      status,
    );
    if (scope === "side" && ui.only && ui.findText)
      tasks = matching(tasks, ui.findText, "all");
    return `<div class="list-tools"><input data-filter="${scope}Search" value="${esc(search)}" placeholder="搜索任务或 ID" aria-label="搜索任务">${statusSelect(status, scope)}</div><div class="task-list">${cards(tasks, scope)}</div>`;
  }
  function inline(ids, kind) {
    const search = kind === 'card' ? `?id=${encodeURIComponent(ids[0])}` : `?ids=${encodeURIComponent(ids.join(','))}`;
    return `<iframe class="plugin-frame inline-frame" title="Beads Tasks MCP" data-plugin="mcp-inline" data-search="${esc(search)}"></iframe>`;
  }
  function menuItems() {
    const query = ui.prompt.match(/(?:^|\s)[/@]([^\s]*)$/)?.[1]?.toLowerCase() || "";
    const items = ui.menu === "slash" ? commands.map(([id, title]) => ({ id, title })) : [...s.tasks.map((t) => ({ id: t.id, title: localizeDemoTask(t, currentLocale).title })), { id: "Beads Tasks (MCP)", title: "MCP" }];
    return items.filter((item) => `${item.id} ${item.title}`.toLowerCase().includes(query));
  }
  function menu() {
    if (!ui.menu) return "";
    return `<div class="composer-menu">${menuItems().map((item, i) => `<button type="button" data-action="menu" data-value="${i}" class="${i === ui.menuIndex ? "active" : ""}"><b>${esc(item.id)}</b><span>${esc(item.title)}</span></button>`).join("") || '<small>没有匹配项</small>'}</div>`;
  }
  function chooseMenu(index) {
    const item = menuItems()[index]; if (!item) return;
    if (ui.menu === "slash") ui.prompt = ui.prompt.replace(/(?:^|\s)\/[^\s]*$/, item.id);
    else { ui.prompt = ui.prompt.replace(/(?:^|\s)@[^\s]*$/, "").trim(); store.attachContext(item); }
    ui.menu = ""; render(); root.querySelector('[name="prompt"]')?.focus();
  }
  function chat() {
    return `<div class="chat-scroll">${s.messages.length ? "" : '<div class="welcome"><span>✳</span><h3>开始探索任务。</h3><p>从左侧选择一个演练，或直接输入指令。</p></div>'}${s.messages
      .map(
        (m) =>
          `<div class="message ${m.role}"><div class="avatar">${m.role === "user" ? "你" : "✳"}</div><div class="message-body"><b>${m.role === "user" ? "You" : "Antigravity"}</b><p>${esc(m.text)}</p>${m.context?.length ? `<div class="context-pills">${m.context.map((x) => `<span>◈ ${esc(x.id)} · ${esc(x.title)}</span>`).join("")}</div>` : ""}${m.tool ? `<details class="tool-pill"><summary>✓ Ran ${esc(m.tool.name)} · ${m.kind === "card" ? esc(m.ids[0]) : `${m.ids.length} tasks`}</summary><pre>${esc(JSON.stringify({ request: { method: "tools/call", params: { name: m.tool.name, arguments: m.tool.arguments } }, result: { tasks: m.tool.result } }, null, 2))}</pre></details>` : ""}${
            m.ids.length
              ? `<div class="id-links">${m.ids
                  .map(
                    (id) =>
                      `<span><code>${esc(id)}</code> ${m.ids.length <= 5 ? buttons(id) : m.ids.length <= 10 ? `<button class="sidecar-pill" data-action="open" data-id="${esc(id)}" title="在侧栏打开">${pluginIcon("sidecar-pill-icon")}<span>↗</span></button>` : ""}</span>`,
                  )
                  .join(
                    "",
                  )}</div>${inline(m.ids, m.kind)}${m.ids.length >= 2 ? `<button class="text-button separate-link" data-action="batch" data-ids="${esc(m.ids.join(","))}">${pluginIcon("sidecar-pill-icon")}<span>在右侧 Beads Tasks 侧栏打开</span></button>` : ""}`
              : ""
          }</div></div>`,
      )
      .join(
        "",
      )}</div><div class="composer">${s.messages.length <= 2 ? `<div class="chips"><button data-prompt="/list">列出 test-repo 任务</button><button data-prompt="/show">查看进行中 Feature</button><button data-prompt="/board">打开全页看板</button></div>` : ""}<div class="context-pills">${s.context.map((x) => `<button data-action="detach" data-id="${esc(x.id)}">◈ ${esc(x.id)} · ${esc(x.title)} ×</button>`).join("")}</div>${menu()}<form id="chat-form"><input name="prompt" value="${esc(ui.prompt)}" autocomplete="off" aria-label="输入消息" placeholder="输入消息，使用 / 命令或 @ 提及"><div class="composer-actions"><button type="button" data-action="slash">/</button><button type="button" data-action="mention">@</button><button type="submit" aria-label="发送消息">↑</button></div></form></div>`;
  }
  function board() {
    return `<div class="board-content"><button data-action="chat">← 返回对话</button><iframe class="plugin-frame board-frame" title="Beads Tasks Board" data-plugin="mcp-board" data-search=""></iframe></div>`;
  }
  function side() {
    return `<div class="address"><span>${esc(buildSidecarURL(s.route))}</span><button data-action="copy-url">⧉</button></div><iframe class="plugin-frame sidecar-frame" title="Beads Tasks Sidecar" data-plugin="sidecar" data-search="${esc(buildSidecarURL(s.route).split('?')[1] ? '?' + buildSidecarURL(s.route).split('?')[1] : '')}"></iframe>`;
  }
  function inspector() {
    const logs = s.logs.filter(
      (l) => ui.channel === "all" || l.channel === ui.channel,
    );
    return `<div class="inspector-head"><b>Protocol · ${s.logs.length} events</b><button data-action="clear-logs">清空日志</button></div>${
      ui.inspector
        ? `<div class="inspector-body"><div class="log-filters">${[
            ["all", "全部"],
            ["mcp", "MCP JSON-RPC"],
            ["sidecar", "Sidecar & agentapi"],
            ["bd", "Beads bd CLI"],
          ]
            .map(
              ([v, l]) =>
                `<button data-action="channel" data-value="${v}" class="${ui.channel === v ? "active" : ""}">${l}</button>`,
            )
            .join("")}</div><div class="logs">${logs
            .map((l) => {
              const i = s.logs.indexOf(l);
              return `<div class="log"><button data-action="log" data-value="${i}"><time>${esc(l.time)}</time><span class="log-channel ${l.channel}">${l.channel}</span><code>${esc(l.event)}</code><span>${ui.openLogs.has(i) ? "−" : "+"}</span></button>${ui.openLogs.has(i) ? `<pre>${esc(JSON.stringify(l.payload, null, 2))}</pre>` : ""}</div>`;
            })
            .join("")}</div></div>`
        : ""
    }`;
  }
  function highlight() {
    if (!ui.find || !ui.findText) {
      const c = root.querySelector("#find-count");
      if (c) c.textContent = "0 / 0";
      return;
    }
    const area = root.querySelector(".side-scroll");
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode())
      if (
        !["BUTTON", "OPTION", "SCRIPT"].includes(
          walker.currentNode.parentElement.tagName,
        )
      )
        nodes.push(walker.currentNode);
    const needle = ui.findText.toLowerCase();
    nodes.forEach((node) => {
      const text = node.nodeValue,
        lower = text.toLowerCase();
      let pos = 0,
        at = lower.indexOf(needle);
      if (at < 0) return;
      const frag = document.createDocumentFragment();
      while (at >= 0) {
        frag.append(document.createTextNode(text.slice(pos, at)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(at, at + needle.length);
        frag.append(mark);
        pos = at + needle.length;
        at = lower.indexOf(needle, pos);
      }
      frag.append(document.createTextNode(text.slice(pos)));
      node.replaceWith(frag);
    });
    const marks = [...area.querySelectorAll("mark")];
    ui.findIndex = marks.length
      ? ((ui.findIndex % marks.length) + marks.length) % marks.length
      : 0;
    if (marks[ui.findIndex]) marks[ui.findIndex].classList.add("current");
    root.querySelector("#find-count").textContent = marks.length
      ? `第 ${ui.findIndex + 1}/${marks.length} 处`
      : "0 / 0";
  }
  const frames = new Map();
  let snapshot;
  const stateSnapshot = () => JSON.stringify({
    messages: s.messages, conversationId: s.conversationId, context: s.context,
    tasks: s.tasks, conversations: s.conversations, view: ui.view,
  });
  function renderToast() {
    const el = root.querySelector(".wb-toast");
    if (el) { el.textContent = getSiteCopy(currentLocale)[ui.toast] || ui.toast; el.hidden = !ui.toast; }
  }
  function initFrame(frame, index) {
    const mode = frame.dataset.plugin;
    const hostId = mode === 'sidecar' ? 'sidecar' : mode === 'mcp-board' ? 'board' : `inline-${index}`;
    frame.dataset.hostId = hostId;
    frames.set(hostId, frame);
    frame.srcdoc = buildPluginSrcdoc({ mode, hostId, search: frame.dataset.search, theme: document.documentElement.dataset.theme || 'light', locale: currentLocale, conversationId: s.conversationId, initialPayload: mode === 'sidecar' ? null : mock.getInitialPayload(mode, frame.dataset.search) });
  }
  function syncChromeAndSidecar() {
    const grid = root.querySelector('.workbench-grid');
    if (!grid) return;
    grid.classList.toggle('no-sidebar', !ui.sidebar);
    grid.classList.toggle('no-aux', !ui.auxiliary);
    const panel = root.querySelector('.sidecar');
    const tabs = panel.querySelectorAll('[data-action="tab"]');
    tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.value === ui.tab));
    tabs[1].querySelector('span').textContent = s.logs.length;
    const current = panel.querySelector('.sidecar-frame');
    const inspectorEl = panel.querySelector('.inspector');
    if (ui.tab === 'side') {
      const search = buildSidecarURL(s.route).split('?')[1];
      const desired = search ? '?' + search : '';
      if (!current || current.dataset.search !== desired) {
        frames.delete('sidecar');
        panel.querySelector('.address')?.remove();
        current?.remove();
        inspectorEl?.remove();
        panel.insertAdjacentHTML('beforeend', side());
        initFrame(panel.querySelector('.sidecar-frame'), 0);
      } else {
        panel.querySelector('.address span').textContent = buildSidecarURL(s.route);
      }
    } else {
      const scrollTop = panel.querySelector('.logs')?.scrollTop || 0;
      if (!inspectorEl) {
        frames.delete('sidecar');
        panel.querySelector('.address')?.remove();
        current?.remove();
        panel.insertAdjacentHTML('beforeend', '<div class="inspector"></div>');
      }
      panel.querySelector('.inspector').innerHTML = inspector();
      translateChrome();
      const logs = panel.querySelector('.logs');
      if (logs) logs.scrollTop = scrollTop;
    }
  }
  function render() {
    const scrollPositions = Object.fromEntries(['.chat-scroll', '.wb-sidebar', '.logs'].map(selector => [selector, root.querySelector(selector)?.scrollTop || 0]));
    const heights = [...root.querySelectorAll('iframe[data-plugin="mcp-inline"]')].map(frame => frame.style.height || `${frame.getBoundingClientRect().height}px`);
    frames.clear();
    const active = document.activeElement,
      filter = active?.dataset?.filter,
      start = active?.selectionStart;
    root.innerHTML = `<div class="workbench"><div class="workbench-grid ${ui.sidebar ? "" : "no-sidebar"} ${ui.auxiliary ? "" : "no-aux"}"><aside class="wb-sidebar"><button class="new-conversation" data-action="new">＋ New Conversation</button><div class="workspace"><small>WORKSPACE</small><b>▣ &nbsp;test-repo</b><span>● embedded Dolt</span>${s.conversations.map((c) => `<button data-action="conversation" data-id="${esc(c.id)}" class="${ui.view === "chat" && s.conversationId === c.id ? "selected" : ""}">▤ ${esc(c.title)}</button>`).join("")}</div><div class="side-nav"><small>PLUGINS</small><button data-action="board" class="${ui.view === "board" ? "selected" : ""}">${pluginIcon()} Beads Tasks <span>Global</span></button></div><div class="scenarios"><small>QUICK FLOWS</small>${["列出 test-repo 四态任务", "打开单任务卡片", "写操作闭环（优先级/备注/Reopen）", "重置沙盒生成新哈希 ID"].map((x, i) => `<button data-action="scenario" data-value="${i}">${esc(x)}</button>`).join("")}</div><button class="settings-button" data-action="settings">⚙ Settings</button></aside><section class="canvas"><div class="canvas-head"><div><button data-action="sidebar" title="切换侧栏">☰</button><b>${ui.view === "chat" ? esc(s.conversations.find((c) => c.id === s.conversationId).title) : "Plugins / Beads Tasks"}</b></div><div><span class="model-pill">${esc(ui.model)}</span><button data-action="auxiliary">${pluginIcon()} Beads Tasks 侧栏</button></div></div>${ui.view === "chat" ? chat() : board()}</section><aside class="sidecar"><div class="aux-tabs"><button data-action="tab" data-value="side" class="${ui.tab === "side" ? "active" : ""}">${pluginIcon()} Beads Tasks</button><button data-action="tab" data-value="protocol" class="${ui.tab === "protocol" ? "active" : ""}">Protocol <span>${s.logs.length}</span></button><button data-action="auxiliary" aria-label="关闭辅助面板">×</button></div>${ui.tab === "side" ? side() : `<div class="inspector">${inspector()}</div>`}</aside></div>${ui.settings ? `<div class="settings-overlay"><div class="settings-panel"><div><b>Antigravity Settings</b><button data-action="settings">×</button></div><label>模型名展示 <select data-setting="model"><option ${ui.model === "Gemini" ? "selected" : ""}>Gemini</option><option ${ui.model === "Gemini Pro" ? "selected" : ""}>Gemini Pro</option></select></label><label>权限策略展示 <select data-setting="permission"><option ${ui.permission === "Ask first" ? "selected" : ""}>Ask first</option><option ${ui.permission === "Auto" ? "selected" : ""}>Auto</option></select></label><p>插件设置可在侧栏或看板中调整。</p></div></div>` : ""}<div class="wb-toast" role="status" aria-live="polite" ${ui.toast ? "" : "hidden"}>${esc(ui.toast)}</div></div>`;
    root.querySelectorAll('iframe[data-plugin="mcp-inline"]').forEach((frame, index) => {
      if (heights[index]) frame.style.height = heights[index];
    });
    root.querySelectorAll('iframe[data-plugin]').forEach(initFrame);
    for (const [selector, scrollTop] of Object.entries(scrollPositions)) {
      const el = root.querySelector(selector);
      if (el) el.scrollTop = scrollTop;
    }
    translateChrome();
    snapshot = stateSnapshot();
    if (filter) {
      const el = root.querySelector(`[data-filter="${filter}"]`);
      if (el) {
        el.focus();
        if (typeof start === "number" && el.setSelectionRange)
          el.setSelectionRange(start, start);
      }
    }
  }
  function batch(ids) {
    ui.auxiliary = true; ui.tab = "side"; if (window.matchMedia("(max-width: 760px)").matches) ui.sidebar = false;
    store.navigate({ ids, repo: s.route.repo || "", title: "批处理评审" });
  }
  function respond(text) {
    const ids = s.tasks.filter((t) => t.projectId === "test-repo").map((t) => t.id),
      words = String(text ?? "").trim(),
      cmd = words.split(/\s+/),
      command = commands.some(([c]) => c === cmd[0]) ? cmd[0] : "";
    const explicitId = s.tasks.some((t) => t.id === cmd[1]) ? cmd[1] : "";
    const taskId = explicitId || findTaskIdInText(words, s.tasks);
    if (!words && !s.context.length) return;
    ui.prompt = ""; ui.menu = "";
    store.message("user", words || "请查看附着的上下文。");
    if (command === "/reset") {
      store.resetTestRepo();
      store.message(
        "assistant",
        "已重置 test-repo，生成新的哈希编号。",
        s.tasks.filter((t) => t.projectId === "test-repo").map((t) => t.id),
        "batch",
      );
      toast("重置完成");
    } else if (command === "/batch") {
      batch(ids); store.message("assistant", "已打开批处理评审队列。", ids, "batch");
    } else if (command === "/board") {
      ui.view = "board";
      store.log("mcp", "tools/call", {
        name: "open_tasks_board",
        surface: "global",
        hostCapabilities: { message: false },
      });
    } else if (command === "/reopen") {
      const id = taskId || ids[3];
      try {
        store.updateStatus(id, "open");
        store.message("assistant", "任务已重新打开。", [id], "card");
      } catch (e) {
        store.message("assistant", e.message);
      }
    } else if (command === "/show" || /feature|详情/i.test(words)) {
      const id = taskId || (command === "/show" ? ids[1] : "");
      if (id && s.tasks.some((t) => t.id === id)) {
        store.log("mcp", "tools/call", {
          name: "show_task_card",
          arguments: { id },
        });
        store.message("assistant", `这里是 ${id} 的任务详情。`, [id], "card");
      } else {
        store.message(
          "assistant",
          `未识别到有效任务 ID，当前 test-repo 任务：${ids.join("、")}`,
        );
      }
    } else {
      store.log("mcp", "tools/call", {
        name: "show_task_batch",
        arguments: { ids },
      });
      store.message(
        "assistant",
        "已找到 test-repo 中的演示任务。",
        ids,
        "batch",
      );
    }
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.prompt) {
      respond(b.dataset.prompt);
      return;
    }
    const { action, id, value, ids } = b.dataset;
    if (!action) return;
    switch (action) {
      case "new": ui.view = "chat"; store.createConversation(); break;
      case "conversation": ui.view = "chat"; store.switchConversation(id); break;
      case "sidebar": ui.sidebar = !ui.sidebar; if (ui.sidebar && window.matchMedia("(max-width: 760px)").matches) ui.auxiliary = false; syncChromeAndSidecar(); break;
      case "auxiliary": ui.auxiliary = !ui.auxiliary; if (ui.auxiliary && window.matchMedia("(max-width: 760px)").matches) ui.sidebar = false; syncChromeAndSidecar(); break;
      case "tab": ui.tab = value; syncChromeAndSidecar(); break;
      case "settings": ui.settings = !ui.settings; render(); break;
      case "attach": { const t = s.tasks.find((x) => x.id === id); if (t) store.attachContext({ id: t.id, title: t.title }); break; }
      case "detach": store.clearContext(id); break;
      case "slash": case "mention": ui.prompt = action === "slash" ? "/" : "@"; ui.menu = action; ui.menuIndex = 0; render(); root.querySelector('[name="prompt"]').focus(); break;
      case "menu": chooseMenu(Number(value)); break;
      case "copy-url": copy(buildSidecarURL(s.route)).then(() => toast("已复制地址")).catch(() => toast("复制失败")); break;
      case "chat":
        ui.view = "chat";
        render();
        break;
      case "board":
        ui.view = "board";
        store.log("mcp", "tools/call", {
          name: "open_tasks_board",
          surface: "global",
          hostCapabilities: { message: false },
        });
        break;
      case "open":
        ui.auxiliary = true; ui.tab = "side";
        store.navigate({ ...s.route, id, ids: [] });
        break;
      case "copy-id":
        ui.auxiliary = true; ui.tab = "side";
        copy(id)
          .then(() => toast("已复制 ID"))
          .catch(() => toast("复制失败"));
        store.navigate({ ...s.route, id, ids: [], clip: true });
        break;
      case "copy":
        copy(id)
          .then(() => toast("已复制 ID"))
          .catch(() => toast("复制失败"));
        store.copyId(id);
        break;
      case "batch":
        batch(ids.split(","));
        break;
      case "start-queue":
        store.queueMove(0);
        break;
      case "queue":
        store.navigate({ ...s.route, id: "", ids: [...s.queue.ids] });
        break;
      case "prev":
        store.queueMove(-1);
        break;
      case "next":
        store.queueMove(1);
        break;
      case "read":
        store.markRead(id);
        break;
      case "overview":
        store.navigate({ repo: s.route.repo || "" });
        break;
      case "refresh":
        store.log("sidecar", "刷新任务", { repo: "test-repo" });
        break;
      case "status":
        store.updateStatus(id, value);
        toast("状态已更新");
        break;
      case "expand":
        ui.expanded = ui.expanded === id ? "" : id;
        render();
        break;
      case "remove-label":
        store.removeLabel(id, value);
        break;
      case "explain":
        ui.explain = !ui.explain;
        render();
        break;
      case "send":
        send(id, "");
        break;
      case "find":
        ui.find = true;
        render();
        root.querySelector('[data-filter="findText"]')?.focus();
        break;
      case "find-close":
        ui.find = false;
        ui.only = false;
        render();
        break;
      case "find-next":
        ui.findIndex++;
        render();
        root
          .querySelector("mark.current")
          ?.scrollIntoView({ block: "nearest" });
        break;
      case "find-prev":
        ui.findIndex--;
        render();
        root
          .querySelector("mark.current")
          ?.scrollIntoView({ block: "nearest" });
        break;
      case "inspector":
        ui.inspector = !ui.inspector;
        syncChromeAndSidecar();
        break;
      case "clear-logs":
        ui.openLogs.clear();
        store.clearLogs();
        break;
      case "channel":
        ui.channel = value;
        syncChromeAndSidecar();
        break;
      case "log": {
        const n = Number(value);
        ui.openLogs.has(n) ? ui.openLogs.delete(n) : ui.openLogs.add(n);
        syncChromeAndSidecar();
        break;
      }
      case "scenario":
        scenario(Number(value));
        break;
    }
  });
  function send(id, note) {
    const t = s.tasks.find((x) => x.id === id);
    const payload = {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      description: t.description,
      note,
    };
    store.log("sidecar", "agentapi send-message", { ...payload, conversation_id: s.conversationId, prompt: `请查看任务 ${t.id}${note ? `：${note}` : ""}` });
    ui.view = "chat";
    ui.explain = false;
    store.message(
      "user",
      `来自侧栏的任务上下文：${t.id} · ${t.title}${note ? " / " + note : ""}`,
    );
    store.message(
      "assistant",
      "已收到任务上下文，可以继续讨论或更新该任务。",
      [id],
      "card",
    );
    toast("已通过 agentapi 发回对话");
  }
  function scenario(n) {
    const ids = s.tasks.filter((t) => t.projectId === "test-repo").map((t) => t.id);
    ui.view = "chat";
    if (n === 0) {
      store.log("mcp", "tools/call", {
        name: "show_task_batch",
        arguments: { ids },
      });
      store.message(
        "assistant",
        "test-repo 已就绪：四条演示任务。",
        ids,
        "batch",
      );
      batch(ids);
    }
    if (n === 1) {
      store.log("mcp", "tools/call", {
        name: "show_task_card",
        arguments: { id: ids[1] },
      });
      store.message("assistant", "查看进行中的 Feature。", [ids[1]], "card");
    }
    if (n === 2) {
      store.updatePriority(ids[2], 1);
      store.appendNote(ids[1], "本地联调：写操作闭环完成。");
      store.updateStatus(ids[3], "open");
      store.message(
        "assistant",
        "已修改优先级、追加备注并重新打开 Bug。",
        [ids[2], ids[1], ids[3]],
        "batch",
      );
    }
    if (n === 3) {
      const fresh = store.resetTestRepo();
      store.message(
        "assistant",
        "已模拟重置并生成新的哈希编号。",
        fresh,
        "batch",
      );
      toast("重置完成");
    }
  }
  root.addEventListener("input", (e) => {
    if (e.target.name === "prompt") {
      ui.prompt = e.target.value;
      ui.menu = /(?:^|\s)\/[^\s]*$/.test(ui.prompt) ? "slash" : /(?:^|\s)@[^\s]*$/.test(ui.prompt) ? "mention" : "";
      ui.menuIndex = 0; render(); const input = root.querySelector('[name="prompt"]'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); return;
    }
    const key = e.target.dataset.filter;
    if (key) {
      ui[key] = e.target.value;
      ui.findIndex = 0;
      render();
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.setting) { ui[el.dataset.setting] = el.value; render(); }
    else if (el.matches("[data-priority]"))
      store.updatePriority(el.dataset.priority, el.value);
    else if (el.matches("[data-only]")) {
      ui.only = el.checked;
      render();
    } else if (el.dataset.filter) {
      ui[el.dataset.filter] = el.value;
      render();
    }
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target,
      text = new FormData(form).get(
        form.id === "chat-form" ? "prompt" : "text",
      );
    if (form.id === "chat-form") respond(text);
    else if (form.dataset.form === "note")
      store.appendNote(form.dataset.id, text);
    else if (form.dataset.form === "label")
      store.addLabel(form.dataset.id, text);
    else if (form.dataset.form === "send-note") send(form.dataset.id, text);
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.name === "prompt" && ui.menu && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
      e.preventDefault(); const items = menuItems();
      if (e.key === "Escape") ui.menu = "";
      else if (e.key === "Enter") { if (items.length) chooseMenu(ui.menuIndex); return; }
      else if (items.length) ui.menuIndex = (ui.menuIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      render(); root.querySelector('[name="prompt"]').focus(); return;
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if (
      (e.key === "/" && !typing) ||
      ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f")
    ) {
      e.preventDefault();
      ui.find = true;
      render();
      root.querySelector('[data-filter="findText"]')?.focus();
    } else if (
      !typing &&
      s.route.id &&
      s.queue.ids.includes(s.route.id) &&
      (e.key === "j" || e.key === "k")
    ) {
      e.preventDefault();
      store.queueMove(e.key === "j" ? 1 : -1);
    }
  });
  const mock = createMockApi(store, {
    copy,
    locale: () => currentLocale,
    send(text) { ui.view = 'chat'; toast('已发送到当前对话'); },
    context(text) { store.attachContext({ id: 'Beads Tasks', title: text }); },
    changed(hostId) { setTimeout(() => frames.forEach((frame, id) => { if (id !== hostId) frame.contentWindow?.postMessage({ kind: 'beads-host', type: 'refresh' }, '*'); }), 0); },
  });
  async function handlePluginMessage(event) {
    const msg = event.data;
    if (msg?.kind !== 'beads-plugin') return;
    const frame = frames.get(msg.hostId);
    if (!frame || frame.contentWindow !== event.source) return;
    if (msg.type === 'route_sync') {
      if (msg.hostId !== 'sidecar') return;
      const p = new URLSearchParams(msg.query);
      s.route = { id: p.get('id') || '', ids: (p.get('ids') || '').split(',').filter(Boolean), repo: p.get('repo') || '', title: p.get('title') || '' };
      const url = buildSidecarURL(s.route);
      frame.dataset.search = url.includes('?') ? '?' + url.split('?')[1] : '';
      const address = root.querySelector('.address span');
      if (address) address.textContent = url;
      return;
    }
    if (msg.type === 'resize') {
      if (frame.dataset.plugin === 'mcp-inline' && Number.isFinite(msg.height)) frame.style.height = `${Math.max(80, Math.min(560, msg.height))}px`;
      return;
    }
    if (!msg.reqId) return;
    try {
      let data, ok = true, status = 200;
      switch (msg.type) {
        case 'fetch': { const res = await mock.fetch(msg.hostId, msg.url, { method: msg.method, body: msg.body }); data = await res.json(); ok = res.ok; status = res.status; break; }
        case 'update_model_context': data = await mock.updateModelContext(msg.text); break;
        case 'clear_model_context': data = await mock.clearModelContext(); break;
        case 'send_message': data = await mock.sendMessage(msg.text); break;
        case 'open_link': data = await mock.openLink(msg.path); break;
        case 'review_queue_get': data = await mock.getReviewQueue(); break;
        case 'review_queue_set': data = await mock.saveReviewQueue(msg.queue); break;
        case 'review_queue_clear': data = await mock.clearReviewQueue(); break;
        default: throw new Error('未知 RPC 类型');
      }
      event.source.postMessage({ kind: 'beads-host', reqId: msg.reqId, ok, status, data }, '*');
    } catch (error) {
      event.source.postMessage({ kind: 'beads-host', reqId: msg.reqId, ok: false, error: error.message }, '*');
    }
  }
  window.addEventListener('message', handlePluginMessage);
  const defaultIds = s.tasks.filter((t) => t.projectId === "test-repo").map((t) => t.id);
  store.message("user", "列出 test-repo 的演示任务。");
  store.log("mcp", "tools/call", {
    name: "show_task_batch",
    arguments: { ids: defaultIds },
  });
  store.message(
    "assistant",
    "已找到 test-repo 中的四条演示任务。",
    defaultIds,
    "batch",
  );
  store.subscribe(() => {
    if (snapshot !== stateSnapshot()) render();
    else syncChromeAndSidecar();
  });
  render();
  return {
    store,
    demo(kind) { ui.view = kind === "board" ? "board" : "chat"; if (kind === "inline") respond("/list"); else if (kind === "sidecar") batch(s.tasks.filter((t) => t.projectId === "test-repo").map((t) => t.id)); else store.log("mcp", "tools/call", { name: "open_tasks_board", surface: "global", hostCapabilities: { message: false } }); },
    reset() { const ids = store.resetTestRepo(); ui.view = "chat"; store.message("assistant", "已重置 test-repo，生成新的哈希编号。", ids, "batch"); toast("重置完成"); },
    hostLocaleChanged(locale) {
      currentLocale = locale === 'zh-CN' ? 'zh-CN' : 'en';
      translateChrome();
      renderToast();
      frames.forEach(frame => {
        frame.contentWindow?.postMessage({ kind: 'beads-host', type: 'locale', locale: currentLocale }, '*');
        frame.contentWindow?.postMessage({ kind: 'beads-host', type: 'refresh' }, '*');
      });
    },
    hostThemeChanged(theme) {
      const css = getComputedStyle(document.documentElement);
      const variables = Object.fromEntries(["--color-background-primary", "--color-background-secondary", "--color-text-primary", "--color-border-primary"].map((key) => [key, css.getPropertyValue(key).trim()]));
      frames.forEach(frame => frame.contentWindow?.postMessage({ kind: 'beads-host', type: 'theme', theme }, '*'));
      s.logs.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), channel: 'mcp', event: 'ui/notifications/host-context-changed', payload: { theme, styles: { variables } } });
    },
  };
}
