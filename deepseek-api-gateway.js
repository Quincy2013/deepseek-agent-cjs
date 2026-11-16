'use strict';

const express = require('express');
const { loadConfig } = require('./src/config');
const { setupLogger } = require('./src/logger');
const { parseToolCalls } = require('./src/parser');

const app = express();
app.use(express.json({ limit: '20mb' }));

const config = loadConfig('config.yaml');
const logger = setupLogger(config.log_file);

// 如果 fork 时传了独立目录，覆盖配置
if (process.env.GATEWAY_USER_DATA_DIR) {
  config.user_data_dir = process.env.GATEWAY_USER_DATA_DIR;
  logger.info('[gateway] 使用独立 user_data_dir:', config.user_data_dir);
}

// ==================== 浏览器实例 ====================
let browser = null;
let browserReady = null;

async function ensureBrowser() {
  if (browserReady) return browserReady;
  browserReady = (async () => {
    const { BrowserController } = require('./src/browser/browser-controller');
    logger.info('[gateway] 启动浏览器...');
    browser = new BrowserController(config, logger);
    await browser.start();
    await browser.waitForLogin();
    logger.info('[gateway] 浏览器就绪');
    return browser;
  })();
  return browserReady;
}

// ==================== 会话管理 ====================
// sessionId -> conversationId（DeepSeek 对话 UUID）
const sessions = new Map();

function getCurrentConversationId() {
  if (!browser || !browser.page) return null;
  const url = browser.page.url();
  const m = url.match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
  return m ? m[1] : null;
}

async function navigateToConversation(conversationId) {
  if (!browser || !browser.page) throw new Error('browser not ready');
  if (getCurrentConversationId() === conversationId) return;

  const url = `https://chat.deepseek.com/a/chat/s/${conversationId}`;
  logger.info('[gateway] 切换对话:', conversationId);
  await browser.page.goto(url, { waitUntil: 'domcontentloaded' });
  await browser.page.waitForSelector(config.selectors.message_input, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));
}

// ==================== tools 定义 → prompt ====================
function toolsToPrompt(tools) {
  if (!tools || !tools.length) return '';
  const lines = ['【可用工具】'];
  for (const t of tools) {
    const fn = t.function || t;
    lines.push(`- ${fn.name}: ${fn.description || ''}`);
    if (fn.parameters?.properties) {
      const params = Object.keys(fn.parameters.properties);
      if (params.length) lines.push(`  参数: ${params.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('调用格式：[[TOOL:工具名:参数]]');
  lines.push('多个调用用 ||| 分隔。');
  return lines.join('\n');
}

// ==================== messages → prompt ====================
function messagesToPrompt(messages, tools) {
  const parts = [];
  const toolsDesc = toolsToPrompt(tools);
  if (toolsDesc) parts.push(toolsDesc);

  for (const m of messages) {
    let content = m.content || '';
    if (Array.isArray(content)) {
      content = content.map(c => c.text || '').join('\n');
    }
    parts.push(`[${m.role}]\n${content}`);
  }
  return parts.join('\n\n');
}

// ==================== 参数结构化（方向 1）====================
function rawToSchema(argsStr, schema) {
  if (!schema) return JSON.stringify({ raw: argsStr });

  const props = schema.properties || {};
  const propKeys = Object.keys(props);

  if (propKeys.length === 0) return '{}';

  // 已经是 JSON，直接返回
  try {
    const parsed = JSON.parse(argsStr);
    if (typeof parsed === 'object' && parsed !== null) return argsStr;
  } catch {}

  // 单参数：把整个 raw 给那一个参数
  if (propKeys.length === 1) {
    return JSON.stringify({ [propKeys[0]]: argsStr });
  }

  // 多参数：按 ||| 拆分
  if (argsStr.includes('|||')) {
    const parts = argsStr.split('|||');
    const obj = {};
    for (let i = 0; i < propKeys.length && i < parts.length; i++) {
      obj[propKeys[i]] = parts[i];
    }
    return JSON.stringify(obj);
  }

  return JSON.stringify({ raw: argsStr });
}

// ==================== AI 回复 → OpenAI 格式 ====================
function parseResponseToOpenAI(aiResponse, model, tools) {
  const toolSchemas = new Map();
  for (const t of (tools || [])) {
    const fn = t.function || t;
    toolSchemas.set(fn.name, fn.parameters);
  }

  const declaredNames = new Set(toolSchemas.keys());
  const commands = declaredNames.size > 0
    ? parseToolCalls(aiResponse, config, declaredNames)
    : [];

  if (commands.length) {
    const toolCalls = commands.map((cmd, idx) => {
      const colon = cmd.indexOf(':');
      const name = colon === -1 ? cmd.trim() : cmd.slice(0, colon).trim();
      const argsStr = colon === -1 ? '' : cmd.slice(colon + 1).trim();
      const argsJson = rawToSchema(argsStr, toolSchemas.get(name));
      return {
        index: idx,
        id: `call_${Date.now()}_${idx}`,
        type: 'function',
        function: { name, arguments: argsJson },
      };
    });

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: null, tool_calls: toolCalls },
        finish_reason: 'tool_calls',
      }],
    };
  }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: aiResponse },
      finish_reason: 'stop',
    }],
  };
}

// ==================== 请求队列 ====================
let queue = Promise.resolve();
function enqueue(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// ==================== /v1/chat/completions ====================
app.post('/v1/chat/completions', async (req, res) => {
  const model = req.body.model || 'deepseek-web';
  const messages = req.body.messages || [];
  const tools = req.body.tools;
  const stream = !!req.body.stream;
  const providedSessionId = req.body.session_id || req.headers['x-session-id'];

  if (!messages.length) {
    return res.status(400).json({ error: 'messages is required' });
  }

  const prompt = messagesToPrompt(messages, tools);

  try {
    const { result, sessionId } = await enqueue(async () => {
      const b = await ensureBrowser();

      // 方向 2：恢复会话
      let sid = providedSessionId;
      if (sid && sessions.has(sid)) {
        const cid = sessions.get(sid);
        try {
          await navigateToConversation(cid);
        } catch (e) {
          logger.warn('[gateway] 恢复会话失败，将新建对话:', e.message);
          sid = null;
        }
      }

      const before = await b.getLastResponseText();
      const ok = await b.sendMessage(prompt);
      if (!ok) throw new Error('sendMessage failed');
      const reply = await b.waitForNewResponse(before);
      if (!reply) throw new Error('waitForNewResponse timeout');

      // 记录对话 ID
      const currentCid = getCurrentConversationId();
      if (currentCid) {
        if (!sid) {
          sid = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        sessions.set(sid, currentCid);
        logger.info(`[gateway] session ${sid} -> conv ${currentCid}`);
      }

      return { result: reply, sessionId: sid };
    });

    const response = parseResponseToOpenAI(result, model, tools);
    response.session_id = sessionId;

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-DeepSeek-Source', 'browser');
      if (sessionId) res.setHeader('X-Session-ID', sessionId);

      const msg = response.choices[0].message;
      let chunk;
      if (msg.tool_calls) {
        chunk = {
          id: response.id,
          object: 'chat.completion.chunk',
          created: response.created,
          model,
          choices: [{ index: 0, delta: { tool_calls: msg.tool_calls }, finish_reason: 'tool_calls' }],
        };
      } else {
        chunk = {
          id: response.id,
          object: 'chat.completion.chunk',
          created: response.created,
          model,
          choices: [{ index: 0, delta: { content: msg.content }, finish_reason: 'stop' }],
        };
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.setHeader('X-DeepSeek-Source', 'browser');
    if (sessionId) res.setHeader('X-Session-ID', sessionId);
    res.json(response);
  } catch (e) {
    logger.error('[gateway] request failed:', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [{ id: 'deepseek-web', object: 'model', owned_by: 'browser-web' }],
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    browser_ready: !!browser,
    sessions: sessions.size,
  });
});

const PORT = parseInt(process.env.API_GATEWAY_PORT || '8080', 10);
app.listen(PORT, '127.0.0.1', () => {
  logger.info(`[gateway] DeepSeek 网页版 API 网关启动: http://127.0.0.1:${PORT}`);
  logger.info(`[gateway] 方向1: Tool Calling 参数结构化 (raw→schema)`);
  logger.info(`[gateway] 方向2: 会话保持 (session_id)`);
});

process.on('SIGINT', async () => {
  logger.info('[gateway] SIGINT，关闭浏览器...');
  if (browser) {
    try { await browser.close(); } catch {}
  }
  process.exit(0);
});