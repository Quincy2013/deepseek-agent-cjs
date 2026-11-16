'use strict';
const { run } = require('./_utils');

async function listProcesses(filter) {
  const f = (filter || '').trim().toLowerCase();
  try {
    if (process.platform === 'win32') {
      const r = await run('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 15000 });
      const lines = r.stdout.split(/\r?\n/).filter(Boolean);
      const out = [];
      for (const line of lines) {
        const m = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"/);
        if (!m) continue;
        const [, name, pid, mem] = m;
        if (f && !name.toLowerCase().includes(f)) continue;
        out.push(`PID ${pid.padEnd(8)} ${name.padEnd(32)} ${mem}`);
        if (out.length >= 100) break;
      }
      return out.length ? out.join('\n') : 'No processes found';
    } else {
      const r = await run('ps', ['aux'], { timeout: 10000 });
      const lines = r.stdout.split('\n').filter((l) => !f || l.toLowerCase().includes(f));
      return lines.slice(0, 100).join('\n') || 'No processes found';
    }
  } catch (e) {
    return `List processes failed: ${e.message}`;
  }
}

async function killProcess(target) {
  const t = (target || '').trim();
  if (!t) return 'Error: specify PID or process name';

  // Protect against killing the agent's own process (BUG-10)
  const MY_PID = process.pid;
  const PROTECTED_NAMES = ['node', 'node.exe', 'electron', 'electron.exe'];

  // Protect self by PID
  if (/^\d+$/.test(t) && parseInt(t, 10) === MY_PID) {
    return 'Error: 拒绝杀掉自身进程';
  }

  // Protect agent dependencies by name
  if (PROTECTED_NAMES.some((n) => t.toLowerCase().includes(n))) {
    return 'Error: 拒绝杀掉 agent 依赖的进程';
  }

  try {
    if (process.platform === 'win32') {
      const args = /^\d+$/.test(t) ? ['/F', '/PID', t] : ['/F', '/IM', t];
      const r = await run('taskkill', args, { timeout: 15000 });
      return r.failed ? `Kill failed: ${r.stderr || r.stdout}` : `Terminated ${t}`;
    } else {
      const args = /^\d+$/.test(t) ? ['-9', t] : ['-9', '-f', t];
      const r = await run('pkill', args.slice(0, 1).concat(args.slice(1)), { timeout: 10000 });
      return r.failed ? `Kill failed: ${r.stderr}` : `Terminated ${t}`;
    }
  } catch (e) {
    return `Kill process failed: ${e.message}`;
  }
}

function registerTools(e) {
  e.registerTool('list_processes', listProcesses, 'List processes (optional filter)');
  e.registerTool('kill_process', killProcess, 'Kill process by PID or name (high risk)');
}
module.exports = { registerTools };