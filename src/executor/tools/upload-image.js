'use strict';

const fs = require('fs');
const path = require('path');

function registerTools(executor) {
  executor.registerTool(
    'upload_image',
    async (filePath) => {
      const p = filePath.trim();
      if (!p) return 'Error: no file path provided';
      if (!fs.existsSync(p)) return `Error: file not found: ${p}`;
      const stat = fs.statSync(p);
      if (!stat.isFile()) return `Error: not a file: ${p}`;
      if (stat.size > 100 * 1024 * 1024) return 'Error: file exceeds 100MB limit';

      if (!executor._browser) return 'Error: browser not attached to executor';

      const ok = await executor._browser.uploadFile(p);
      if (ok) {
        const sizeKb = (stat.size / 1024).toFixed(1);
        return `File uploaded: ${path.basename(p)} (${sizeKb} KB). 现在你可以基于图片内容回答用户。`;
      }
      return 'Upload failed';
    },
    'Upload a file/image to DeepSeek for visual/contextual understanding'
  );
}

module.exports = { registerTools };