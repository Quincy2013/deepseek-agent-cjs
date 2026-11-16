'use strict';
const os = require('os');

function sysInfo() {
  return {
    platform: os.platform(),
    type: os.type(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    totalMemMB: Math.round(os.totalmem() / 1048576),
    freeMemMB: Math.round(os.freemem() / 1048576),
    uptimeHours: (os.uptime() / 3600).toFixed(2),
    homeDir: os.homedir(),
    tmpDir: os.tmpdir(),
    user: os.userInfo().username,
  };
}

async function cpuUsage() {
  const c1 = os.cpus();
  const idle1 = c1.reduce((a, c) => a + c.times.idle, 0);
  const tot1 = c1.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
  await new Promise((r) => setTimeout(r, 1000));
  const c2 = os.cpus();
  const idle2 = c2.reduce((a, c) => a + c.times.idle, 0);
  const tot2 = c2.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
  const percent = tot2 - tot1 > 0 ? (1 - (idle2 - idle1) / (tot2 - tot1)) * 100 : 0;
  return { percent: Number(percent.toFixed(2)) };
}

function memUsage() {
  const total = os.totalmem(), free = os.freemem();
  const used = total - free;
  return {
    totalMB: Math.round(total / 1048576),
    usedMB: Math.round(used / 1048576),
    freeMB: Math.round(free / 1048576),
    percent: Number(((used / total) * 100).toFixed(2)),
  };
}

function registerTools(e) {
  e.registerTool('sys_info', () => sysInfo(), 'Get system information');
  e.registerTool('cpu_usage', () => cpuUsage(), 'Get CPU usage');
  e.registerTool('mem_usage', () => memUsage(), 'Get memory usage');
}
module.exports = { registerTools };