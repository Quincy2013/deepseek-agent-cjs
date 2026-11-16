#!/usr/bin/env node
'use strict';

const http = require('http');
const url = require('url');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const PORT = parseInt(process.env.AI_ASSISTANT_PORT || '15722', 10);
const UPSTREAM_URL = (process.env.AI_ASSISTANT_UPSTREAM || 'http://127.0.0.1:15721/v1').replace(/\/+$/, '');
const DEFAULT_MODEL = process.env.AI_ASSISTANT_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.AI_ASSISTANT_TIMEOUT || '180000', 10);
const MAX_TOOL_ROUNDS = parseInt(process.env.AI_ASSISTANT_MAX_ROUNDS || '25', 10);
const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_CONTENT_CHARS = 12000;
const MAX_SESSIONS = 20;
const MAX_MESSAGES = 60;

const SESSIONS_FILE = path.resolve(__dirname, 'ai-assistant-sessions.json');
const LOG_FILE = path.resolve(__dirname, 'ai-assistant.log');

// ==================== 日志 ====================
let logStream = null;
try { logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' }); } catch {}

function log(...args) {
  const ts = new Date().toISOString().substring(11, 23);
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${ts}] ${msg}\n`;
  process.stdout.write(line);
  if (logStream) try { logStream.write(line); } catch {}
}

// ==================== 加载工具执行器 ====================
const { ToolExecutor } = require(path.join(__dirname, 'src/executor/tool-executor'));

const EXCLUDED_TOOLS = new Set([
  'ask_ai', 'list_ai_models',
  'ai_sessions', 'ai_session_reset', 'ai_service_status',
]);

const subLogger = {
  info: (...a) => log('[tools]', ...a),
  warn: (...a) => log('[warn]', ...a),
  error: (...a) => log('[error]', ...a),
  debug: () => {},
};

const toolExecutor = new ToolExecutor(
  {
    security: {
      command_whitelist: [],
      high_risk_patterns: ['rm -rf', 'mkfs', 'format', 'shutdown', 'reboot'],
      high_risk_tools: [],
    },
    limits: { tool_result_max_chars: MAX_TOOL_RESULT_CHARS },
  },
  {
    approvalRequired: false,
    logger: subLogger,
    excludeTools: Array.from(EXCLUDED_TOOLS),
  }
);


// ==================== 会话管理 ====================
let sessions = {};

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {
    log('会话加载失败:', e.message);
    sessions = {};
  }
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    log('会话保存失败:', e.message);
  }
}

function getSession(id) {
  if (!sessions[id]) {
    const keys = Object.keys(sessions);
    if (keys.length >= MAX_SESSIONS) {
      const oldest = keys
        .map(k => ({ k, t: new Date(sessions[k].updatedAt || 0).getTime() }))
        .sort((a, b) => a.t - b.t)[0]?.k;
      if (oldest) delete sessions[oldest];
    }
    sessions[id] = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    saveSessions();
  }
  return sessions[id];
}

function appendMessage(id, msg) {
  const s = getSession(id);
  s.messages.push(msg);
  if (s.messages.length > MAX_MESSAGES) {
    s.messages = s.messages.slice(-MAX_MESSAGES);
  }
  s.updatedAt = new Date().toISOString();
  saveSessions();
}

function resetSession(id) {
  if (sessions[id]) {
    sessions[id].messages = [];
    sessions[id].updatedAt = new Date().toISOString();
    saveSessions();
    return true;
  }
  return false;
}

function listSessions() {
  return Object.values(sessions).map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  }));
}

loadSessions();

// ==================== 工具声明 ====================
function buildToolDefs() {
  const defs = [];
  for (const [name] of Object.entries(toolExecutor.tools)) {
    if (EXCLUDED_TOOLS.has(name)) continue;
    defs.push({
      type: 'function',
      function: {
        name,
        description: name,
        parameters: {
          type: 'object',
          properties: {
            args: {
              type: 'string',
              description: '完整参数字符串。多参数工具用 ||| 分隔（如 "路径|||内容"）。',
            },
          },
          required: ['args'],
        },
      },
    });
  }
  return defs;
}

let TOOL_DEFS = null;
let executorReady = null;

function ensureReady() {
  if (!executorReady) {
    executorReady = (async () => {
      await toolExecutor.start();
      TOOL_DEFS = buildToolDefs();
      log(`暴露给上游 ${TOOL_DEFS.length} 个工具`);
    })();
  }
  return executorReady;
}

// ==================== 主对话逻辑 ====================
async function handleChat(req) {
  await ensureReady();
  const t0 = Date.now();
  const {
    task,
    system,
    session: sessionId = 'default',
    model = DEFAULT_MODEL,
    reset,
  } = req;

  if (!task || !task.trim()) {
    return { ok: false, error: 'task 为空' };
  }
  if (reset) resetSession(sessionId);

  appendMessage(sessionId, { role: 'user', content: task });

  const session = getSession(sessionId);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const m of session.messages) messages.push({ ...m });

  const toolTrace = [];
  let totalToolCalls = 0;
  let finalContent = '';
  let finalReasoning = '';
  let usedModel = model;
  let roundLimitHit = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = {
      model,
      stream: false,
      messages,
      tools: TOOL_DEFS,
      tool_choice: 'auto',
    };

    let resp;
    try {
      resp = await axios.post(`${UPSTREAM_URL}/chat/completions`, body, {
        timeout: DEFAULT_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
    } catch (e) {
      log(`上游失败 round ${round}:`, e.message);
      return { ok: false, error: `上游失败: ${e.message}`, session: sessionId };
    }

    if (resp.status >= 400) {
      log(`上游 HTTP ${resp.status}`);
      return {
        ok: false,
        error: `上游 HTTP ${resp.status}`,
        raw: JSON.stringify(resp.data).slice(0, 300),
        session: sessionId,
      };
    }

    const choice = resp.data?.choices?.[0];
    const msg = choice?.message || {};
    usedModel = resp.data?.model || usedModel;

    const content = typeof msg.content === 'string' ? msg.content : '';
    const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '';
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

    const assistantMsg = { role: 'assistant', content: content || '' };
    if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
    if (reasoning) assistantMsg.reasoning_content = reasoning;
    messages.push(assistantMsg);
    appendMessage(sessionId, assistantMsg);

    if (!toolCalls.length) {
      finalContent = content;
      finalReasoning = reasoning;
      break;
    }

    totalToolCalls += toolCalls.length;
    log(`round ${round}: ${toolCalls.length} 个工具调用`);

    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => {
        const name = tc.function?.name || '';
        let args = tc.function?.arguments || '';
        try {
          const p = JSON.parse(args);
          if (p && typeof p === 'object' && 'args' in p) args = String(p.args ?? '');
        } catch {}

        if (EXCLUDED_TOOLS.has(name)) {
          return { id: tc.id, name, content: `Error: 工具 ${name} 不可用` };
        }
        if (!toolExecutor.tools[name]) {
          return { id: tc.id, name, content: `Error: 工具 ${name} 未注册` };
        }

        try {
          log(`  → ${name}: ${String(args).slice(0, 80)}`);
          const resultObj = await toolExecutor.execute(`${name}:${args}`);
          let s;
          if (!resultObj || resultObj.ok === false) {
            s = `Error: ${resultObj?.error || 'unknown'}`;
          } else {
            s = resultObj.value;
          }
          if (!s || !String(s).trim()) s = '(empty result)';
          s = String(s);
          if (s.length > MAX_TOOL_RESULT_CHARS) {
            s = s.slice(0, MAX_TOOL_RESULT_CHARS) + '...(truncated)';
          }
          log(`  ← ${name}: ${s.slice(0, 80).replace(/\n/g, ' ')}`);
          return { id: tc.id, name, content: s };
        } catch (e) {
          return { id: tc.id, name, content: `Error: ${e.message}` };
        }
      })
    );

    for (const tr of toolResults) {
      const toolMsg = { role: 'tool', tool_call_id: tr.id, content: tr.content };
      messages.push(toolMsg);
      appendMessage(sessionId, toolMsg);
      toolTrace.push({ name: tr.name, preview: tr.content.slice(0, 100) });
    }

    if (round === MAX_TOOL_ROUNDS - 1) {
      roundLimitHit = true;
      log('达到工具轮次上限');
    }
  }

  const elapsed = Date.now() - t0;
  log(`完成: ${elapsed}ms, tools=${totalToolCalls}, session=${sessionId}`);

  return {
    ok: true,
    content: finalContent.length > MAX_CONTENT_CHARS
      ? finalContent.slice(0, MAX_CONTENT_CHARS) + '...(truncated)'
      : finalContent,
    reasoning: finalReasoning ? finalReasoning.slice(0, 1500) : '',
    model: usedModel,
    elapsed,
    session: sessionId,
    toolCalls: totalToolCalls,
    toolTrace: toolTrace.slice(0, 10),
    roundLimitHit,
  };
}

// ==================== HTTP 服务 ====================
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, {
        ok: true,
        pid: process.pid,
        uptime: Math.round(process.uptime()),
        tools: Object.keys(toolExecutor.tools).length,
        sessions: Object.keys(sessions).length,
        upstream: UPSTREAM_URL,
        defaultModel: DEFAULT_MODEL,
      });
    }

    if (req.method === 'GET' && pathname === '/sessions') {
      return json(res, 200, { ok: true, sessions: listSessions() });
    }

    if (req.method === 'POST' && pathname === '/session/reset') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const sid = body.session || 'default';
      return json(res, 200, { ok: resetSession(sid), session: sid });
    }

    if (req.method === 'POST' && pathname === '/chat') {
      const body = JSON.parse((await readBody(req)) || '{}');
      log(`→ /chat task="${String(body.task || '').slice(0, 60)}" session=${body.session || 'default'}`);
      const result = await handleChat(body);
      return json(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/tools') {
      return json(res, 200, { tools: Object.keys(toolExecutor.tools) });
    }

    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    log('handler error:', e.stack || e.message);
    json(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  await ensureReady();
  log('='.repeat(60));
  log(`子 AI 独立服务已启动`);
  log(`  PID:      ${process.pid}`);
  log(`  端口:     ${PORT}`);
  log(`  上游:     ${UPSTREAM_URL}`);
  log(`  默认模型: ${DEFAULT_MODEL}`);
  log(`  工具数:   ${Object.keys(toolExecutor.tools).length}`);
  log(`  会话数:   ${Object.keys(sessions).length}`);
  log('='.repeat(60));
});

server.on('error', (e) => {
  log('服务器错误:', e.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  log('收到 SIGINT，关闭中...');
  server.close(() => {
    if (logStream) try { logStream.end(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
});

process.on('uncaughtException', (e) => {
  log('未捕获异常:', e.stack || e.message);
});

process.on('unhandledRejection', (e) => {
  log('未处理 rejection:', e && (e.stack || e.message));
});
