'use strict';

const fse = require('fs-extra');
const path = require('path');

function readFile(filePath) {
  const p = (filePath || '').trim().replace(/^["']|["']$/g, '');
  if (!p) return 'Error: no path';
  try {
    if (!fse.existsSync(p)) return `Error: not found: ${p}`;
    const stat = fse.statSync(p);
    if (stat.isDirectory()) return `Error: is a directory: ${p}`;
    return fse.readFileSync(p, 'utf8');
  } catch (e) {
    return `Error reading file: ${e.message}`;
  }
}

function writeFile(args) {
  const idx = args.indexOf('|||');
  if (idx === -1) return 'Error: write_file parameter format should be path|||content';
  const p = args.slice(0, idx).trim().replace(/^["']|["']$/g, '');
  const content = args.slice(idx + 3);
  if (!p) return 'Error: empty path';
  try {
    // outputFileSync 会自动创建所有父目录
    fse.outputFileSync(p, content, 'utf8');
    return `Write successful: ${path.resolve(p)} (${content.length} chars)`;
  } catch (e) {
    return `Write failed: ${e.message}`;
  }
}

function listDir(dirPath) {
  const p = (dirPath || '').trim().replace(/^["']|["']$/g, '') || '.';
  try {
    if (!fse.existsSync(p)) return `Error: not found: ${p}`;
    const items = fse.readdirSync(p, { withFileTypes: true });
    return items
      .map((it) => (it.isDirectory() ? it.name + '/' : it.name))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .join('\n') || '(empty directory)';
  } catch (e) {
    return `List directory failed: ${e.message}`;
  }
}

function registerTools(executor) {
  executor.registerTool('read_file', readFile, 'Read file content');
  executor.registerTool('write_file', writeFile, 'Write file content (path|||content, 自动创建目录)');
  executor.registerTool('list_dir', listDir, 'List directory contents');
}

module.exports = { registerTools };