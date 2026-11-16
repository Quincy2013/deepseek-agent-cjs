'use strict';

const fs = require('fs');

class SessionManager {
  constructor(filepath = 'session_history.json') {
    this.filepath = filepath;
    this.history = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filepath)) {
        this.history = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
      }
    } catch {
      this.history = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(
        this.filepath,
        JSON.stringify(this.history, null, 2),
        'utf8'
      );
    } catch {}
  }

  addMessage(role, content) {
    this.history.push({ role, content, timestamp: Date.now() / 1000 });
    this.save();
  }

  getRecent(n = 10) {
    return this.history.slice(-n);
  }

  clear() {
    this.history = [];
    this.save();
  }

  exportMarkdown(outputPath) {
    let md = '';
    for (const msg of this.history) {
      const t = new Date(msg.timestamp * 1000).toLocaleString('zh-CN');
      md += `**${msg.role}** (${t}):\n${msg.content}\n\n`;
    }
    fs.writeFileSync(outputPath, md, 'utf8');
  }
}

module.exports = { SessionManager };