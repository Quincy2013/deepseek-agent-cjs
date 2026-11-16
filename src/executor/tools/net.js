'use strict';
const { run } = require('./_utils');

async function netstat() {
  try {
    if (process.platform === 'win32') {
      const r = await run('netstat', ['-ano'], { timeout: 10000 });
      const lines = r.stdout.split('\n').filter(Boolean);
      const out = [];
      for (const line of lines) {
        if (!line.includes('TCP') && !line.includes('UDP')) continue;
        out.push(line.trim());
      }
      return out.length ? out.join('\n') : 'No connections found';
    } else {
      const r = await run('netstat', ['-tuln'], { timeout: 10000 });
      return r.stdout.trim() || 'No connections found';
    }
  } catch (e) {
    return `Netstat failed: ${e.message}`;
  }
}

async function getPublicIp() {
  try {
    const resp = await fetch('https://api.ipify.org?format=text', { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return `HTTP ${resp.status}`;
    const ip = await resp.text();
    return `Public IP: ${ip.trim()}`;
  } catch (e) {
    return `Get public IP failed: ${e.message}`;
  }
}

function registerTools(e) {
  e.registerTool('netstat', netstat, 'Show network connections');
  e.registerTool('get_public_ip', getPublicIp, 'Get public IP address');
}
module.exports = { registerTools };