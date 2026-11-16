'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BLOCKED_IMPORTS = [
  'shutil.rmtree("/',
  "shutil.rmtree('/",
];

function checkCode(code) {
  for (const b of BLOCKED_IMPORTS) {
    if (code.includes(b)) return `Error: blocked pattern '${b}'`;
  }
  return null;
}

async function executePython(code, ctx) {
  const src = (code || '').trim();
  if (!src) return 'Error: no code provided';

  const blocked = checkCode(src);
  if (blocked) return blocked;

  const timeoutMs = (ctx && ctx.timeoutMs) || 30000;

  // ★ 临时文件加随机后缀，防并发碰撞
  const tmpFile = path.join(
    os.tmpdir(),
    `agent_py_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.py`
  );
  fs.writeFileSync(tmpFile, src, 'utf8');

  return new Promise((resolve) => {
    const proc = spawn('python', [tmpFile], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      if (killed) {
        return resolve(
          `[timeout after ${Math.round(timeoutMs / 1000)}s, operation may be incomplete]\n${stdout}\n${stderr}`
        );
      }
      let out = '';
      if (stdout) out += stdout;
      if (stderr) out += (out ? '\n[stderr]\n' : '') + stderr;
      if (code !== 0) out += `\n[exit code: ${code}]`;
      resolve(out || '(no output)');
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      resolve(`Python execution failed: ${err.message}`);
    });
  });
}

function registerTools(executor) {
  executor.registerTool(
    'python',
    executePython,
    'Execute Python code. 支持 python@<seconds>:代码 自定义超时（默认 30s，最大 3600s）'
  );
}

module.exports = { registerTools };