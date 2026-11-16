'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULTS = {
  chat_url: 'https://chat.deepseek.com/',
  user_data_dir: 'browser_data',
  chromium_executable_path: '',
  log_file: 'app.log',
  selectors: {
    message_input: "textarea[name='search']",
    send_button: "div[role='button'].ds-button--primary.ds-button--circle:has(svg path[d^='M8.3125']):not(.ds-button--disabled)",
    stop_button: "div[role='button'].ds-button--primary.ds-button--circle:has(svg path[d^='M2 4.88'])",
    ai_response: 'div.ds-markdown.ds-assistant-message-main-content',
    file_input: "input[type='file']",
  },
  stop_button_fallbacks: [
    "div[role='button'][aria-label*='停止']",
    "button[aria-label*='停止']",
    "div[role='button'][aria-label*='stop' i]",
  ],
  timeouts: { login: 300000, ai_response: 120000, tool_exec: 60, upload_wait: 30000 },
  tool_command_format: {
    prefix: '[[TOOL:',
    suffix: ']]',
    code_block_start: '```tool\n',
    code_block_end: '\n```',
    multi_tool_separator: '|||',
  },
  ui_noise_lines: ['tool', 'copy', 'download', '复制', '下载'],
  security: {
    allow_shell: true,
    allow_python: true,
    command_whitelist: [],
    high_risk_patterns: ["rm -rf", "mkfs", "format", "shutdown", "reboot"],
    high_risk_tools: ["delete_file", "kill_process", "set_wallpaper"]
  },
  limits: { tool_result_max_chars: 8000 },
  custom_tools: [],
};

function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base !== 'object' || typeof override !== 'object') return override;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    if (key in base) out[key] = deepMerge(base[key], override[key]);
    else out[key] = override[key];
  }
  return out;
}

function loadConfig(configPath = 'config.yaml') {
  const abs = path.resolve(configPath);
  if (!fs.existsSync(abs)) throw new Error(`Config not found: ${abs}`);
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) || {};
  return deepMerge(DEFAULTS, parsed);
}

module.exports = { loadConfig, DEFAULTS };