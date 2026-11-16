'use strict';

const axios = require('axios');

const DEFAULT_SERVICE = 'http://127.0.0.1:15722';
const DEFAULT_TIMEOUT_MS = 300000;

function getConfig(executor) {
  const c = (executor.config && executor.config.ai_assistant) || {};
  return {
    enabled: c.enabled !== false,
    serviceUrl: (c.service_url || DEFAULT_SERVICE).replace(/\/+$/, ''),
    defaultModel: c.default_model || '',
    timeoutMs: c.timeout_ms || DEFAULT_TIMEOUT_MS,
  };
}

function parseArgs(args) {
  const s = (args || '').trim();
  if (!s) return null;

  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s);
      return {
        task: obj.task || obj.prompt || obj.query || '',
        system: obj.system || obj.system_prompt || obj.role || '',
        session: obj.session || obj.session_id || 'default',
        model: obj.model || '',
        reset: !!obj.reset,
      };
    } catch (e) {
      return { error: `JSON 解析失败: ${e.message}` };
    }
  }

  if (s.includes('|||')) {
    const parts = s.split('|||');
    return { system: parts[0].trim(), task: parts.slice(1).join('|||').trim(), session: 'default' };
  }

  return { task: s, session: 'default' };
}

function formatResult(r) {
  if (!r.ok) return `Error: ${r.error}${r.raw ? '\n' + r.raw : ''}`;
  const parts = [`[子 AI: ${r.model}, ${r.elapsed}ms, session=${r.session}]`];
  if (r.toolCalls > 0) {
    parts.push(`[子 AI 调用了 ${r.toolCalls} 次工具]`);
    for (const t of (r.toolTrace || []).slice(0, 5)) {
      parts.push(`  · ${t.name}: ${t.preview.replace(/\n/g, ' ').slice(0, 80)}`);
    }
    if ((r.toolTrace || []).length > 5) parts.push(`  · ...还有 ${r.toolTrace.length - 5} 条`);
  }
  if (r.roundLimitHit) parts.push('[警告: 达到工具调用轮次上限，任务可能未完成]');
  parts.push('');
  parts.push(r.content || '(空)');
  if (r.reasoning) {
    parts.push('');
    parts.push('[子 AI 思考摘要]');
    parts.push(r.reasoning);
  }
  return parts.join('\n');
}

async function post(serviceUrl, path, body, timeoutMs) {
  return axios.post(`${serviceUrl}${path}`, body, {
    timeout: timeoutMs,
    validateStatus: () => true,
  });
}

function registerTools(executor) {
  executor.registerTool(
    'ask_ai',
    async (args) => {
      const cfg = getConfig(executor);
      if (!cfg.enabled) return 'Error: ai_assistant 已禁用';

      const parsed = parseArgs(args);
      if (!parsed) return 'Error: 用法 ask_ai:<任务> 或 ask_ai:<系统提示>|||<任务> 或 ask_ai:{"task":"..."}';
      if (parsed.error) return `Error: ${parsed.error}`;

      executor.logger?.info(
        `ask_ai: → ${cfg.serviceUrl} session=${parsed.session} model=${parsed.model || cfg.defaultModel || '(默认)'}`
      );

      const t0 = Date.now();
      try {
        const resp = await post(
          cfg.serviceUrl,
          '/chat',
          {
            task: parsed.task,
            system: parsed.system,
            session: parsed.session,
            model: parsed.model || cfg.defaultModel,
            reset: parsed.reset,
          },
          cfg.timeoutMs
        );

        if (resp.status !== 200) {
          return `Error: 子 AI 服务返回 HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 300)}`;
        }
        return formatResult(resp.data);
      } catch (e) {
        if (e.code === 'ECONNREFUSED') {
          return `Error: 子 AI 服务未启动（${cfg.serviceUrl}）。主 agent 会自动启动它，或手动运行 node ai-assistant.js`;
        }
        if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED') {
          return `Error: 子 AI 服务超时（${Date.now() - t0}ms），可在 config.yaml 中调大 ai_assistant.timeout_ms`;
        }
        return `Error: 调用子 AI 服务失败: ${e.message}`;
      }
    },
    '调用独立子 AI 服务（另一个进程，独立端口）完成子任务。支持多轮会话、工具调用。参数：<任务> / <系统提示>|||<任务> / JSON {task,system,session,model,reset}'
  );

  executor.registerTool(
    'ai_sessions',
    async () => {
      const cfg = getConfig(executor);
      try {
        const r = await axios.get(`${cfg.serviceUrl}/sessions`, { timeout: 5000 });
        const list = r.data?.sessions || [];
        if (!list.length) return '(没有会话)';
        return list.map(s => `${s.id}  messages=${s.messageCount}  updated=${s.updatedAt}`).join('\n');
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },
    '列出子 AI 的所有会话'
  );

  executor.registerTool(
    'ai_session_reset',
    async (id) => {
      const cfg = getConfig(executor);
      const sid = (id || 'default').trim();
      try {
        const r = await post(cfg.serviceUrl, '/session/reset', { session: sid }, 5000);
        return r.data?.ok ? `已重置: ${sid}` : `失败: ${JSON.stringify(r.data)}`;
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },
    '重置指定子 AI 会话（默认 default）'
  );

  executor.registerTool(
    'ai_service_status',
    async () => {
      const cfg = getConfig(executor);
      try {
        const r = await axios.get(`${cfg.serviceUrl}/health`, { timeout: 3000 });
        return `子 AI 服务在线\n${JSON.stringify(r.data, null, 2)}`;
      } catch (e) {
        return `子 AI 服务离线: ${e.message}`;
      }
    },
    '查询子 AI 服务健康状态'
  );
}

module.exports = { registerTools };