import { initialTasks } from "./data.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
export const statuses = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
];
export function findTaskIdInText(text, tasks = []) {
  const source = String(text ?? "");
  if (!source) return "";
  const ids = tasks
    .map((t) => (typeof t === "string" ? t : t?.id))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, (ch) => "\\" + ch);
    if (new RegExp(`(^|[^\\w.-])${escaped}(?![\\w.-])`).test(source)) return id;
  }
  return "";
}
export function buildSidecarURL(route = {}) {
  const p = new URLSearchParams();
  for (const key of ["id", "ids", "clip", "repo", "title"]) {
    const v = route[key];
    if (v != null && v !== "" && v !== false && (!Array.isArray(v) || v.length))
      p.set(
        key,
        key === "ids" && Array.isArray(v)
          ? v.join(",")
          : key === "clip"
            ? "1"
            : v,
      );
  }
  return `sidecar://beads-tasks/tasks/${p.size ? "?" + p : ""}`;
}
export function parseSidecarURL(url) {
  const u = new URL(url);
  if (
    u.protocol !== "sidecar:" ||
    u.hostname !== "beads-tasks" ||
    u.pathname !== "/tasks/"
  )
    throw new Error("无效的 Sidecar 地址");
  return {
    id: u.searchParams.get("id") || "",
    ids: (u.searchParams.get("ids") || "").split(",").filter(Boolean),
    clip: u.searchParams.get("clip") === "1",
    repo: u.searchParams.get("repo") || "",
    title: u.searchParams.get("title") || "",
  };
}
export function createStore() {
  const state = {
    tasks: clone(initialTasks),
    queue: { ids: [], index: 0, readIds: [] },
    route: {},
    messages: [],
    conversations: [],
    conversationId: "default",
    context: [],
    logs: [],
  };
  state.conversations.push({ id: "default", title: "test-repo 任务面板演练", messages: state.messages, context: state.context });
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state));
  const log = (channel, event, payload = {}) => {
    state.logs.unshift({
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      channel,
      event,
      payload,
    });
  };
  const task = (id) => {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`任务不存在：${id}`);
    return t;
  };
  const rpc = (name, args) =>
    log("mcp", "app.callServerTool", {
      method: "tools/call",
      params: { name, arguments: args },
    });
  const bd = (command) =>
    log("bd", "BD_JSON_ENVELOPE=0 bd " + command, {
      command: "BD_JSON_ENVELOPE=0 bd " + command,
    });
  const api = {
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify,
    log(channel, event, payload) {
      log(channel, event, payload);
      notify();
    },
    createConversation() {
      const id = `conversation-${Date.now()}-${state.conversations.length}`;
      const conversation = { id, title: `新对话 ${state.conversations.length}`, messages: [], context: [] };
      state.conversations.push(conversation);
      this.switchConversation(id);
      return id;
    },
    switchConversation(id) {
      const conversation = state.conversations.find((c) => c.id === id);
      if (!conversation) throw new Error("对话不存在");
      state.conversationId = id;
      state.messages = conversation.messages;
      state.context = conversation.context;
      notify();
    },
    attachContext(item) {
      if (!state.context.some((x) => x.id === item.id)) state.context.push(clone(item));
      log("mcp", "ui/update-model-context", { conversationId: state.conversationId, context: clone(state.context) });
      notify();
    },
    clearContext(id) {
      if (id) state.context.splice(0, state.context.length, ...state.context.filter((x) => x.id !== id));
      else state.context.splice(0);
      log("mcp", "ui/update-model-context", { conversationId: state.conversationId, context: clone(state.context) });
      notify();
    },
    updateStatus(id, status, reason = "手动关闭") {
      if (!statuses.includes(status)) throw new Error("无效状态");
      const t = task(id),
        old = t.status;
      if (status === "closed") {
        t.close_reason = reason;
        bd(`close ${id} --reason ${JSON.stringify(reason)}`);
      } else {
        if (old === "closed") {
          bd(`reopen ${id}`);
          delete t.close_reason;
        }
        if (old !== "closed" || status !== "open")
          bd(`update ${id} --status ${status}`);
      }
      t.status = status;
      rpc("ui_update_bead_status", { id, status, reason });
      notify();
    },
    updatePriority(id, priority) {
      const n = Number(String(priority).replace(/^P/i, ""));
      if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error("无效优先级");
      task(id).priority = n;
      bd(`update ${id} --priority ${n}`);
      rpc("ui_update_bead_priority", { id, priority: n });
      notify();
    },
    appendNote(id, text) {
      text = text.trim();
      if (!text) return;
      task(id).notes.push(text);
      bd(`update ${id} --append-notes ${JSON.stringify(text)}`);
      rpc("ui_append_bead_note", { id, text });
      notify();
    },
    addLabel(id, label) {
      label = label.trim();
      if (!label) return;
      const t = task(id);
      if (!t.labels.includes(label)) t.labels.push(label);
      bd(`update ${id} --add-label ${JSON.stringify(label)}`);
      rpc("ui_update_bead_label", { id, op: "add", label });
      notify();
    },
    removeLabel(id, label) {
      const t = task(id);
      t.labels = t.labels.filter((x) => x !== label);
      bd(`update ${id} --remove-label ${JSON.stringify(label)}`);
      rpc("ui_update_bead_label", { id, op: "remove", label });
      notify();
    },
    navigate(route) {
      const parsed =
        typeof route === "string" ? parseSidecarURL(route) : { ...route };
      const requested = buildSidecarURL(parsed);
      if (parsed.clip && parsed.id) {
        rpc("ui_copy_clipboard", { text: parsed.id });
        log("sidecar", "复制 ID", { id: parsed.id });
      }
      delete parsed.clip;
      state.route = parsed;
      if (parsed.id && state.queue.ids.includes(parsed.id))
        state.queue.index = state.queue.ids.indexOf(parsed.id);
      if (
        parsed.ids?.length &&
        parsed.ids.join(",") !== state.queue.ids.join(",")
      ) {
        state.queue.ids = [...parsed.ids];
        state.queue.index = 0;
        state.queue.readIds = [];
        rpc("ui_review_queue", { op: "set", queue: clone(state.queue) });
      }
      log("sidecar", "sidecar:// 导航", {
        requested,
        url: buildSidecarURL(parsed),
      });
      notify();
      return buildSidecarURL(parsed);
    },
    queueMove(delta) {
      const q = state.queue;
      q.index = Math.max(0, Math.min(q.ids.length - 1, q.index + delta));
      if (q.ids.length)
        state.route = { ...state.route, id: q.ids[q.index], ids: [] };
      rpc("ui_review_queue", { op: "set", queue: clone(q) });
      notify();
    },
    receiveAgentPrompt(prompt) {
      const text = String(prompt ?? "");
      const id = findTaskIdInText(text, state.tasks);
      log("sidecar", "agentapi send-message", {
        conversationId: state.conversationId,
        prompt: text,
      });
      this.message("user", text || "来自侧栏的任务上下文。");
      if (id) {
        const t = state.tasks.find((x) => x.id === id);
        log("mcp", "tools/call", {
          name: "show_task_card",
          arguments: { id },
        });
        this.message(
          "assistant",
          `已收到侧栏发回的任务上下文：${id} · ${t.title}。可以继续讨论，或在下方卡片中更新状态、备注与标签。`,
          [id],
          "card",
        );
      } else {
        const ids = state.tasks.map((t) => t.id);
        log("mcp", "tools/call", {
          name: "show_task_batch",
          arguments: { ids },
        });
        this.message(
          "assistant",
          `已收到侧栏消息，但未识别到具体任务 ID。当前 test-repo 任务：${ids.join("、")}`,
          ids,
          "batch",
        );
      }
      return id;
    },
    markRead(id) {
      if (!state.queue.readIds.includes(id)) state.queue.readIds.push(id);
      rpc("ui_review_queue", { op: "set", queue: clone(state.queue) });
      notify();
    },
    copyId(id) {
      rpc("ui_copy_clipboard", { text: id });
      log("sidecar", "复制 ID", { id });
      notify();
    },
    clearLogs() {
      state.logs = [];
      notify();
    },
    message(role, text, ids = [], kind = "") {
      const context = role === "user" ? clone(state.context) : [];
      const last = state.logs[0];
      const tool = role === "assistant" && last?.event === "tools/call" && ["show_task_card", "show_task_batch"].includes(last.payload.name) ? { ...clone(last.payload), result: clone(state.tasks.filter((t) => ids.includes(t.id))) } : null;
      state.messages.push({ role, text, ids, kind, context, tool });
      if (role === "user" && context.length) this.clearContext();
      notify();
    },
    resetTestRepo() {
      const hash = () =>
        Array.from(
          { length: 3 },
          () =>
            "abcdefghijklmnopqrstuvwxyz0123456789"[
              Math.floor(Math.random() * 36)
            ],
        ).join("");
      let a = hash(),
        b = hash();
      while (b === a) b = hash();
      const ids = [`demo-${a}`, `demo-${a}.1`, `demo-${a}.2`, `demo-${b}`];
      state.tasks = clone(initialTasks);
      state.tasks.slice(0, 4).forEach((t, i) => {
        t.id = ids[i];
        if (t.parent) t.parent = ids[0];
        if (t.blockedBy.length) t.blockedBy = [ids[1]];
      });
      state.queue = { ids: [], index: 0, readIds: [] };
      state.route = {};
      state.conversations.forEach((c) => { c.messages.splice(0); c.context.splice(0); });
      bd("init --non-interactive --prefix demo");
      log("bd", "模拟重置", {
        command: "bd init --non-interactive --prefix demo",
        ids,
      });
      notify();
      return ids;
    },
  };
  log("mcp", "ui/initialize", {
    surface: "inline",
    hostCapabilities: { message: true },
  });
  log("mcp", "ui/notifications/initialized", {});
  return api;
}
