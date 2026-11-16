'use strict';

const cheerio = require('cheerio');

// 块级标签：前后加换行
const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'li', 'tr', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'pre', 'blockquote', 'article', 'section',
  'ul', 'ol', 'table', 'thead', 'tbody',
]);

// 需要完全移除的选择器（代码块头部按钮、图标等 UI 残留）
const REMOVE_SELECTORS = [
  '.md-code-block-banner-wrap',
  '.md-code-block-banner',
  '.ds-button',
  '.ds-icon',
  '.ds-focus-ring',
  '.ds-cross-fade',
  '.code-info-button-text',
  '[role="button"]',
  'button',
  'svg',
];

// 需要跳过的独立噪音行（代码块语言标识、复制、下载等）
const DS_TAG_RE = /<\/?ds_[a-z_]+\b[^>]*>/gi;
const NOISE_LINE_RE = /^(tool|copy|download|复制|下载|运行|run|powershell|text|bash|shell|json|yaml|yml|js|ts|jsx|tsx|html|css|python|py|c|cpp|java|go|rust|sql|xml|markdown|md|diff)$/i;

/**
 * 将 DeepSeek 回复容器的 innerHTML 转换为干净文本。
 *
 * 特点：
 *   - 保留文本节点原始缩进（用于传多行代码）
 *   - 块级元素自动补换行
 *   - 移除代码块头部的"复制/下载"按钮
 *   - 移除独立行的语言标识、UI 残留词
 */
function filterHtml(html) {
  if (!html || typeof html !== 'string') return '';

  let $;
  try {
    $ = cheerio.load(html, { decodeEntities: false });
  } catch {
    return '';
  }

  // 移除噪音元素
  for (const sel of REMOVE_SELECTORS) {
    try { $(sel).remove(); } catch {}
  }

  const root = $.root();
  let result = '';

  function walk(node) {
    if (node.type === 'text') {
      result += node.data || '';
      return;
    }
    if (node.type !== 'tag') return;

    const tag = (node.name || '').toLowerCase();

    if (tag === 'br') {
      result += '\n';
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);

    if (isBlock && result && !result.endsWith('\n')) {
      result += '\n';
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }

    if (isBlock && result && !result.endsWith('\n')) {
      result += '\n';
    }
  }

  const rootNodes = root[0] && root[0].children ? root[0].children : [];
  for (const child of rootNodes) {
    walk(child);
  }

  // 行级处理：过滤噪音行、合并连续空行、去除尾部空白
  const lines = result.split('\n');
  const outLines = [];
  let lastEmpty = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // 跳过噪音行
    if (NOISE_LINE_RE.test(trimmed)) continue;

    const isEmpty = trimmed === '';
    if (isEmpty && lastEmpty) continue;

    // 保留行首缩进，只去尾部空白
    outLines.push(rawLine.replace(/[ \t]+$/, ''));
    lastEmpty = isEmpty;
  }

  // 去首尾空行
  while (outLines.length && outLines[0].trim() === '') outLines.shift();
  while (outLines.length && outLines[outLines.length - 1].trim() === '') outLines.pop();

  return outLines.join('\n');
}

module.exports = { filterHtml, DS_TAG_RE };