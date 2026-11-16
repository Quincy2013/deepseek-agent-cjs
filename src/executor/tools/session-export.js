'use strict';
const fs = require('fs');
const path = require('path');
let PDFDocument = null;
try { PDFDocument = require('pdfkit'); } catch {}

async function exportSession(args) {
  const i = args.indexOf('|||');
  const format = (i === -1 ? 'md' : args.slice(0, i)).trim().toLowerCase();
  const file = i === -1 ? args : args.slice(i + 3).trim();
  if (!file) return 'Error: specify filename';
  const abs = path.resolve(file);
  try {
    const session = require('../../session/session-manager');
    const messages = session.getRecent(1000); // Get all messages
    if (format === 'pdf') {
      if (!PDFDocument) return 'Error: pdfkit not installed';
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(abs);
      doc.pipe(stream);
      doc.fontSize(12);
      for (const msg of messages) {
        doc.text(`${msg.role.toUpperCase()}: ${msg.content}`, { continued: false });
        doc.moveDown(0.5);
      }
      doc.end();
      return `Session exported to ${abs}`;
    } else {
      // Default to markdown
      let md = '# Session Export\n\n';
      for (const msg of messages) {
        md += `**${msg.role.toUpperCase()}**:  \n${msg.content}\n\n`;
      }
      fs.writeFileSync(abs, md, 'utf8');
      return `Session exported to ${abs}`;
    }
  } catch (e) {
    return `Export failed: ${e.message}`;
  }
}

function registerTools(e) {
  e.registerTool('export_session', exportSession, 'Export session (format|||filename)');
}
module.exports = { registerTools };