'use strict';

const fse = require('fs-extra');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cache', 'dist', 'build',
  '.idea', '.vscode', '__pycache__', '.next', 'coverage',
]);

function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$(){}|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function glob(args) {
  const parts = (args || '').split('|||').map((s) => s.trim());
  const root = parts[0] || '.';
  const pattern = parts[1] || '*';
  if (!fse.existsSync(root)) return `Error: not found: ${root}`;

  const regex = globToRegex(pattern);
  const results = [];
  const MAX = 200;

  function walk(dir, depth) {
    if (results.length >= MAX || depth > 10) return;
    let items;
    try { items = fse.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (results.length >= MAX) return;
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        walk(path.join(dir, it.name), depth + 1);
      } else {
        const rel = path.relative(root, path.join(dir, it.name)).split(path.sep).join('/');
        if (regex.test(rel) || regex.test(it.name)) {
          results.push(path.join(dir, it.name));
        }
      }
    }
  }

  try {
    walk(root, 0);
    return results.length ? results.join('\n') : 'No files matched';
  } catch (e) {
    return `Glob failed: ${e.message}`;
  }
}

function grep(args) {
  const parts = (args || '').split('|||').map((s) => s.trim());
  const root = parts[0] || '.';
  const pattern = parts[1];
  const fileGlob = parts[2] || '*';
  const caseSensitive = parts[3] === 'true';

  if (!pattern) return 'Error: format should be dir|||pattern[|||file_glob[|||case_sensitive]]';
  if (!fse.existsSync(root)) return `Error: not found: ${root}`;

  let re;
  try {
    re = new RegExp(pattern, caseSensitive ? '' : 'i');
  } catch (e) {
    return `Error: invalid regex: ${e.message}`;
  }

  const fileRegex = globToRegex(fileGlob);
  const results = [];
  const MAX_MATCHES = 200;

  function walk(dir, depth) {
    if (results.length >= MAX_MATCHES || depth > 10) return;
    let items;
    try { items = fse.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (results.length >= MAX_MATCHES) return;
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        walk(path.join(dir, it.name), depth + 1);
      } else {
        if (!fileRegex.test(it.name)) continue;
        const full = path.join(dir, it.name);
        let content;
        try {
          const stat = fse.statSync(full);
          if (stat.size > 2 * 1024 * 1024) continue;
          content = fse.readFileSync(full, 'utf8');
        } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= MAX_MATCHES) return;
          if (re.test(lines[i])) {
            results.push(`${full}:${i + 1}: ${lines[i].slice(0, 200)}`);
          }
        }
      }
    }
  }

  try {
    walk(root, 0);
    return results.length ? results.join('\n') : 'No matches';
  } catch (e) {
    return `Grep failed: ${e.message}`;
  }
}

function registerTools(executor) {
  executor.registerTool('glob', glob, 'Find files by glob pattern (dir|||pattern, e.g. .|||**/*.js)');
  executor.registerTool('grep', grep, 'Search file contents (dir|||pattern[|||file_glob[|||case_sensitive]])');
}

module.exports = { registerTools };