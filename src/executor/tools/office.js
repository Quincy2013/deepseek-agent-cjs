'use strict';
const fs = require('fs');
const path = require('path');
let ExcelJS = null, pdfParse = null, mammoth = null, AdmZip = null;
try { ExcelJS = require('exceljs'); } catch {}
try { pdfParse = require('pdf-parse'); } catch {}
try { mammoth = require('mammoth'); } catch {}
try { AdmZip = require('adm-zip'); } catch {}

async function readExcel(p) {
  if (!ExcelJS) return 'Error: exceljs not installed';
  const f = (p || '').trim();
  if (!fs.existsSync(f)) return `Error: not found: ${f}`;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(f);
    const out = [];
    for (const ws of wb.worksheets) {
      out.push(`=== Sheet: ${ws.name} (${ws.rowCount} x ${ws.columnCount}) ===`);
      for (let r = 1; r <= Math.min(ws.rowCount, 100); r++) {
        const cells = [];
        for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
          const v = ws.getRow(r).getCell(c).value;
          cells.push(v == null ? '' : String(v));
        }
        out.push(cells.join('\t'));
      }
    }
    return out.join('\n');
  } catch (e) { return `Read Excel failed: ${e.message}`; }
}

async function writeExcel(args) {
  if (!ExcelJS) return 'Error: exceljs not installed';
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: path|||json';
  const p = args.slice(0, i).trim();
  let data;
  try { data = JSON.parse(args.slice(i + 3).trim()); } catch { return 'Error: invalid JSON'; }
  if (!Array.isArray(data)) return 'Error: not array';
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    for (const row of data) ws.addRow(Array.isArray(row) ? row : [row]);
    await wb.xlsx.writeFile(p);
    return `Written ${data.length} rows to ${path.resolve(p)}`;
  } catch (e) { return `Write Excel failed: ${e.message}`; }
}

async function readPdf(p) {
  if (!pdfParse) return 'Error: pdf-parse not installed';
  const f = (p || '').trim();
  if (!fs.existsSync(f)) return `Error: not found: ${f}`;
  try {
    const data = await pdfParse(fs.readFileSync(f));
    return { pages: data.numpages, text: data.text.slice(0, 8000), truncated: data.text.length > 8000 };
  } catch (e) { return `Read PDF failed: ${e.message}`; }
}

async function readDocx(p) {
  if (!mammoth) return 'Error: mammoth not installed';
  const f = (p || '').trim();
  if (!fs.existsSync(f)) return `Error: not found: ${f}`;
  try {
    const r = await mammoth.extractRawText({ path: f });
    return r.value.slice(0, 8000);
  } catch (e) { return `Read DOCX failed: ${e.message}`; }
}

async function readPptx(p) {
  if (!AdmZip) return 'Error: adm-zip not installed';
  const f = (p || '').trim();
  if (!fs.existsSync(f)) return `Error: not found: ${f}`;
  try {
    const zip = new AdmZip(f);
    const entries = zip.getEntries().filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName));
    entries.sort((a, b) => {
      const na = parseInt(a.entryName.match(/slide(\d+)/)[1], 10);
      const nb = parseInt(b.entryName.match(/slide(\d+)/)[1], 10);
      return na - nb;
    });
    const slides = [];
    for (const entry of entries) {
      const xml = entry.getData().toString('utf8');
      const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      const slideNum = entry.entryName.match(/slide(\d+)/)[1];
      slides.push(`=== Slide ${slideNum} ===\n${texts.join('\n')}`);
    }
    return slides.length ? slides.join('\n\n') : '(no slides found)';
  } catch (e) { return `Read PPTX failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('read_excel', readExcel, 'Read Excel (xlsx)');
  e.registerTool('write_excel', writeExcel, 'Write Excel (path|||json)');
  e.registerTool('read_pdf', readPdf, 'Read PDF');
  e.registerTool('read_docx', readDocx, 'Read Word (docx)');
  e.registerTool('read_pptx', readPptx, 'Read PowerPoint (pptx)');
}
module.exports = { registerTools };