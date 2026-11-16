'use strict';
const path = require('path');
let Database = null;
try { Database = require('better-sqlite3'); } catch {}

function sqliteQuery(args) {
  if (!Database) return 'Error: better-sqlite3 not installed';
  const i = args.indexOf('|||');
  if (i === -1) return 'Error: db_path|||sql';
  const db = args.slice(0, i).trim();
  const sql = args.slice(i + 3).trim();
  let conn;
  try {
    conn = new Database(path.resolve(db));
    const stmt = conn.prepare(sql);
    if (stmt.reader) {
      const rows = stmt.all();
      return rows.length ? rows.slice(0, 100).map((r) => JSON.stringify(r)).join('\n') : '(no rows)';
    }
    const info = stmt.run();
    return `affected: ${info.changes}`;
  } catch (e) { return `SQLite failed: ${e.message}`; }
  finally { if (conn) try { conn.close(); } catch {} }
}

function registerTools(e) {
  e.registerTool('sqlite_query', sqliteQuery, 'SQLite (db|||sql)');
}
module.exports = { registerTools };