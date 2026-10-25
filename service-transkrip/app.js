'use strict';
// Service Transkrip (port 3002). Resource: data transkrip mahasiswa.
const express = require('express');
const { loadConfig } = require('../shared/config');
const { openDb } = require('../shared/db');
const { createVerifyGateway } = require('./middleware/verify-gateway');

const cfg = loadConfig();
const db = openDb(cfg.dbPath);

const NIM_RE = /^[A-Za-z0-9]{1,20}$/;
const q = {
  user: db.prepare('SELECT id, username, role, nim, active FROM users WHERE id = ?'),
  student: db.prepare("SELECT id, nim, nama FROM users WHERE nim = ? AND role = 'mahasiswa' AND active = 1"),
  transcript: db.prepare(
    `SELECT c.kode_mk, c.nama_mk, t.nilai, t.synced_at
     FROM transcripts t JOIN classes c ON c.id = t.class_id
     WHERE t.student_id = ? ORDER BY c.kode_mk`
  ),
  cls: db.prepare('SELECT id FROM classes WHERE id = ?'),
  finalGrades: db.prepare('SELECT student_id, nilai FROM grades WHERE class_id = ? AND is_final = 1 AND nilai IS NOT NULL'),
  upsert: db.prepare(
    `INSERT INTO transcripts (student_id, class_id, nilai, synced_at) VALUES (?,?,?,?)
     ON CONFLICT(student_id, class_id) DO UPDATE SET nilai = excluded.nilai, synced_at = excluded.synced_at`
  ),
};

const app = express();
app.disable('x-powered-by');
app.use(createVerifyGateway({ cfg })); // secret + token dulu
app.use(express.json({ limit: '10kb' }));

// GET /transkrip/:nim  (mahasiswa: NIM sendiri; admin: semua). Kepemilikan dicek dari DB.
app.get('/transkrip/:nim', (req, res) => {
  if (req.auth.role === 'service') {
    return res.status(403).json({ error: 'forbidden', message: 'Token service tidak boleh membaca transkrip' });
  }
  const user = q.user.get(Number(req.auth.sub));
  if (!user || !user.active) return res.status(401).json({ error: 'invalid_token', message: 'User tidak ditemukan' });
  if (user.role !== req.auth.role) return res.status(401).json({ error: 'invalid_token', message: 'Role token tidak sesuai database' });

  const nim = req.params.nim;
  if (!NIM_RE.test(nim)) return res.status(400).json({ error: 'bad_request', message: 'NIM tidak valid' });
  if (user.role === 'mahasiswa') {
    if (user.nim !== nim) return res.status(403).json({ error: 'forbidden', message: 'Mahasiswa hanya boleh melihat transkrip NIM sendiri' });
  } else if (user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: `Role ${user.role} tidak berhak melihat transkrip` });
  }
  const mhs = q.student.get(nim);
  if (!mhs) return res.status(404).json({ error: 'not_found', message: 'Mahasiswa tidak ditemukan' });
  res.json({ nim: mhs.nim, nama: mhs.nama, transkrip: q.transcript.all(mhs.id) });
});

// POST /transkrip/sinkron  (HANYA token service)
app.post('/transkrip/sinkron', (req, res) => {
  if (req.auth.role !== 'service' || req.auth.sub !== cfg.service.clientId) {
    return res.status(403).json({ error: 'forbidden', message: 'Hanya token service yang diizinkan (token user ditolak)' });
  }
  const kelasId = req.body && req.body.kelas_id;
  if (!Number.isInteger(kelasId) || kelasId <= 0) {
    return res.status(400).json({ error: 'bad_request', message: 'kelas_id wajib berupa bilangan bulat positif' });
  }
  if (!q.cls.get(kelasId)) return res.status(404).json({ error: 'not_found', message: 'Kelas tidak ditemukan' });

  // Sumber kebenaran = nilai FINAL di database, bukan data kiriman pemanggil.
  const grades = q.finalGrades.all(kelasId);
  if (grades.length === 0) return res.status(409).json({ error: 'conflict', message: 'Kelas belum memiliki nilai final' });

  const now = new Date().toISOString();
  db.transaction(() => { for (const g of grades) q.upsert.run(g.student_id, kelasId, g.nilai, now); })();
  res.json({ message: 'Sinkronisasi berhasil', kelas_id: kelasId, jumlah: grades.length });
});

app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Endpoint tidak ditemukan' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('[transkrip] error:', err.message);
  res.status(status).json({ error: status === 500 ? 'internal_error' : 'bad_request', message: status === 500 ? 'Kesalahan internal' : 'Request tidak valid' });
});

app.listen(cfg.ports.transkrip, cfg.host, () => console.log(`[transkrip] Service Transkrip aktif di http://${cfg.host}:${cfg.ports.transkrip}`));
