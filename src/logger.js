'use strict';

const fs = require('fs');
const path = require('path');

let fileStream = null;
let enabled = true;

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.` +
    String(d.getMilliseconds()).padStart(3, '0')
  );
}

function fmtArg(a) {
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function write(level, color, args) {
  if (!enabled) return;
  const line = `[${ts()}] ${level}: ` + args.map(fmtArg).join(' ') + '\n';

  if (process.stdout.isTTY) {
    process.stdout.write(
      `${COLORS.gray}[${ts()}]${COLORS.reset} ${color}${level}${COLORS.reset}: ` +
      args.map(fmtArg).join(' ') + '\n'
    );
  } else {
    process.stdout.write(line);
  }

  if (fileStream) {
    try { fileStream.write(line); } catch {}
  }
}

const logger = {
  info:  (...a) => write('INFO',  COLORS.cyan,    a),
  warn:  (...a) => write('WARN',  COLORS.yellow,  a),
  error: (...a) => write('ERROR', COLORS.red,     a),
  debug: (...a) => write('DEBUG', COLORS.magenta, a),
  raw: (text) => {
    process.stdout.write(text);
    if (fileStream) { try { fileStream.write(text); } catch {} }
  },
};

function setupLogger(logFile = 'app.log') {
  try {
    const abs = path.resolve(logFile);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fileStream = fs.createWriteStream(abs, { flags: 'a' });
  } catch (e) {
    process.stderr.write(`logger init failed: ${e.message}\n`);
  }
  return logger;
}

function getLogger() { return logger; }
function setEnabled(v) { enabled = !!v; }

module.exports = { setupLogger, getLogger, setEnabled, logger };