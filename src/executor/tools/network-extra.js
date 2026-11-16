'use strict';
let ping = null;
try { ping = require('ping'); } catch {}

async function pingHost(h) {
  const host = (h || '').trim();
  if (!host) return 'Error: no host';
  if (!ping) return 'Error: ping not installed';
  try {
    const r = await ping.promise.probe(host, { timeout: 3 });
    if (!r.alive) return `Host ${host} unreachable`;
    return `Ping to ${r.host}: ${parseFloat(r.time).toFixed(2)} ms`;
  } catch (e) { return `Ping failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('ping_host', pingHost, 'Ping host');
}
module.exports = { registerTools };