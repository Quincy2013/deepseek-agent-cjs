'use strict';

const { execa } = require('execa');

async function run(cmd, args = [], opts = {}) {
  const options = {
    windowsHide: true,
    reject: false,
    timeout: opts.timeout || 30000,
    encoding: opts.encoding || 'utf8',
    ...opts,
  };

  const result = await execa(cmd, args, options);

  if (result.timedOut) {
    throw new Error(`timeout: ${cmd} (${options.timeout}ms)`);
  }
  if (result.exitCode !== 0 && !options.reject) {
    // 返回统一格式：{ stdout, stderr, exitCode }，让调用者自己判断
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode,
      failed: true,
    };
  }
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: 0,
    failed: false,
  };
}

async function runOrThrow(cmd, args = [], opts = {}) {
  const r = await run(cmd, args, opts);
  if (r.failed) throw new Error(r.stderr || `${cmd} exited with code ${r.exitCode}`);
  return r.stdout;
}

module.exports = { run, runOrThrow };