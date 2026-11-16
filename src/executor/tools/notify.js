'use strict';
const notifier = require('node-notifier');
const path = require('path');

async function notify(args) {
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: title|||message';
  const title = args.slice(0, i).trim();
  const message = args.slice(i + 3).trim();
  try {
    await new Promise((resolve, reject) => {
      notifier.notify({ title, message, icon: path.join(__dirname, '../../assets/icon.png') }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return 'Notification sent';
  } catch (e) { return `Notify failed: ${e.message}`; }
}

function registerTools(e) {
  e.registerTool('notify', notify, 'Send desktop notification');
}
module.exports = { registerTools };