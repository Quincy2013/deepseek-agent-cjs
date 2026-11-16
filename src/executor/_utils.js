'use strict';
const { exec } = require('child_process');

function run(command, args, options = {}) {
  const { timeout = 10000 } = options;
  return new Promise((resolve, reject) => {
    const cmd = [command, ...args].join(' ');
    exec(cmd, { timeout, maxBuffer: 1024 * 500 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ failed: true, stdout, stderr });
      } else {
        resolve({ failed: false, stdout, stderr });
      }
    });
  });
}

module.exports = { run };