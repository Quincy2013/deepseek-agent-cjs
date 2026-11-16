'use strict';

const fse = require('fs-extra');
const path = require('path');

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.ico', '.tiff', '.tif', '.avif',
]);

const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.log', '.csv', '.tsv',
  '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.env',
  '.xml', '.html', '.htm', '.css', '.scss', '.less', '.sass',
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.vue', '.svelte',
  '.py', '.py3', '.rb', '.go', '.rs', '.java', '.kt', '.scala', '.swift',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.cs', '.php', '.pl', '.lua',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.fish',
  '.sql', '.graphql', '.proto',
  '.gitignore', '.gitattributes', '.editorconfig',
]);

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;    // 50 MB
const INLINE_SIZE_THRESHOLD = 64 * 1024;      // 64 KB
const MAX_FILES_PER_CALL = 20;

function isImage(p) {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

function isTextFile(p) {
  const ext = path.extname(p).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  // 无扩展名视为文本（Dockerfile、Makefile、README 等）
  if (!ext) return true;
  return false;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function readFiles(args, executor) {
  const paths = (args || '')
    .split('|||')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_FILES_PER_CALL);

  if (!paths.length) return 'Error: no paths provided';

  const outputs = [];
  const toUpload = [];

  for (const p of paths) {
    if (!fse.existsSync(p)) {
      outputs.push(`[not found] ${p}`);
      continue;
    }
    let stat;
    try {
      stat = fse.statSync(p);
    } catch (e) {
      outputs.push(`[stat error] ${p}: ${e.message}`);
      continue;
    }
    if (stat.isDirectory()) {
      outputs.push(`[is a directory] ${p}（列出目录请用 list_dir）`);
      continue;
    }

    // 图片 → 上传
    if (isImage(p)) {
      if (stat.size > MAX_UPLOAD_BYTES) {
        outputs.push(`[image too large: ${humanSize(stat.size)}, max 50MB] ${p}`);
        continue;
      }
      toUpload.push(p);
      outputs.push(`[image queued for upload] ${p} (${humanSize(stat.size)})`);
      continue;
    }

    // 非文本非图片 → 拒绝
    if (!isTextFile(p)) {
      outputs.push(`[not a text file, skipped] ${p}`);
      continue;
    }

    // 小文本 → 直接读
    if (stat.size <= INLINE_SIZE_THRESHOLD) {
      try {
        const content = fse.readFileSync(p, 'utf8');
        outputs.push(`=== ${p} (${humanSize(stat.size)}) ===\n${content}`);
      } catch (e) {
        outputs.push(`[read error] ${p}: ${e.message}`);
      }
      continue;
    }

    // 大文本 → 上传
    if (stat.size > MAX_UPLOAD_BYTES) {
      outputs.push(`[too large: ${humanSize(stat.size)}, max 50MB] ${p}`);
      continue;
    }
    toUpload.push(p);
    outputs.push(`[large text queued for upload] ${p} (${humanSize(stat.size)})`);
  }

  if (toUpload.length) {
    const browser = executor._browser;
    if (!browser || typeof browser.uploadFiles !== 'function') {
      outputs.push(`[upload failed: browser not attached] ${toUpload.join(', ')}`);
    } else {
      const ok = await browser.uploadFiles(toUpload);
      if (ok) {
        outputs.push(
          `已上传 ${toUpload.length} 个文件到 DeepSeek，下一轮你可以基于文件内容回答：\n  ` +
          toUpload.map((p) => `${p} (${humanSize(fse.statSync(p).size)})`).join('\n  ')
        );
      } else {
        outputs.push(`[upload failed] ${toUpload.join(', ')}`);
      }
    }
  }

  return outputs.join('\n\n');
}

function writeFiles(args) {
  const s = (args || '').trim();
  if (!s) return 'Error: no input';

  // JSON 批量格式
  if (s.startsWith('[') || s.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(s);
    } catch (e) {
      return `Error: invalid JSON: ${e.message}`;
    }
    if (!Array.isArray(parsed)) return 'Error: JSON should be an array of {path, content}';
    const results = [];
    for (const item of parsed) {
      const p = item.path || item.file || item.filename;
      const content = item.content ?? item.text ?? '';
      if (!p) { results.push('[skip] missing path'); continue; }
      try {
        fse.outputFileSync(p, content, 'utf8');
        results.push(`[ok] ${path.resolve(p)} (${content.length} chars)`);
      } catch (e) {
        results.push(`[fail] ${p}: ${e.message}`);
      }
    }
    return results.join('\n');
  }

  // 简写：path|||content（单文件）
  const idx = s.indexOf('|||');
  if (idx !== -1) {
    const p = s.slice(0, idx).trim();
    const content = s.slice(idx + 3);
    if (!p) return 'Error: empty path';
    try {
      fse.outputFileSync(p, content, 'utf8');
      return `Write successful: ${path.resolve(p)} (${content.length} chars)`;
    } catch (e) {
      return `Write failed: ${e.message}`;
    }
  }

  return 'Error: use JSON array [{"path":"...","content":"..."}] or path|||content';
}

function editFile(args) {
  const idx1 = args.indexOf('|||');
  if (idx1 === -1) return 'Error: format should be path|||old_string|||new_string';
  const idx2 = args.indexOf('|||', idx1 + 3);
  if (idx2 === -1) return 'Error: format should be path|||old_string|||new_string';

  const p = args.slice(0, idx1).trim();
  const oldStr = args.slice(idx1 + 3, idx2);
  const newStr = args.slice(idx2 + 3);

  if (!p) return 'Error: empty path';
  if (!oldStr) return 'Error: empty old_string';
  if (!fse.existsSync(p)) return `Error: not found: ${p}`;

  try {
    const content = fse.readFileSync(p, 'utf8');
    const occurrences = content.split(oldStr).length - 1;
    if (occurrences === 0) return `Error: old_string not found in ${p}`;
    if (occurrences > 1) {
      return `Error: old_string appears ${occurrences} times in ${p}, must be unique`;
    }
    const updated = content.replace(oldStr, newStr);
    fse.writeFileSync(p, updated, 'utf8');
    return `Edited ${p}: replaced 1 occurrence (${content.length} -> ${updated.length} chars)`;
  } catch (e) {
    return `Edit failed: ${e.message}`;
  }
}

function createDir(p) {
  const s = (p || '').trim();
  if (!s) return 'Error: no path';
  try {
    fse.ensureDirSync(s);
    return `Directory created: ${path.resolve(s)}`;
  } catch (e) {
    return `Create dir failed: ${e.message}`;
  }
}

function fileExists(p) {
  const s = (p || '').trim();
  if (!s) return 'Error: no path';
  const exists = fse.existsSync(s);
  if (!exists) return `exists: false  ${s}`;
  const stat = fse.statSync(s);
  return `exists: true  isDir: ${stat.isDirectory()}  size: ${humanSize(stat.size)}  modified: ${stat.mtime.toISOString()}`;
}

function fileTree(args) {
  const parts = (args || '').split('|||').map((s) => s.trim());
  const root = parts[0] || '.';
  const maxDepth = parts[1] ? parseInt(parts[1], 10) : 3;
  if (!fse.existsSync(root)) return `Error: not found: ${root}`;

  const lines = [];
  const skipDirs = new Set([
    'node_modules', '.git', '.cache', 'dist', 'build',
    '.idea', '.vscode', '__pycache__', '.next', 'coverage',
  ]);
  const MAX_ENTRIES = 500;

  function walk(dir, prefix, depth) {
    if (depth > maxDepth || lines.length >= MAX_ENTRIES) return;
    let items;
    try { items = fse.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    items.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const it of items) {
      if (lines.length >= MAX_ENTRIES) return;
      if (skipDirs.has(it.name)) continue;
      const isDir = it.isDirectory();
      lines.push(`${prefix}${isDir ? '📁' : '📄'} ${it.name}${isDir ? '/' : ''}`);
      if (isDir) walk(path.join(dir, it.name), prefix + '  ', depth + 1);
    }
  }

  lines.push(`📁 ${path.basename(path.resolve(root)) || root}/`);
  walk(root, '  ', 1);
  if (lines.length >= MAX_ENTRIES) lines.push(`...(超过 ${MAX_ENTRIES} 项，已截断)`);
  return lines.join('\n');
}

function registerTools(executor) {
  executor.registerTool(
    'read_files',
    (a) => readFiles(a, executor),
    'Read multiple files. Images or files >64KB are auto-uploaded to DeepSeek (≤50MB, text only). Paths separated by |||.'
  );
  executor.registerTool(
    'write_files',
    writeFiles,
    'Write files. Use JSON array [{"path":"...","content":"..."}] for batch, or path|||content for single.'
  );
  executor.registerTool(
    'edit_file',
    editFile,
    'Replace a unique string in a file: path|||old_string|||new_string'
  );
  executor.registerTool('create_dir', createDir, 'Create directory (recursive)');
  executor.registerTool('file_exists', fileExists, 'Check if a file or directory exists');
  executor.registerTool('file_tree', fileTree, 'Show directory tree (dir|||maxDepth, default 3)');
}

module.exports = { registerTools };