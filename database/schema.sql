-- Schema database bersama (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nim           TEXT UNIQUE,              -- hanya untuk mahasiswa
  nama          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,        -- SHA-256 dari token; token asli tidak disimpan
  device_id  TEXT NOT NULL,               -- device saat login
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT                         -- NULL = belum dicabut
);

CREATE TABLE IF NOT EXISTS classes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_mk       TEXT NOT NULL UNIQUE,
  nama_mk       TEXT NOT NULL,
  dosen_id      INTEGER NOT NULL REFERENCES users(id),
  finalized_at  TEXT,
  -- status sinkron ke transkrip: belum | menunggu | tersinkron | gagal
  sync_status   TEXT NOT NULL DEFAULT 'belum' CHECK (sync_status IN ('belum','menunggu','tersinkron','gagal')),
  sync_message  TEXT
);

CREATE TABLE IF NOT EXISTS enrollments (
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS grades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  nilai      REAL CHECK (nilai IS NULL OR (nilai >= 0 AND nilai <= 100)),
  is_final   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS transcripts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  nilai      REAL NOT NULL,
  synced_at  TEXT NOT NULL,
  UNIQUE (student_id, class_id)           -- sinkron berulang tidak menduplikasi
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL,
  subject     TEXT NOT NULL,              -- user:<username> | service:<client_id> | anonymous
  method      TEXT,
  endpoint    TEXT NOT NULL,
  device_id   TEXT,
  decision    TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  reason      TEXT NOT NULL,
  request_id  TEXT,
  status_code INTEGER                     -- status HTTP akhir ke client (diisi saat respons selesai)
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp);
