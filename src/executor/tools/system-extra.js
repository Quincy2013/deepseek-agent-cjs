'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('./_utils');

async function openFile(p) {
  const s = (p || '').trim();
  if (!s || !fs.existsSync(s)) return `Error: not found: ${s}`;
  try {
    if (process.platform === 'win32') await run('cmd', ['/c', 'start', '', path.resolve(s)]);
    else if (process.platform === 'darwin') await run('open', [s]);
    else await run('xdg-open', [s]);
    return `Opened: ${path.resolve(s)}`;
  } catch (e) { return `Open failed: ${e.message}`; }
}

async function setWallpaper(p) {
  const s = path.resolve((p || '').trim());
  if (!s || !fs.existsSync(s)) return `Error: not found: ${s}`;
  try {
    if (process.platform === 'win32') {
      const ps = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll",CharSet=CharSet.Auto)]public static extern int SystemParametersInfo(int u,int p,string s,int f);}';[W]::SystemParametersInfo(20,0,"${s.replace(/\\/g, '\\\\')}",3)`;
      await run('powershell', ['-NoProfile', '-Command', ps], { timeout: 15000 });
      return `Wallpaper set: ${s}`;
    }
    return 'Only Windows implemented';
  } catch (e) { return `Set wallpaper failed: ${e.message}`; }
}

async function sleepTool(sec) {
  const s = parseFloat((sec || '').trim());
  if (isNaN(s) || s < 0) return 'Error: invalid seconds';
  if (s > 300) return 'Error: max 300s';
  await new Promise((r) => setTimeout(r, s * 1000));
  return `Slept ${s}s`;
}

function registerTools(e) {
  e.registerTool('open_file', openFile, 'Open file with default app');
  e.registerTool('set_wallpaper', setWallpaper, 'Set wallpaper (high risk)');
  e.registerTool('sleep', sleepTool, 'Sleep N seconds (≤300)');
}
module.exports = { registerTools };