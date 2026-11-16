'use strict';

const fs = require('fs');
const path = require('path');

const toolsDir = path.join(__dirname, 'src', 'executor', 'tools');

function checkTools() {
  const SKIP_FILES = new Set(['_utils.js']);

  const files = fs.readdirSync(toolsDir);
  const failed = [];
  const info = (msg) => console.log(`[info] ${msg}`);

  for (const file of files) {
    if (SKIP_FILES.has(file) || file.startsWith('_')) {
      info(`跳过辅助文件: ${file}`);
      continue;
    }
    const full = path.join(toolsDir, file);
    try {
      const mod = require(full);
      if (typeof mod.registerTools !== 'function') {
        failed.push({ file, err: '缺少 registerTools 导出' });
        continue;
      }
      info(`✓ ${file}: 注册函数存在`);
    } catch (e) {
      failed.push({ file, err: `加载失败: ${e.message}` });
    }
  }

  if (failed.length) {
    console.error('\n❌ 检测失败:');
    for (const { file, err } of failed) {
      console.error(`  - ${file}: ${err}`);
    }
    return false;
  } else {
    console.log('\n✅ 所有工具文件检查通过');
    return true;
  }
}

// If run directly, execute the check
if (require.main === module) {
  checkTools();
}

module.exports = { checkTools };