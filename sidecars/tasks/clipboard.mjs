import { spawn } from 'node:child_process';

export const MAX_CLIPBOARD_LEN = 4096;

function getClipboardCandidates(platform) {
  switch (platform) {
    case 'darwin':
      return [
        { cmd: '/usr/bin/pbcopy', args: [] },
        { cmd: 'pbcopy', args: [] },
      ];
    case 'linux':
      return [
        { cmd: 'wl-copy', args: [] },
        { cmd: 'xclip', args: ['-selection', 'clipboard'] },
        { cmd: 'xsel', args: ['--clipboard', '--input'] },
      ];
    case 'win32':
      return [{ cmd: 'clip', args: [] }];
    default:
      throw new Error(`unsupported clipboard platform: ${platform}`);
  }
}

function runClipboardCommand(cmd, args, text, { spawnFn, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const child = spawnFn(cmd, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        LANG: process.env.LANG || 'en_US.UTF-8',
        LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8',
      },
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore kill failures on timeout
      }
      finish(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 1024) {
        stderr += String(chunk);
      }
    });

    child.stdin?.on('error', () => {
      // Ignore EPIPE when the spawned command fails/exits immediately (e.g. ENOENT)
    });

    child.on('error', (err) => {
      finish(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish(null);
      } else {
        const msg = stderr.trim();
        finish(new Error(msg ? `${cmd} exited with code ${code}: ${msg}` : `${cmd} exited with code ${code}`));
      }
    });

    child.stdin?.end(text, 'utf8');
  });
}

export async function writeSystemClipboard(text, deps = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('clipboard text is required');
  }
  if (text.length > MAX_CLIPBOARD_LEN) {
    throw new Error('clipboard text exceeds maximum length');
  }
  if (text.includes('\0')) {
    throw new Error('clipboard text contains invalid NUL byte');
  }

  const platform = deps.platform || process.platform;
  const candidates = getClipboardCandidates(platform);
  const spawnFn = deps.spawn || spawn;
  const timeoutMs = deps.timeoutMs ?? 3000;

  let lastErr = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const { cmd, args } = candidates[i];
    try {
      await runClipboardCommand(cmd, args, text, { spawnFn, timeoutMs });
      return;
    } catch (err) {
      lastErr = err;
      const isMissing = err?.code === 'ENOENT' || /ENOENT/.test(err?.message || '');
      if (isMissing && i < candidates.length - 1) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('failed to write clipboard');
}
