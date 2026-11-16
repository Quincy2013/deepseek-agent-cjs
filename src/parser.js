'use strict';

const LANG_NOISE_RE = /^(powershell|text|bash|shell|json|yaml|yml|js|ts|jsx|tsx|html|css|python|py|c|cpp|java|go|rust|sql|xml|markdown|md|diff)$/i;
const TOOL_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*(?:@\d+)?)\s*:\s*([\s\S]*)$/;
const TOOL_NAME_PREFIX_RE = /^工具名\s*[:：]\s*/;
const XML_TAG_RE = /<\/?(?:tool|tool_call|tool_name|tool_result|command|function_call|invoke|parameter|ds_[a-z_]+)\b[^>]*>/gi;
const ARG_NOISE_LINE_RE = /^(tool|copy|download|复制|下载|运行|run|powershell|text|bash|shell|json|yaml|yml|js|ts|jsx|tsx|html|css|python|py|c|cpp|java|go|rust|sql|xml|markdown|md|diff)$/i;

const NARRATIVE_SUFFIX_RE = /\s*(?:→|->|—|——|=>)\s*[^\n]*$/;
const FULLWIDTH_TRAIL_RE = /[，。；：、！？（）【】「」『』]+\s*$/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNoiseLine(line, noiseSet) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (noiseSet.has(lower)) return true;
  if (LANG_NOISE_RE.test(trimmed)) return true;
  if (lower === '运行' || lower === 'run') return true;
  return false;
}

function preprocessText(text) {
  return String(text || '').split('\n').map((line) => {
    const m = line.match(/^(\s*)工具名\s*[:：]\s*(.*)$/);
    if (m) {
      const indent = m[1];
      const rest = m[2].trim();
      if (rest && !rest.includes(':') && !rest.includes('：')) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(rest)) {
          return indent + rest + ':';
        }
      }
      return indent + rest;
    }
    return line;
  }).join('\n');
}

function stripNonToolCodeBlocks(text) {
  return String(text || '').replace(
    /```([a-zA-Z0-9_+\-]*)\n([\s\S]*?)```/g,
    (match, lang) => {
      const l = (lang || '').toLowerCase();
      if (l === 'tool') return match;
      return '';
    }
  );
}

function looksLikeNarrative(args) {
  const a = String(args || '').trim();
  if (!a) return false;
  if (a.length === 1 && !/[A-Za-z0-9\\/\-.]/.test(a)) return true;
  if (/[。！？、]/.test(a)) return true;
  if (/^["'\/\\]/.test(a)) return false;
  if (/^[A-Za-z]:[\\\/]/.test(a)) return false;
  if (a.includes('|||')) return false;
  if (/^[{[]/.test(a)) return false;
  if (/^[A-Za-z0-9_\-\/\.]+\s+[A-Za-z]/.test(a)) return false;
  const cnCount = (a.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (cnCount > 0 && cnCount / a.length > 0.7 && a.length > 8) return true;
  if (/(完毕|不一致|被吞|的现象|的问题|的原因|的根因|的修复|可靠|不稳定|严格|过严|优先级|建议|如下|前述|吗|呢)$/.test(a)) {
    return true;
  }
  return false;
}

function cleanArgs(raw) {
  let s = String(raw || '');
  s = s.replace(NARRATIVE_SUFFIX_RE, '');
  s = s.replace(FULLWIDTH_TRAIL_RE, '');
  return s;
}

/**
 * 严格提取工具调用：
 *  - 工具名必须在 known 里（精确匹配，不接受未知）
 *  - 行首必须是工具名，无前缀（拒绝 "Error: xxx"、"- xxx"、"1. xxx"）
 *  - 支持 toolName@seconds
 */
function extractToolFromLine(line, known) {
  let s = String(line || '').trim();
  if (!s) return null;
  s = s.replace(TOOL_NAME_PREFIX_RE, '').trim();
  if (!s) return null;

  const m = s.match(TOOL_LINE_RE);
  if (!m) return null;

  const toolName = m[1];
  const args = m[2];
  const baseName = toolName.replace(/@\d+$/, '').toLowerCase();

  // ★ 严格模式：必须精确匹配 known 里的工具
  if (known.size > 0 && !known.has(baseName)) {
    return null;
  }

  // 未提供 known 时（旧调用），保留基本校验
  if (known.size === 0) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(baseName) || baseName.length < 2) return null;
    if (baseName === baseName.toUpperCase() && baseName.length <= 4) return null;
  }

  return { toolName, args };
}

function stripArgNoiseLines(args) {
  const lines = String(args || '').split('\n');
  while (lines.length && ARG_NOISE_LINE_RE.test(lines[0].trim())) lines.shift();
  while (lines.length && ARG_NOISE_LINE_RE.test(lines[lines.length - 1].trim())) lines.pop();
  return lines.join('\n');
}

/**
 * 解析优先级：
 *   1. <|tool_call|>...<|/tool_call|>   显式边界标记
 *   2. ```tool ... ```                  代码块（可含多行内容）
 *   3. [[TOOL:...]]                     方括号
 *   4. 行首严格扫描（工具名必须在 known 里）
 */
function parseToolCalls(text, config, toolNames) {
  const fmt = config.tool_command_format || {};
  const prefix = fmt.prefix || '[[TOOL:';
  const suffix = fmt.suffix || ']]';
  const codeStart = fmt.code_block_start || '```tool\n';
  const codeEnd = fmt.code_block_end || '\n```';

  const known = toolNames instanceof Set ? toolNames : new Set(toolNames || []);
  const noise = new Set((config.ui_noise_lines || []).map((s) => s.toLowerCase()));

  const calls = [];
  let working = String(text || '').replace(/：/g, ':');
  working = preprocessText(working);
  working = stripNonToolCodeBlocks(working);

  // 长回复只扫尾部
  const MAX_SCAN_CHARS = 8000;
  if (working.length > MAX_SCAN_CHARS) {
    const tailStart = working.length - MAX_SCAN_CHARS;
    let sliceFrom = tailStart;
    const markers = ['<|tool_call|>', '```tool', '[[TOOL:'];
    for (const m of markers) {
      const idx = working.indexOf(m, tailStart);
      if (idx !== -1 && idx < sliceFrom + 500) sliceFrom = Math.min(sliceFrom, idx);
    }
    const nlIdx = working.lastIndexOf('\n', sliceFrom);
    if (nlIdx !== -1) sliceFrom = nlIdx + 1;
    working = working.slice(sliceFrom);
  }

  // ========== 阶段 0：<|tool_call|>...<|/tool_call|>（最高优先级） ==========
  working = working.replace(/<\|tool_call\|>([\s\S]*?)<\|tool_call\|>/gi, (_, inner) => {
    const cleaned = inner.replace(XML_TAG_RE, '').trim();
    // 内部按行严格扫描
    for (const line of cleaned.split('\n')) {
      const extracted = extractToolFromLine(line, known);
      if (extracted && !looksLikeNarrative(extracted.args)) {
        calls.push(`${extracted.toolName}:${cleanArgs(extracted.args)}`);
      }
    }
    return '';
  });

  // ========== 阶段 0.5：<|tool_call|>...<|/tool_call|>（闭合标记） ==========
  working = working.replace(/<\|tool_call\|>([\s\S]*?)<\|tool_call\|>/gi, (_, inner) => {
    for (const line of inner.split('\n')) {
      const extracted = extractToolFromLine(line, known);
      if (extracted && !looksLikeNarrative(extracted.args)) {
        calls.push(`${extracted.toolName}:${cleanArgs(extracted.args)}`);
      }
    }
    return '';
  });

  // ========== 阶段 1：<tool_call>...</tool_call> ==========
  working = working.replace(/<tool_call>([\s\S]*?)<\/tool_call>/gi, (_, inner) => {
    for (const line of inner.split('\n')) {
      const extracted = extractToolFromLine(line, known);
      if (extracted && !looksLikeNarrative(extracted.args)) {
        calls.push(`${extracted.toolName}:${cleanArgs(extracted.args)}`);
      }
    }
    return '';
  });

  // ========== 阶段 2：<tool_name>X</tool_name><command>Y</command> ==========
  working = working.replace(
    /<tool_name>\s*([A-Za-z_][A-Za-z0-9_]*)\s*<\/tool_name>\s*<command>([\s\S]*?)<\/command>/gi,
    (_, name, cmd) => {
      const args = cmd.trim();
      if (args && !looksLikeNarrative(args) && (known.size === 0 || known.has(name.toLowerCase()))) {
        calls.push(`${name}:${cleanArgs(args)}`);
      }
      return '';
    }
  );
  working = working.replace(/<tool_name>\s*[A-Za-z_][A-Za-z0-9_]*\s*<\/tool_name>/gi, '');

  // ========== 阶段 3：```tool 代码块（多行内容安全） ==========
  if (codeStart && codeEnd) {
    const reCode = new RegExp(escapeRegExp(codeStart) + '([\\s\\S]*?)' + escapeRegExp(codeEnd), 'g');
    working = working.replace(reCode, (_, inner) => {
      // 代码块整体作为单次调用处理，不按行拆分
      const cleaned = inner.replace(XML_TAG_RE, '').trim();
      if (!cleaned) return '';

      const firstNl = cleaned.indexOf('\n');
      const firstLine = firstNl === -1 ? cleaned : cleaned.slice(0, firstNl).trim();
      const restContent = firstNl === -1 ? '' : cleaned.slice(firstNl + 1);

      const m = firstLine.match(TOOL_LINE_RE);
      if (!m) {
        // 整个块内容可能是 "工具名:\n内容"，尝试解析第一行后内容
        return '';
      }
      const toolName = m[1];
      const baseName = toolName.replace(/@\d+$/, '').toLowerCase();
      if (known.size > 0 && !known.has(baseName)) return '';

      let args = m[2];
      if (restContent) {
        args = args ? args + '\n' + restContent : restContent;
      }
      args = stripArgNoiseLines(args).replace(/\s+$/, '');
      if (looksLikeNarrative(args)) return '';

      calls.push(`${toolName}:${args}`);
      return '';
    });
  }

  // ========== 阶段 4：[[TOOL:...]] ==========
  const reBracket = new RegExp(escapeRegExp(prefix) + '([\\s\\S]*?)' + escapeRegExp(suffix), 'g');
  working = working.replace(reBracket, (_, inner) => {
    const cleaned = inner.replace(XML_TAG_RE, '').trim();
    if (cleaned) {
      const extracted = extractToolFromLine(cleaned, known);
      if (extracted && !looksLikeNarrative(extracted.args)) {
        calls.push(`${extracted.toolName}:${cleanArgs(extracted.args)}`);
      }
    }
    return '';
  });

  // ========== 阶段 5：行首严格扫描（必须独占一行 + 白名单） ==========
  const lines = working.split('\n');
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || isNoiseLine(trimmed, noise)) { i++; continue; }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) { i++; continue; }

    // ★ 严格：行首必须是工具名，无前缀（拒绝 "Error: xxx"、"- xxx"、"1. xxx"）
    if (rawLine !== trimmed) { i++; continue; }  // 行首有缩进，可能是示例代码

    const extracted = extractToolFromLine(trimmed, known);
    if (!extracted) { i++; continue; }

    // 单行调用，不支持跨行（多行必须用代码块）
    if (looksLikeNarrative(extracted.args)) { i++; continue; }

    const args = cleanArgs(extracted.args).replace(/\s+$/, '');
    calls.push(`${extracted.toolName}:${args}`);
    i++;
  }

  const MAX_CALLS = 8;
  if (calls.length > MAX_CALLS) return calls.slice(-MAX_CALLS);
  return calls.filter(Boolean);
}

function cleanUiNoise(text, config) {
  const noise = new Set((config.ui_noise_lines || []).map((s) => s.toLowerCase()));
  const lines = String(text || '').split('\n');
  const out = [];
  for (const rawLine of lines) {
    if (isNoiseLine(rawLine, noise)) continue;
    out.push(rawLine);
  }
  const merged = [];
  let lastEmpty = false;
  for (const l of out) {
    const isEmpty = l.trim() === '';
    if (isEmpty && lastEmpty) continue;
    merged.push(l);
    lastEmpty = isEmpty;
  }
  return merged.join('\n').trim();
}

function cleanForStreaming(text, config) {
  const noise = new Set((config.ui_noise_lines || []).map((s) => s.toLowerCase()));
  const cleaned = String(text || '').replace(XML_TAG_RE, '');
  const lastNl = cleaned.lastIndexOf('\n');
  if (lastNl === -1) return '';
  const lines = cleaned.slice(0, lastNl + 1).split('\n');
  lines.pop();
  let result = '';
  let lastEmpty = false;
  for (const line of lines) {
    if (isNoiseLine(line, noise)) continue;
    const isEmpty = line.trim() === '';
    if (isEmpty && lastEmpty) continue;
    result += line + '\n';
    lastEmpty = isEmpty;
  }
  return result;
}

module.exports = { parseToolCalls, cleanUiNoise, cleanForStreaming };