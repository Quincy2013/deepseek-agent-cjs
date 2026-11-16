'use strict';

const { spawn } = require('child_process');

const PACMAN_LOCK = { busy: false };
const PACMAN_QUEUE = [];

async function acquirePacmanLock() {
  if (!PACMAN_LOCK.busy) { PACMAN_LOCK.busy = true; return; }
  await new Promise((resolve) => PACMAN_QUEUE.push(resolve));
}

function releasePacmanLock() {
  const next = PACMAN_QUEUE.shift();
  if (next) next();
  else PACMAN_LOCK.busy = false;
}

async function executeShell(command, ctx) {
  let cmd = String(command || '').trim();
  if (!cmd) return 'Error: empty command';

  const timeoutMs = (ctx && ctx.timeoutMs) || 60000;
  const isPacman = /pacman(?:\.exe)?\b/i.test(cmd);
  if (isPacman) await acquirePacmanLock();

  try {
    return await executeShellInner(cmd, timeoutMs);
  } finally {
    if (isPacman) releasePacmanLock();
  }
}

async function executeShellInner(cmd, timeoutMs) {
  const isWin = process.platform === 'win32';

  if (isWin) {
    cmd = cmd.replace(/^cmd(?:\.exe)?\s+\/c\s+/i, '');
  } else {
    cmd = cmd.replace(/^(?:sh|bash)\s+-c\s+/i, '');
  }
  if (cmd.length >= 2) {
    if ((cmd[0] === '"' && cmd[cmd.length - 1] === '"') ||
        (cmd[0] === "'" && cmd[cmd.length - 1] === "'")) {
      cmd = cmd.slice(1, -1);
    }
  }
  if (!cmd) return 'Error: empty command after stripping prefix';

  return new Promise((resolve) => {
    const shellExe = isWin ? 'cmd.exe' : 'bash';
    const shellArgs = isWin ? ['/d', '/s', '/c', cmd] : ['-c', cmd];

    let proc;
    try {
      proc = spawn(shellExe, shellArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      return resolve(`Execution error: ${e.message}`);
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    proc.stdout.on('data', (d) => stdoutChunks.push(d));
    proc.stderr.on('data', (d) => stderrChunks.push(d));

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        return resolve(`Error: command timeout (${Math.round(timeoutMs / 1000)}s)`);
      }

      const decode = (buf) => {
        if (!buf.length) return '';
        if (isWin) {
          const utf8 = buf.toString('utf8');
          const bad = (utf8.match(/\uFFFD/g) || []).length;
          if (bad > 2) {
            try {
              const iconv = require('iconv-lite');
              if (iconv.encodingExists('gbk')) return iconv.decode(buf, 'gbk');
            } catch {}
          }
          return utf8;
        }
        return buf.toString('utf8');
      };

      const stdout = decode(Buffer.concat(stdoutChunks)).trim();
      const stderr = decode(Buffer.concat(stderrChunks)).trim();

      let out = '';
      if (stdout) out += stdout;
      if (stderr) out += (out ? '\n[stderr]\n' : '') + stderr;
      if (code !== 0) out += `\n[exit ${code}]`;
      resolve(out || '(no output)');
    });

    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve(`Execution error: ${e.message}`);
    });
  });
}

function registerTools(executor) {
  executor.registerTool(
    'shell',
    executeShell,
    'Execute shell command. 支持 shell@<seconds>:命令 自定义超时（默认 60s，最大 3600s）'
  );
}

module.exports = { registerTools, executeShell };