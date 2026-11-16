'use strict';

function getEnv(p) {
  const s = (p || '').trim();
  if (!s) {
    // Return all env vars as JSON
    return JSON.stringify(process.env, null, 2);
  }
  const value = process.env[s];
  return value !== undefined ? value : `(not set)`;
}

function setEnv(args) {
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: name|||value';
  const name = args.slice(0, i).trim();
  const value = args.slice(i + 3).trim();
  if (!name) return 'Error: name required';
  process.env[name] = value;
  return `Set ${name}=${value}`;
}

function registerTools(e) {
  e.registerTool('get_env', getEnv, 'Get environment variable (name) or all if empty');
  e.registerTool('set_env', setEnv, 'Set environment variable (name|||value)');
}
module.exports = { registerTools };