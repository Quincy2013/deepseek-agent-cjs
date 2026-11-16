'use strict';
const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.resolve('memory.json');
const MAX_VALUE_LEN = 4000;

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return {};
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  ensureParentDir(MEMORY_FILE);
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function memorySave(args) {
  const idx = args.indexOf('|||');
  if (idx === -1) return 'Error: format should be key|||value';
  const key = args.slice(0, idx).trim();
  let value = args.slice(idx + 3);
  if (!key) return 'Error: empty key';
  if (value.length > MAX_VALUE_LEN) {
    value = value.slice(0, MAX_VALUE_LEN) + '...(truncated)';
  }
  try {
    const data = load();
    data[key] = { value, updatedAt: new Date().toISOString() };
    save(data);
    return `Saved memory: ${key} (${value.length} chars)`;
  } catch (e) {
    return `Save memory failed: ${e.message}`;
  }
}

function memoryLoad(key) {
  const k = (key || '').trim();
  if (!k) return 'Error: no key';
  const data = load();
  if (!(k in data)) return `Memory not found: ${k}`;
  const entry = data[k];
  return `[${entry.updatedAt}]\n${entry.value}`;
}

function memoryList() {
  const data = load();
  const keys = Object.keys(data);
  if (!keys.length) return '(no memory entries)';
  return keys.map((k) => {
    const v = data[k];
    const preview = String(v.value).slice(0, 60).replace(/\n/g, ' ');
    return `${k}  (${v.updatedAt})  ${preview}...`;
  }).join('\n');
}

function memoryDelete(key) {
  const k = (key || '').trim();
  if (!k) return 'Error: no key';
  const data = load();
  if (!(k in data)) return `Memory not found: ${k}`;
  delete data[k];
  save(data);
  return `Deleted memory: ${k}`;
}

function registerTools(executor) {
  executor.registerTool('memory_save', memorySave, 'Save persistent memory (key|||value)');
  executor.registerTool('memory_load', memoryLoad, 'Load a memory entry by key');
  executor.registerTool('memory_list', memoryList, 'List all memory keys');
  executor.registerTool('memory_delete', memoryDelete, 'Delete a memory entry');
}

module.exports = { registerTools };