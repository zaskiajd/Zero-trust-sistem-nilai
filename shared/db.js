'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Satu database bersama untuk gateway, Service Nilai, dan Service Transkrip.
function openDb(dbPath, { mustExist = true } = {}) {
  if (mustExist && !fs.existsSync(dbPath)) {
    throw new Error(`Database tidak ditemukan di ${dbPath}. Jalankan "npm run db:init" dahulu.`);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // tiga proses menulis ke file yang sama
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { openDb };
