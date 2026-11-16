'use strict';
const crypto = require('crypto');

function b64e(t) { return Buffer.from(String(t), 'utf8').toString('base64'); }
function b64d(t) { try { return Buffer.from(String(t).trim(), 'base64').toString('utf8'); } catch (e) { return `Error: ${e.message}`; } }
function ue(t) { return encodeURIComponent(String(t)); }
function ud(t) { try { return decodeURIComponent(String(t)); } catch (e) { return `Error: ${e.message}`; } }

function hash(args) {
  const i = args.indexOf('|||');
  const algo = (i === -1 ? 'sha256' : args.slice(0, i)).trim().toLowerCase();
  const data = i === -1 ? args : args.slice(i + 3);
  if (!crypto.getHashes().includes(algo)) return `Error: unsupported algo '${algo}'`;
  return crypto.createHash(algo).update(data, 'utf8').digest('hex');
}

function registerTools(e) {
  e.registerTool('base64_encode', b64e, 'Base64 encode');
  e.registerTool('base64_decode', b64d, 'Base64 decode');
  e.registerTool('url_encode', ue, 'URL encode');
  e.registerTool('url_decode', ud, 'URL decode');
  e.registerTool('hash', hash, 'Hash (algo|||data)');
  e.registerTool('uuid', () => crypto.randomUUID(), 'UUID v4');
}
module.exports = { registerTools };