'use strict';
const fs = require('fs');
const path = require('path');

function copyFile(args) {
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: source|||destination';
  const src = args.slice(0, i).trim(), dst = args.slice(i + 3).trim();
  try {
    if (!fs.existsSync(src)) return `Error: not found: ${src}`;
    const dir = path.dirname(path.resolve(dst));
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
    return `Copy successful: ${src} -> ${dst}`;
  } catch (e) { return `Copy failed: ${e.message}`; }
}

function moveFile(args) {
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: source|||destination';
  const src = args.slice(0, i).trim(), dst = args.slice(i + 3).trim();
  try {
    if (!fs.existsSync(src)) return `Error: not found: ${src}`;
    const dir = path.dirname(path.resolve(dst));
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      fs.renameSync(src, dst);
    } catch {
      fs.cpSync(src, dst, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
    }
    return `Move successful: ${src} -> ${dst}`;
  } catch (e) { return `Move failed: ${e.message}`; }
}

function deleteFile(p) {
  const s = (p || '').trim();
  if (!s) return 'Error: no path';
  try {
    if (!fs.existsSync(s)) return `Error: not found: ${s}`;
    fs.rmSync(s, { recursive: true, force: true });
    return `Delete successful: ${s}`;
  } catch (e) { return `Delete failed: ${e.message}`; }
}

function searchFiles(args) {
  const parts = args.split('|||');
  if (parts.length < 2) return 'Error: dir|||keyword[|||name|content]';
  const dir = parts[0].trim() || '.';
  const kw = parts[1].trim();
  const mode = (parts[2] || 'name').trim().toLowerCase();
  if (!fs.existsSync(dir)) return `Error: not found: ${dir}`;
  const results = [];
  const skip = new Set(['node_modules', '.git', '.cache', 'dist', 'build']);
  function walk(d, depth) {
    if (results.length >= 100 || depth > 8) return;
    let items;
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (results.length >= 100) return;
      const full = path.join(d, it.name);
      if (it.isDirectory()) {
        if (skip.has(it.name)) continue;
        walk(full, depth + 1);
      } else if (it.isFile()) {
        if (mode === 'content') {
          try { if (fs.readFileSync(full, 'utf8').includes(kw)) results.push(full); } catch {}
        } else if (it.name.toLowerCase().includes(kw.toLowerCase())) results.push(full);
      }
    }
  }
  walk(dir, 0);
  return results.length ? results.join('\n') : 'No files found';
}

function getFileInfo(p) {
  const s = (p || '').trim();
  if (!s) return 'Error: no path';
  try {
    const st = fs.statSync(s);
    return {
      path: path.resolve(s),
      size: st.size,
      sizeHuman: humanSize(st.size),
      isDir: st.isDirectory(),
      modified: new Date(st.mtimeMs).toISOString(),
      created: new Date(st.birthtimeMs).toISOString(),
      extension: path.extname(s),
    };
  } catch (e) { return `Get info failed: ${e.message}`; }
}

function humanSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(2)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

function registerTools(e) {
  e.registerTool('copy_file', copyFile, 'Copy file/dir (src|||dst)');
  e.registerTool('move_file', moveFile, 'Move file/dir (src|||dst)');
  e.registerTool('delete_file', deleteFile, 'Delete (high risk)');
  e.registerTool('search_files', searchFiles, 'Search (dir|||kw[|||name|content])');
  e.registerTool('get_file_info', getFileInfo, 'Get file info');
}
module.exports = { registerTools };