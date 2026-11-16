'use strict';

function currentTime() {
  const now = new Date();
  return {
    timestamp: now.getTime(),
    datetime: now.toISOString(),
    time: now.toTimeString(),
    date: now.toDateString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: -now.getTimezoneOffset(),
  };
}

function timestampConvert(args) {
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: format|||timestamp';
  const format = args.slice(0, i).trim();
  const tsStr = args.slice(i + 3).trim();

  let timestamp;
  if (/^\d+$/.test(tsStr)) {
    // Unix timestamp (seconds or milliseconds)
    const num = parseInt(tsStr, 10);
    timestamp = num > 10000000000 ? num : num * 1000; // Assume ms if > 2001-09-09
  } else {
    // Parse as date string
    timestamp = Date.parse(tsStr);
    if (isNaN(timestamp)) return `Error: invalid timestamp '${tsStr}'`;
  }

  const date = new Date(timestamp);

  switch (format.toLowerCase()) {
    case 'unix':
      return Math.floor(timestamp / 1000).toString();
    case 'unixms':
      return timestamp.toString();
    case 'iso':
      return date.toISOString();
    case 'locale':
      return date.toLocaleString();
    case 'utc':
      return date.toUTCString();
    case 'date':
      return date.toDateString();
    case 'time':
      return date.toTimeString();
    case 'year':
      return date.getFullYear().toString();
    case 'month':
      return (date.getMonth() + 1).toString();
    case 'day':
      return date.getDate().toString();
    case 'hour':
      return date.getHours().toString();
    case 'minute':
      return date.getMinutes().toString();
    case 'second':
      return date.getSeconds().toString();
    case 'weekday':
      return date.toLocaleString('default', { weekday: 'long' });
    default:
      return `Error: unsupported format '${format}'`;
  }
}

function registerTools(e) {
  e.registerTool('current_time', () => currentTime(), 'Get current time');
  e.registerTool('timestamp_convert', timestampConvert, 'Convert timestamp (format|||timestamp)');
}
module.exports = { registerTools };