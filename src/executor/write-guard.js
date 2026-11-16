'use strict';

const path = require('path');

const WRITE_TOOLS = new Set([
  'write_file', 'write_files', 'edit_file', 'create_dir',
  'copy_file', 'move_file', 'delete_file',
  'zip_files', 'unzip_file',
]);

// 每类工具从参数里提取"写入目标路径"
function extractWritePath(toolName, args) {
  const a = String(args || '');
  const idx = a.indexOf('|||');
  const first = idx === -1 ? a.trim() : a.slice(0, idx).trim();
  const second = idx === -1 ? '' : a.slice(idx + 3).trim();

  switch (toolName) {
    case 'write_file':
    case 'write_files':
    case 'edit_file':
    case 'create_dir':
    case 'delete_file':
      return first;
    case 'copy_file':
    case 'move_file':
      return second;
    case 'zip_files':
    case 'unzip_file':
      return first;
    default:
      return '';
  }
}

function normalizeDir(p) {
  try {
    const abs = path.resolve(p);
    return path.dirname(abs) + path.sep;
  } catch {
    return '';
  }
}

function matchesPrefix(targetPath, prefix) {
  const t = path.resolve(targetPath).toLowerCase();
  const p = path.resolve(prefix).toLowerCase();
  return t === p || t.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

class WriteGuard {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    const sec = config.security || {};
    this.denyPaths = (sec.write_deny_paths || []).map(p => path.resolve(p));
    this.allowPaths = (sec.write_allow_paths || []).map(p => path.resolve(p));
    this.mode = sec.write_confirm_mode || 'new-dir'; // new-dir | always | never

    // 会话内状态
    this.sessionAllowedDirs = new Set();
    this.sessionDeniedDirs = new Set();
    this.sessionSkipAll = false;
  }

  // 对话命令用
  setMode(m) {
    if (!['new-dir', 'always', 'never'].includes(m)) {
      return `无效模式: ${m}（可选 new-dir | always | never）`;
    }
    this.mode = m;
    return `写入确认模式已切换为: ${m}`;
  }

  allowDir(dir) {
    const abs = path.resolve(dir);
    this.sessionAllowedDirs.add(abs.endsWith(path.sep) ? abs : abs + path.sep);
    return `已放行目录: ${abs}`;
  }

  denyDir(dir) {
    const abs = path.resolve(dir);
    this.sessionDeniedDirs.add(abs.endsWith(path.sep) ? abs : abs + path.sep);
    return `已拉黑目录: ${abs}`;
  }

  status() {
    const lines = [
      `模式: ${this.mode}`,
      `跳过所有确认: ${this.sessionSkipAll}`,
      `会话放行目录: ${this.sessionAllowedDirs.size ? [...this.sessionAllowedDirs].join(', ') : '(无)'}`,
      `会话拉黑目录: ${this.sessionDeniedDirs.size ? [...this.sessionDeniedDirs].join(', ') : '(无)'}`,
      `配置黑名单: ${this.denyPaths.length ? this.denyPaths.join(', ') : '(无)'}`,
      `配置白名单: ${this.allowPaths.length ? this.allowPaths.join(', ') : '(无)'}`,
    ];
    return lines.join('\n');
  }

  /**
   * 检查是否允许写入。
   * @returns {Promise<{allowed: boolean, reason?: string}>}
   */
  async check(toolName, args, ask) {
    if (!WRITE_TOOLS.has(toolName)) {
      return { allowed: true };
    }

    const rawPath = extractWritePath(toolName, args);
    if (!rawPath) {
      return { allowed: true }; // 无法提取路径，放行（交给工具自己报错）
    }

    const targetDir = normalizeDir(rawPath);
    if (!targetDir) {
      return { allowed: true };
    }

    // 1. 配置黑名单（硬限制，不可绕过）
    for (const deny of this.denyPaths) {
      if (matchesPrefix(rawPath, deny)) {
        return { allowed: false, reason: `路径在禁止列表中: ${deny}` };
      }
    }

    // 2. 会话黑名单
    for (const deny of this.sessionDeniedDirs) {
      if (matchesPrefix(rawPath, deny)) {
        return { allowed: false, reason: `路径已被会话拉黑: ${deny}` };
      }
    }

    // 3. 跳过所有确认
    if (this.sessionSkipAll) return { allowed: true };

    // 4. 模式 never
    if (this.mode === 'never') return { allowed: true };

    // 5. 配置白名单
    for (const allow of this.allowPaths) {
      if (matchesPrefix(rawPath, allow)) return { allowed: true };
    }

    // 6. 会话放行目录
    for (const allow of this.sessionAllowedDirs) {
      if (matchesPrefix(rawPath, allow)) return { allowed: true };
    }

    // 7. 模式 always：每次都问
    if (this.mode === 'always') {
      return await this.promptUser(toolName, rawPath, targetDir, ask);
    }

    // 8. 模式 new-dir：只在首次进入该目录时问
    return await this.promptUser(toolName, rawPath, targetDir, ask);
  }

  async promptUser(toolName, rawPath, targetDir, ask) {
    console.log('');
    console.log('\x1b[33m[写入确认]\x1b[0m ' + toolName + ' → ' + rawPath);
    console.log('  目标目录: ' + targetDir);
    console.log('  y = 允许本次');
    console.log('  a = 允许该目录（本次会话，不再问这个目录）');
    console.log('  n = 拒绝本次');
    console.log('  A = 本次会话不再询问任何目录（等于临时 --no-write-confirm）');
    console.log('  N = 拉黑该目录（本次会话，后续直接拒绝）');

    let ans = '';
    try {
      ans = (await ask('选择 (y/a/n/A/N): ')).trim();
    } catch {
      return { allowed: false, reason: '确认输入失败' };
    }

    switch (ans) {
      case 'y':
        return { allowed: true };
      case 'a':
        this.sessionAllowedDirs.add(targetDir);
        return { allowed: true };
      case 'A':
        this.sessionSkipAll = true;
        return { allowed: true };
      case 'N':
        this.sessionDeniedDirs.add(targetDir);
        return { allowed: false, reason: `路径已被会话拉黑: ${targetDir}` };
      case 'n':
      default:
        return { allowed: false, reason: '用户拒绝写入' };
    }
  }
}

module.exports = { WriteGuard, WRITE_TOOLS, extractWritePath };