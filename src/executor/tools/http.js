'use strict';
const fs = require('fs');
const path = require('path');

async function httpGet(url) {
  const u = (url || '').trim();
  if (!u) return 'Error: no URL';
  try {
    const resp = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const t = await resp.text();
    return { status: resp.status, contentType: resp.headers.get('content-type') || '', text: t.slice(0, 3000), truncated: t.length > 3000 };
  } catch (e) { return `HTTP GET failed: ${e.message}`; }
}

async function httpPost(args) {
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: url|||json_data';
  const url = args.slice(0, i).trim();
  const body = args.slice(i + 3).trim();
  let data;
  try { data = body ? JSON.parse(body) : {}; } catch { return 'Error: invalid JSON'; }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000),
    });
    const t = await resp.text();
    return { status: resp.status, text: t.slice(0, 2000), truncated: t.length > 2000 };
  } catch (e) { return `HTTP POST failed: ${e.message}`; }
}

async function downloadFile(args) {
  const parts = args.split('|||').map((s) => s.trim());
  const url = parts[0];
  if (!url) return 'Error: no URL';
  const file = parts[1] || url.split('/').pop()?.split('?')[0] || `dl_${Date.now()}`;
  const abs = path.resolve(file);
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) return `Download failed: HTTP ${resp.status}`;
    const buf = Buffer.from(await resp.arrayBuffer());
    const dir = path.dirname(abs);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, buf);
    return `Downloaded to ${abs} (${(buf.length / 1024).toFixed(1)} KB)`;
  } catch (e) { return `Download failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('http_get', httpGet, 'HTTP GET');
  e.registerTool('http_post', httpPost, 'HTTP POST (url|||json)');
  e.registerTool('download_file', downloadFile, 'Download file (url[|||path])');
}
module.exports = { registerTools };