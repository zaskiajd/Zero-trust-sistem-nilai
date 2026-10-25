'use strict';
// Service Nilai (port 3001). Resource: data kelas & nilai.
// Memverifikasi gateway secret + token sendiri, lalu memeriksa ulang kepemilikan/status/jam dari DATABASE.
const express = require('express');
const { loadConfig } = require('../shared/config');
const { openDb } = require('../shared/db');
const { isWithinAccessHours } = require('../shared/accesshours');
const { createVerifyGateway } = require('./middleware/verify-gateway');
const { createTranskripClient } = require('./lib/transkrip-client');

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const transkrip = createTranskripClient({ cfg });

const q = {
  user: db.prepare('SELECT id, username, role, nim, active FROM users WHERE id = ?'),
  listBase: `SELECT g.id, g.class_id AS kelas_id, c.kode_mk, c.nama_mk, s.nim, s.nama AS nama_mahasiswa,
                    g.nilai, g.is_final, g.updated_at
             FROM grades g
             JOIN classes c ON c.id = g.class_id
             JOIN users s ON s.id = g.student_id`,
  grade: db.prepare(
    `SELECT g.id, g.is_final, g.class_id, c.dosen_id FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.id = ?`
  ),
  updateGrade: db.prepare('UPDATE grades SET nilai = ?, updated_at = ? WHERE id = ? AND is_final = 0'),
  cls: db.prepare('SELECT id, kode_mk, dosen_id, sync_status FROM classes WHERE id = ?'),
  gradeStats: db.prepare('SELECT COUNT(*) AS total, SUM(nilai IS NULL) AS kosong FROM grades WHERE class_id = ?'),
  finalize: db.prepare('UPDATE grades SET is_final = 1, updated_at = ? WHERE class_id = ? AND is_final = 0'),
  setSync: db.prepare('UPDATE classes SET sync_status = ?, sync_message = ?, finalized_at = COALESCE(finalized_at, ?) WHERE id = ?'),
};

const app = express();
app.disable('x-powered-by');
app.use(createVerifyGateway({ cfg })); // 1) secret + 2) token, sebelum apa pun
app.use(express.json({ limit: '10kb' }));

// Memuat user dari DB; role diambil dari DB dan harus sama dengan role di token.
function requireUser(...roles) {
  return (req, res, next) => {
    if (req.auth.role === 'service') {
      return res.status(403).json({ error: 'forbidden', message: 'Token service tidak boleh dipakai pada endpoint ini' });
    }
    const user = q.user.get(Number(req.auth.sub));
    if (!user || !user.active) return res.status(401).json({ error: 'invalid_token', message: 'User tidak ditemukan' });
    if (user.role !== req.auth.role) return res.status(401).json({ error: 'invalid_token', message: 'Role token tidak sesuai database' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'forbidden', message: `Role ${user.role} tidak berhak` });
    req.user = user;
    next();
  };
}

function requireAccessHours(req, res, next) {
  const r = isWithinAccessHours(cfg.access);
  if (!r.ok) return res.status(403).json({ error: 'forbidden', message: `Di luar jam akses (${r.label})` });
  next();
}

const parseId = (s) => (/^\d{1,9}$/.test(s) ? Number(s) : null);

// GET /nilai  (mahasiswa: miliknya; dosen: kelas yang diampu)
app.get('/nilai', requireUser('mahasiswa', 'dosen'), (req, res) => {
  const where = [];
  const args = [];
  const { nim, kelas_id: kelasId } = req.query;
  if (typeof nim === 'string' || typeof kelasId === 'string') {
    // validasi sederhana tipe query
  } else if (nim !== undefined || kelasId !== undefined) {
    return res.status(400).json({ error: 'bad_request', message: 'Parameter query tidak valid' });
  }
  if (req.user.role === 'mahasiswa') {
    if (nim !== undefined && nim !== req.user.nim) return res.status(403).json({ error: 'forbidden', message: 'Mahasiswa hanya boleh melihat nilai sendiri' });
    where.push('g.student_id = ?'); args.push(req.user.id);
  } else {
    where.push('c.dosen_id = ?'); args.push(req.user.id); // hanya kelas yang diampu
    if (nim !== undefined) { where.push('s.nim = ?'); args.push(nim); }
  }
  if (kelasId !== undefined) {
    const id = parseId(kelasId);
    if (id === null) return res.status(400).json({ error: 'bad_request', message: 'kelas_id tidak valid' });
    where.push('g.class_id = ?'); args.push(id);
  }
  const rows = db.prepare(`${q.listBase} WHERE ${where.join(' AND ')} ORDER BY c.kode_mk, s.nim`).all(...args);
  res.json({ data: rows.map((r) => ({ ...r, is_final: !!r.is_final })) });
});

// PUT /nilai/:id  (dosen pengampu, belum final, dalam jam akses)
app.put('/nilai/:id', requireUser('dosen'), requireAccessHours, (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'bad_request', message: 'ID nilai tidak valid' });
  const nilai = req.body && req.body.nilai;
  if (typeof nilai !== 'number' || !Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
    return res.status(400).json({ error: 'bad_request', message: 'nilai wajib berupa angka 0-100' });
  }
  const g = q.grade.get(id);
  if (!g) return res.status(404).json({ error: 'not_found', message: 'Nilai tidak ditemukan' });
  if (g.dosen_id !== req.user.id) return res.status(403).json({ error: 'forbidden', message: 'Dosen bukan pengampu kelas ini' });
  if (g.is_final) return res.status(403).json({ error: 'forbidden', message: 'Nilai sudah final dan tidak dapat diubah' });
  // UPDATE ... AND is_final = 0 : tetap aman bila ada finalisasi bersamaan
  const info = q.updateGrade.run(nilai, new Date().toISOString(), id);
  if (info.changes === 0) return res.status(403).json({ error: 'forbidden', message: 'Nilai sudah final dan tidak dapat diubah' });
  res.json({ message: 'Nilai diperbarui', id, nilai });
});

// POST /kelas/:id/finalisasi  (dosen pengampu, dalam jam akses) lalu sinkron ke transkrip via gateway
app.post('/kelas/:id/finalisasi', requireUser('dosen'), requireAccessHours, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'bad_request', message: 'ID kelas tidak valid' });
  const cls = q.cls.get(id);
  if (!cls) return res.status(404).json({ error: 'not_found', message: 'Kelas tidak ditemukan' });
  if (cls.dosen_id !== req.user.id) return res.status(403).json({ error: 'forbidden', message: 'Dosen bukan pengampu kelas ini' });

  const stats = q.gradeStats.get(id);
  if (!stats.total) return res.status(409).json({ error: 'conflict', message: 'Kelas belum memiliki data nilai' });
  if (stats.kosong > 0) return res.status(409).json({ error: 'conflict', message: `Ada ${stats.kosong} nilai kosong; lengkapi sebelum finalisasi` });

  const now = new Date().toISOString();
  // Langkah 1: tandai final (idempoten; memanggil ulang = mencoba ulang sinkron yang gagal)
  db.transaction(() => {
    q.finalize.run(now, id);
    q.setSync.run('menunggu', null, now, id);
  })();

  // Langkah 2: sinkron ke transkrip MELALUI GATEWAY dengan token service
  try {
    const hasil = await transkrip.sinkronTranskrip(id);
    q.setSync.run('tersinkron', null, new Date().toISOString(), id);
    return res.json({ message: 'Kelas difinalisasi dan transkrip tersinkron', kelas_id: id, status_final: true, sinkron: { status: 'berhasil', jumlah: hasil && hasil.jumlah } });
  } catch (e) {
    // Tidak diam-diam: status final tetap tercatat, sinkron ditandai 'gagal' di DB, client diberi 502 + cara mengulang.
    q.setSync.run('gagal', String(e.message).slice(0, 200), new Date().toISOString(), id);
    console.error(`[nilai] sinkron kelas ${id} gagal: ${e.message}`);
    return res.status(502).json({
      error: 'sync_failed',
      message: 'Nilai sudah final, tetapi sinkronisasi ke transkrip GAGAL',
      kelas_id: id, status_final: true, sinkron: { status: 'gagal', detail: e.message },
      saran: `Ulangi POST /kelas/${id}/finalisasi untuk mencoba sinkron lagi (idempoten)`,
    });
  }
});

app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Endpoint tidak ditemukan' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('[nilai] error:', err.message);
  res.status(status).json({ error: status === 500 ? 'internal_error' : 'bad_request', message: status === 500 ? 'Kesalahan internal' : 'Request tidak valid' });
});

app.listen(cfg.ports.nilai, cfg.host, () => console.log(`[nilai] Service Nilai aktif di http://${cfg.host}:${cfg.ports.nilai}`));
