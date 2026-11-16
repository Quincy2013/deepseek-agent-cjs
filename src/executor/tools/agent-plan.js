'use strict';
const fs = require('fs');
const path = require('path');

const TODO_FILE = path.resolve('todos.json');

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readTodos() {
  try {
    if (!fs.existsSync(TODO_FILE)) return [];
    return JSON.parse(fs.readFileSync(TODO_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeTodos(todos) {
  ensureParentDir(TODO_FILE);
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2), 'utf8');
}

function todoWrite(args) {
  let items;
  try {
    items = JSON.parse(args.trim());
  } catch (e) {
    return `Error: invalid JSON: ${e.message}. Expected [{"id":1,"text":"...","status":"pending|in_progress|done"}, ...]`;
  }
  if (!Array.isArray(items)) return 'Error: expected a JSON array';
  if (items.length > 50) return 'Error: max 50 items';

  const todos = items.map((it, i) => ({
    id: it.id ?? i + 1,
    text: String(it.text || it.content || '').trim(),
    status: ['pending', 'in_progress', 'done'].includes(it.status) ? it.status : 'pending',
    updatedAt: new Date().toISOString(),
  }));

  try {
    writeTodos(todos);
    return `Todo list saved (${todos.length} items):\n` + formatTodos(todos);
  } catch (e) {
    return `Write todos failed: ${e.message}`;
  }
}

function todoRead() {
  const todos = readTodos();
  if (!todos.length) return '(todo list is empty)';
  return formatTodos(todos);
}

function todoUpdate(args) {
  const parts = (args || '').split('|||').map((s) => s.trim());
  const id = parseInt(parts[0], 10);
  const status = parts[1];
  if (isNaN(id) || !status) return 'Error: format should be id|||status (pending|in_progress|done)';

  const todos = readTodos();
  const item = todos.find((t) => t.id === id);
  if (!item) return `Error: todo ${id} not found`;
  if (!['pending', 'in_progress', 'done'].includes(status)) {
    return `Error: invalid status '${status}'`;
  }
  item.status = status;
  item.updatedAt = new Date().toISOString();
  writeTodos(todos);
  return `Updated todo ${id} -> ${status}`;
}

function todoClear() {
  try {
    writeTodos([]);
    return 'Todo list cleared';
  } catch (e) {
    return `Clear failed: ${e.message}`;
  }
}

function formatTodos(todos) {
  const icons = { pending: '[ ]', in_progress: '[~]', done: '[x]' };
  return todos.map((t) => `${icons[t.status] || '[ ]'} #${t.id} ${t.text}`).join('\n');
}

function registerTools(executor) {
  executor.registerTool('todo_write', todoWrite, 'Write/replace the todo list (JSON array)');
  executor.registerTool('todo_read', todoRead, 'Read current todo list');
  executor.registerTool('todo_update', todoUpdate, 'Update a todo status (id|||status)');
  executor.registerTool('todo_clear', todoClear, 'Clear the todo list');
}

module.exports = { registerTools };