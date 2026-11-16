'use strict';
const fs = require('fs');
const path = require('path');
let AdmZip = null;
try { AdmZip = require('adm-zip'); } catch {}

function zipFiles(args) {
  if (!AdmZip) return 'Error: adm-zip not installed';
  const parts = args.split('|||');
  if (parts.length < 2) return 'Error: output|||p1;p2';
  const out = parts[0].trim();
  const inputs = parts[1].split(';').map((s) => s.trim()).filter(Boolean);
  try {
    const zip = new AdmZip();
    for (const p of inputs) {
      if (!fs.existsSync(p)) return `Error: not found: ${p}`;
      const st = fs.statSync(p);
      if (st.isDirectory()) zip.addLocalFolder(p, path.basename(p));
      else zip.addLocalFile(p);
    }
    zip.writeZip(out);
    return `Compressed to ${path.resolve(out)}`;
  } catch (e) { return `Compression failed: ${e.message}`; }
}

function unzipFile(args) {
  if (!AdmZip) return 'Error: adm-zip not installed';
  const parts = args.split('|||');
  const archive = parts[0].trim();
  const dir = parts[1]?.trim() || path.dirname(archive) || '.';
  try {
    if (!fs.existsSync(archive)) return `Error: not found: ${archive}`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    new AdmZip(archive).extractAllTo(dir, true);
    return `Extracted to ${path.resolve(dir)}`;
  } catch (e) { return `Extraction failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('zip_files', zipFiles, 'Zip (output|||p1;p2)');
  e.registerTool('unzip_file', unzipFile, 'Unzip (archive|||dir)');
}
module.exports = { registerTools };