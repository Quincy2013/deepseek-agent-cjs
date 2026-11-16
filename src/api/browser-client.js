'use strict';

const { parseToolCalls } = require('../parser');

class BrowserClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
  }

  async ensureReady() {
    if (this.browser) return;
    const { BrowserController } = require('../browser/browser-controller');
    this.logger.info('[browser-fallback] 启动浏览器...');
    this.browser = new BrowserController(this.config, this.logger);
    await this.browser.start();
    await this.browser.waitForLogin();
    this.logger.info('[browser-fallback] 浏览器就绪');
  }

  static toolsToPrompt(tools) {
    if (!tools || !tools.length) return '';
    const lines = ['【可用工具】'];
    for (const t of tools) {
      const fn = t.function || t;
      lines.push(`- ${fn.name}: ${fn.description || ''}`);
      if (fn.parameters?.properties) {
        const params = Object.keys(fn.parameters.properties).join(', ');
        if (params) lines.push(`  参数: ${params}`);
      }
    }
    lines.push('');
    lines.push('调用格式：[[TOOL:工具名:JSON参数]]');
    lines.push('多个调用用 ||| 分隔。');
    return lines.join('\n');
  }

  static commandsToToolCalls(commands) {
    return commands.map((cmd, idx) => {
      const colon = cmd.indexOf(':');
      let name, argsStr;
      if (colon === -1) {
        name = cmd.trim();
        argsStr = '{}';
      } else {
        name = cmd.slice(0, colon).trim();
        argsStr = cmd.slice(colon + 1).trim();
      }
      let argumentsJson = argsStr || '{}';
      try {
        JSON.parse(argumentsJson);
      } catch {
        argumentsJson = JSON.stringify({ raw: argsStr });
      }
      return {
        index: idx,
        id: `call_browser_${Date.now()}_${idx}`,
        type: 'function',
        function: { name, arguments: argumentsJson },
      };
    });
  }

  async chat(params) {
    await this.ensureReady();

    const messages = params.messages || [];
    const toolsPrompt = BrowserClient.toolsToPrompt(params.tools);

    const parts = [];
    if (toolsPrompt) parts.push(toolsPrompt);
    for (const m of messages) {
      parts.push(`[${m.role}]\n${m.content || ''}`);
    }
    const fullPrompt = parts.join('\n\n');

    const before = await this.browser.getLastResponseText();
    const ok = await this.browser.sendMessage(fullPrompt);
    if (!ok) throw new Error('Browser send failed');

    const reply = await this.browser.waitForNewResponse(before);
    if (!reply) throw new Error('Browser wait timeout');

    // 只识别 params.tools 中声明的工具名
    const declaredNames = new Set(
      (params.tools || []).map(t => (t.function || t).name)
    );
    const commands = declaredNames.size > 0
      ? parseToolCalls(reply, this.config, declaredNames)
      : [];

    if (commands.length) {
      const toolCalls = BrowserClient.commandsToToolCalls(commands);
      return {
        id: `chatcmpl-browser-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: params.model || 'deepseek-browser',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: toolCalls },
          finish_reason: 'tool_calls',
        }],
      };
    }

    return {
      id: `chatcmpl-browser-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: params.model || 'deepseek-browser',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: reply },
        finish_reason: 'stop',
      }],
    };
  }
}

module.exports = { BrowserClient };