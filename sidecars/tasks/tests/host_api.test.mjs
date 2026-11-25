import test from 'node:test';
import assert from 'node:assert/strict';
import { getConversationWorkspaces, sendAgentMessage } from '../host_api.mjs';

const id = '12345678-1234-1234-1234-123456789abc';

test('workspace metadata accepts both formats and caches for five seconds', async () => {
  let calls = 0;
  let time = 1000;
  const deps = { now: () => time, getConversationMetadata: async () => {
    calls++;
    return { conversationMetadata: { metadata: calls === 1 ? { workspaceUris: ['file:///tmp/hello%20world'] } : { workspaces: [{ workspaceFolderAbsoluteUri: 'file:///tmp/second' }] } } };
  } };
  assert.deepEqual(await getConversationWorkspaces(id, deps), ['/tmp/hello world']);
  time += 4999;
  assert.deepEqual(await getConversationWorkspaces(id, deps), ['/tmp/hello world']);
  assert.equal(calls, 1);
  time++;
  assert.deepEqual(await getConversationWorkspaces(id, deps), ['/tmp/second']);
  assert.equal(calls, 2);
});

test('workspace metadata uses the host executable and fails safely', async () => {
  const original = process.env.ANTIGRAVITY_AGENTAPI_EXE;
  process.env.ANTIGRAVITY_AGENTAPI_EXE = '/tmp/host-agent';
  try {
    const paths = await getConversationWorkspaces(id, { noCache: true, execFile: async (bin, args) => {
      assert.equal(bin, '/tmp/host-agent');
      assert.deepEqual(args, ['agentapi', 'get-conversation-metadata', id]);
      return { stdout: JSON.stringify({ conversationMetadata: { metadata: { workspaceUris: ['file:///tmp/example'] } } }) };
    } });
    assert.deepEqual(paths, ['/tmp/example']);
    assert.deepEqual(await getConversationWorkspaces(id, { noCache: true, execFile: async () => { throw Error('failed'); } }), []);
    assert.deepEqual(await getConversationWorkspaces('bad-id', { execFile: () => { throw Error('unexpected'); } }), []);
  } finally {
    if (original === undefined) delete process.env.ANTIGRAVITY_AGENTAPI_EXE;
    else process.env.ANTIGRAVITY_AGENTAPI_EXE = original;
  }
});

test('workspace metadata handles CLI envelope and fallback executable', async () => {
  const original = process.env.ANTIGRAVITY_AGENTAPI_EXE;
  delete process.env.ANTIGRAVITY_AGENTAPI_EXE;
  try {
    const paths = await getConversationWorkspaces(id, { noCache: true, execFile: async (bin, args) => {
      assert.equal(bin, 'agentapi');
      assert.deepEqual(args, ['get-conversation-metadata', id]);
      return { stdout: JSON.stringify({ response: { conversationMetadata: { metadata: { workspaceUris: [], workspaces: [{ gitRootAbsoluteUri: 'file:///tmp/root' }] } } } }) };
    } });
    assert.deepEqual(paths, ['/tmp/root']);
  } finally {
    if (original === undefined) delete process.env.ANTIGRAVITY_AGENTAPI_EXE;
    else process.env.ANTIGRAVITY_AGENTAPI_EXE = original;
  }
});

test('send message uses injected host method after validation', async () => {
  let received;
  assert.deepEqual(await sendAgentMessage(' id ', ' hello ', { sendMessage: async (...args) => { received = args; } }), { ok: true });
  assert.deepEqual(received, ['id', 'hello']);
});
