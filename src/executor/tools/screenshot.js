'use strict';
const path = require('path');
let ss = null;
try { ss = require('screenshot-desktop'); } catch {}

async function shot(p) {
  if (!ss) return 'Error: screenshot-desktop not installed';
  const file = (p || '').trim() || `screenshot_${Date.now()}.png`;
  const abs = path.resolve(file);
  try {
    await ss({ filename: abs });
    return `Screenshot saved: ${abs}\n提示：可以接着 upload_image:${abs} 让 AI 看这张图。`;
  } catch (e) { return `Screenshot failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('screenshot', shot, 'Take screenshot');
}
module.exports = { registerTools };