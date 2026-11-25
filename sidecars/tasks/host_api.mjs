import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

export const MAX_AGENT_PROMPT_LEN = 64 * 1024;
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = new Map();

export async function getConversationWorkspaces(conversationId, deps = {}) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!CONVERSATION_ID.test(id)) return [];
  const now = deps.now ? deps.now() : Date.now();
  const cached = cache.get(id);
  if (!deps.noCache && cached && now - cached.at < 5000) return cached.paths;
  try {
    let response;
    if (deps.getConversationMetadata) {
      response = await deps.getConversationMetadata(id);
    } else {
      const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE || 'agentapi';
      const run = deps.execFile || promisify(execFile);
      const args = [...(process.env.ANTIGRAVITY_AGENTAPI_EXE ? ['agentapi'] : []), 'get-conversation-metadata', id];
      const result = await run(exe, args, { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 });
      response = typeof result === 'string' ? JSON.parse(result) : JSON.parse(result.stdout || '{}');
    }
    if (typeof response === 'string') response = JSON.parse(response);
    const metadata = response?.response?.conversationMetadata?.metadata || response?.conversationMetadata?.metadata;
    const uris = Array.isArray(metadata?.workspaceUris) && metadata.workspaceUris.length
      ? metadata.workspaceUris
      : (Array.isArray(metadata?.workspaces) ? metadata.workspaces : []).map((w) => w?.workspaceFolderAbsoluteUri || w?.gitRootAbsoluteUri);
    const paths = uris.flatMap((uri) => {
      if (typeof uri !== 'string') return [];
      try {
        if (uri.startsWith('file://')) return [resolve(fileURLToPath(uri))];
        if (uri.startsWith('/')) return [resolve(uri)];
      } catch { /* Ignore malformed paths. */ }
      return [];
    });
    if (!deps.noCache) cache.set(id, { at: now, paths });
    return paths;
  } catch {
    return [];
  }
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'EINVALID' });
}

export async function sendAgentMessage(conversationId, prompt, deps = {}) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!id) throw invalid('缺少会话 ID，无法向当前对话发送消息');
  if (id.length > 256) throw invalid('会话 ID 过长，无法向当前对话发送消息');
  if (/[\s\0]/.test(id)) throw invalid('会话 ID 含有非法字符（空白或控制字符），无法向当前对话发送消息');
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) throw invalid('消息内容不能为空');
  if (text.includes('\0')) throw invalid('消息内容包含非法字符（NUL）');
  if (text.length > MAX_AGENT_PROMPT_LEN) throw invalid(`消息内容过长（上限 ${MAX_AGENT_PROMPT_LEN} 字符）`);
  if (deps.sendMessage) {
    await deps.sendMessage(id, text);
    return { ok: true };
  }
  const hostExe = !deps.agentapiBin && !process.env.AGENTAPI_BIN && process.env.ANTIGRAVITY_AGENTAPI_EXE;
  const bin = deps.agentapiBin || process.env.AGENTAPI_BIN || hostExe || 'agentapi';
  const args = [...(hostExe ? ['agentapi'] : []), 'send-message', id, text];
  await new Promise((done, reject) => {
    (deps.execFile || execFile)(bin, args, { timeout: deps.timeoutMs ?? 15000 }, (err, _stdout, stderr) => {
      if (!err) return done();
      if (err.code === 'ENOENT') return reject(Object.assign(new Error('未检测到 agentapi，无法向当前对话发送消息（请确认在 Antigravity Sidecar 环境中运行）'), { code: 'ENOENT' }));
      const detail = String(err.stderr || stderr || err.message || 'unknown error').trim();
      const status = typeof err.code === 'number' || typeof err.code === 'string' ? ` (exit ${err.code})` : '';
      return reject(new Error(`${bin} send-message 执行失败${status}: ${detail}`));
    });
  });
  return { ok: true };
}
