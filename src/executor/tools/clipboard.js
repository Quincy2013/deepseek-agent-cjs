'use strict';
let cb = null;
try { cb = require('clipboardy'); } catch {}

async function copy(t) {
  if (!cb) return 'Error: clipboardy not installed';
  try { await cb.write(String(t)); return `Copied ${t.length} chars`; }
  catch (e) { return `Copy failed: ${e.message}`; }
}

async function paste() {
  if (!cb) return 'Error: clipboardy not installed';
  try { return (await cb.read()) || '(empty)'; }
  catch (e) { return `Paste failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('clipboard_copy', copy, 'Copy to clipboard');
  e.registerTool('clipboard_paste', () => paste(), 'Read clipboard');
}
module.exports = { registerTools };