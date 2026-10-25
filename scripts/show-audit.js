'use strict';
// Menampilkan audit log terbaru: npm run audit -- 30
const { loadConfig } = require('../shared/config');
const { openDb } = require('../shared/db');
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const n = Math.min(Number(process.argv[2]) || 20, 500);
const rows = db.prepare('SELECT id, timestamp, subject, method, endpoint, device_id, decision, status_code, reason FROM audit_logs ORDER BY id DESC LIMIT ?').all(n).reverse();
console.table(rows.map((r) => ({ id: r.id, waktu: r.timestamp, subjek: r.subject, req: `${r.method} ${r.endpoint}`, device: r.device_id, hasil: r.decision, http: r.status_code, alasan: r.reason })));
