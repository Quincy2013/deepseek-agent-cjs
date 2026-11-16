'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function diskInfo() {
  try {
    const stats = fs.statfsSync(os.tmpdir());
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = total - free;
    return {
      total: total,
      totalGB: Number((total / 1073741824).toFixed(2)),
      free: free,
      freeGB: Number((free / 1073741824).toFixed(2)),
      used: used,
      usedGB: Number((used / 1073741824).toFixed(2)),
      usagePercent: Number(((used / total) * 100).toFixed(2)),
    };
  } catch (e) {
    // Fallback for platforms without statfsSync
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total: total,
      totalGB: Number((total / 1073741824).toFixed(2)),
      free: free,
      freeGB: Number((free / 1073741824).toFixed(2)),
      used: used,
      usedGB: Number((used / 1073741824).toFixed(2)),
      usagePercent: Number(((used / total) * 100).toFixed(2)),
      note: 'Using memory stats as fallback',
    };
  }
}

function registerTools(e) {
  e.registerTool('disk_info', diskInfo, 'Get disk information');
}
module.exports = { registerTools };