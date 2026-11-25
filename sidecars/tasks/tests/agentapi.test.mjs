import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_AGENT_PROMPT_LEN, sendAgentMessage } from '../agentapi.mjs';

function createFakeExecFile(onCall) {
  const calls = [];
  const fake = (bin, args, options, callback) => {
    const call = { bin, args, options };
    calls.push(call);
    onCall?.(call, callback);
    if (!onCall) callback(null, '', '');
  };
  return { fake, calls };
}

test('sendAgentMessage invokes agentapi send-message with positional args', async () => {
  const { fake, calls } = createFakeExecFile();

  const result = await sendAgentMessage('conv-123', '请继续处理以下任务：\n## rsc-abc.1: 标题', { execFile: fake });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, 'agentapi');
  assert.deepEqual(calls[0].args, ['send-message', 'conv-123', '请继续处理以下任务：\n## rsc-abc.1: 标题']);
  assert.equal(calls[0].options.timeout, 15_000);
});

test('sendAgentMessage trims conversation id and prompt, and honours custom timeout', async () => {
  const { fake, calls } = createFakeExecFile();

  await sendAgentMessage('  conv-abc  ', '\n  请继续处理  \n', { execFile: fake, timeoutMs: 1234 });

  assert.deepEqual(calls[0].args, ['send-message', 'conv-abc', '请继续处理']);
  assert.equal(calls[0].options.timeout, 1234);
});

test('sendAgentMessage resolves the binary from AGENTAPI_BIN and deps.agentapiBin', async () => {
  const previous = process.env.AGENTAPI_BIN;
  try {
    process.env.AGENTAPI_BIN = '/opt/antigravity/bin/agentapi';
    const fromEnv = createFakeExecFile();
    await sendAgentMessage('conv-1', 'hello', { execFile: fromEnv.fake });
    assert.equal(fromEnv.calls[0].bin, '/opt/antigravity/bin/agentapi');

    const fromDeps = createFakeExecFile();
    await sendAgentMessage('conv-1', 'hello', {
      execFile: fromDeps.fake,
      agentapiBin: '/custom/agentapi',
    });
    assert.equal(fromDeps.calls[0].bin, '/custom/agentapi');
  } finally {
    if (previous === undefined) delete process.env.AGENTAPI_BIN;
    else process.env.AGENTAPI_BIN = previous;
  }
});

test('sendAgentMessage rejects empty or malformed conversation ids', async () => {
  const { fake, calls } = createFakeExecFile();

  await assert.rejects(() => sendAgentMessage('', 'hello', { execFile: fake }), /缺少会话 ID/);
  await assert.rejects(() => sendAgentMessage('   ', 'hello', { execFile: fake }), /缺少会话 ID/);
  await assert.rejects(() => sendAgentMessage(null, 'hello', { execFile: fake }), /缺少会话 ID/);
  await assert.rejects(() => sendAgentMessage('conv 1', 'hello', { execFile: fake }), /非法字符/);
  await assert.rejects(() => sendAgentMessage('conv\n1', 'hello', { execFile: fake }), /非法字符/);
  await assert.rejects(() => sendAgentMessage(`conv${'\0'}1`, 'hello', { execFile: fake }), /非法字符/);
  await assert.rejects(() => sendAgentMessage('c'.repeat(257), 'hello', { execFile: fake }), /过长/);

  assert.equal(calls.length, 0);
});

test('sendAgentMessage rejects empty, NUL-byte, and oversized prompts', async () => {
  const { fake, calls } = createFakeExecFile();

  await assert.rejects(() => sendAgentMessage('conv-1', '', { execFile: fake }), /消息内容不能为空/);
  await assert.rejects(() => sendAgentMessage('conv-1', '   \n ', { execFile: fake }), /消息内容不能为空/);
  await assert.rejects(() => sendAgentMessage('conv-1', undefined, { execFile: fake }), /消息内容不能为空/);
  await assert.rejects(() => sendAgentMessage('conv-1', `abc${'\0'}def`, { execFile: fake }), /NUL/);
  await assert.rejects(
    () => sendAgentMessage('conv-1', 'x'.repeat(MAX_AGENT_PROMPT_LEN + 1), { execFile: fake }),
    /消息内容过长/,
  );

  assert.equal(calls.length, 0);
});

test('sendAgentMessage reports a clear Chinese error when agentapi is missing', async () => {
  const { fake } = createFakeExecFile((_call, callback) => {
    const err = new Error('spawn agentapi ENOENT');
    err.code = 'ENOENT';
    callback(err, '', '');
  });

  await assert.rejects(
    () => sendAgentMessage('conv-1', 'hello', { execFile: fake }),
    (err) => {
      assert.match(err.message, /未检测到 agentapi/);
      assert.match(err.message, /Antigravity Sidecar/);
      assert.equal(err.code, 'ENOENT');
      return true;
    },
  );
});

test('sendAgentMessage surfaces stderr from failing commands', async () => {
  const { fake } = createFakeExecFile((_call, callback) => {
    const err = new Error('Command failed: agentapi send-message');
    err.code = 1;
    callback(err, '', 'conversation not found\n');
  });

  await assert.rejects(
    () => sendAgentMessage('conv-1', 'hello', { execFile: fake }),
    /agentapi send-message 执行失败 \(exit 1\): conversation not found/,
  );
});

test('sendAgentMessage falls back to err.stderr and message when callback stderr is empty', async () => {
  const withErrStderr = createFakeExecFile((_call, callback) => {
    const err = new Error('boom');
    err.code = 2;
    err.stderr = 'permission denied';
    callback(err, '', '');
  });
  await assert.rejects(() => sendAgentMessage('conv-1', 'hi', { execFile: withErrStderr.fake }), /permission denied/);

  const messageOnly = createFakeExecFile((_call, callback) => {
    const err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    callback(err, '', '');
  });
  await assert.rejects(() => sendAgentMessage('conv-1', 'hi', { execFile: messageOnly.fake }), /socket hang up/);
});
