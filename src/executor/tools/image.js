'use strict';
const fs = require('fs');
const path = require('path');
let imageSize = null, QRCode = null;
try { imageSize = require('image-size'); } catch {}
try { QRCode = require('qrcode'); } catch {}

function imageInfo(p) {
  const s = (p || '').trim();
  if (!fs.existsSync(s)) return `Error: not found: ${s}`;
  if (!imageSize) return 'Error: image-size not installed';
  try {
    const dimensions = imageSize(s);
    return {
      width: dimensions.width,
      height: dimensions.height,
      type: dimensions.type,
      path: path.resolve(s)
    };
  } catch (e) { return `Image info failed: ${e.message}`; }
}

async function qrcodeGenerate(args) {
  if (!QRCode) return 'Error: qrcode not installed';
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: text|||path';
  const text = args.slice(0, i).trim();
  const file = args.slice(i + 3).trim() || `qrcode_${Date.now()}.png`;
  const abs = path.resolve(file);
  try {
    await QRCode.toFile(abs, text);
    return `QR code saved to ${abs}`;
  } catch (e) { return `QR code generation failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('image_info', imageInfo, 'Get image information');
  e.registerTool('qrcode_generate', qrcodeGenerate, 'Generate QR code (text|||path)');
  // Note: upload_image is handled by read_files automatically per INITIAL_PROMPT
}
module.exports = { registerTools };