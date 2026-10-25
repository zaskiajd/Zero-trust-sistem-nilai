'use strict';
// Membuat ulang database: schema + seed. PERINGATAN: menghapus file database lama.
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../shared/config');
const { openDb } = require('../shared/db');
const { hashPassword } = require('../shared/password');

// Password praktikum (BUKAN password sungguhan). Didokumentasikan di README.
const LAB_PASSWORD = 'Praktikum#2026';

async function main() {
  const cfg = loadConfig();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(cfg.dbPath + suffix)) fs.unlinkSync(cfg.dbPath + suffix);
  }
  const db = openDb(cfg.dbPath, { mustExist: false });
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  const now = new Date().toISOString();
  const pw = await hashPassword(LAB_PASSWORD);

  const insUser = db.prepare('INSERT INTO users (username,password_hash,role,nim,nama) VALUES (?,?,?,?,?)');
  const insDev = db.prepare('INSERT INTO devices (user_id,device_id) VALUES (?,?)');
  const users = [
    ['admin', 'admin', null, 'Administrator Prodi', 'DEV-ADMIN-01'],
    ['dosen1', 'dosen', null, 'Dr. Budi Santoso', 'DEV-DOSEN-01'],
    ['dosen2', 'dosen', null, 'Sari Wulandari, M.Kom.', 'DEV-DOSEN-02'],
    ['mhs1', 'mahasiswa', '2210001', 'Andi Pratama', 'DEV-MHS-01'],
    ['mhs2', 'mahasiswa', '2210002', 'Bunga Lestari', 'DEV-MHS-02'],
    ['mhs3', 'mahasiswa', '2210003', 'Citra Dewi', 'DEV-MHS-03'],
  ];
  const id = {};
  const tx = db.transaction(() => {
    for (const [username, role, nim, nama, dev] of users) {
      id[username] = insUser.run(username, pw, role, nim, nama).lastInsertRowid;
      insDev.run(id[username], dev);
    }
    // 2 kelas, diampu dosen berbeda
    const insClass = db.prepare('INSERT INTO classes (kode_mk,nama_mk,dosen_id) VALUES (?,?,?)');
    const c1 = insClass.run('IF301', 'Keamanan Informasi', id.dosen1).lastInsertRowid;
    const c2 = insClass.run('IF302', 'Basis Data Lanjut', id.dosen2).lastInsertRowid;

    const insEnr = db.prepare('INSERT INTO enrollments (class_id,student_id) VALUES (?,?)');
    const insGrade = db.prepare('INSERT INTO grades (class_id,student_id,nilai,is_final,updated_at) VALUES (?,?,?,0,?)');
    const enroll = [
      [c1, 'mhs1', 85], [c1, 'mhs2', 78], [c1, 'mhs3', 90],
      [c2, 'mhs1', 80], [c2, 'mhs2', 88], [c2, 'mhs3', 72],
    ];
    for (const [c, mhs, nilai] of enroll) {
      insEnr.run(c, id[mhs]);
      insGrade.run(c, id[mhs], nilai, now);
    }
  });
  tx();
  db.close();
  console.log(`Database dibuat: ${cfg.dbPath}`);
  console.log('Seed: 1 admin, 2 dosen, 3 mahasiswa, 2 kelas, 6 device, 6 nilai.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
