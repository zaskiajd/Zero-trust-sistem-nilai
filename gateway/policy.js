'use strict';
// Policy Engine (PE): memutuskan allow/deny berdasarkan Tabel 3 soal.
// Atribut kepemilikan (kelas yang diampu, status final, NIM) dibaca dari DATABASE, bukan hanya token.
// Default: deny.
const { isWithinAccessHours } = require('../shared/accesshours');

const ID_RE = /^\d{1,9}$/;
const NIM_RE = /^[A-Za-z0-9]{1,20}$/;

function createPolicy({ db, cfg, now = () => new Date() }) {
  const q = {
    classById: db.prepare('SELECT id, dosen_id FROM classes WHERE id = ?'),
    gradeById: db.prepare(
      `SELECT g.id, g.is_final, c.dosen_id FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.id = ?`
    ),
  };

  const allow = (reason) => ({ allow: true, reason });
  const deny = (reason, status = 403) => ({ allow: false, reason, status });
  const hoursViolation = () => {
    const r = isWithinAccessHours(cfg.access, now());
    return r.ok ? null : `Di luar jam akses perubahan/finalisasi (${r.label})`;
  };
  const optStr = (v) => (v === undefined ? undefined : typeof v === 'string' ? v : null); // null = tipe tidak valid

  const rules = [
    // GET /nilai : mahasiswa (milik sendiri), dosen (kelas yang diampu)
    {
      method: 'GET', re: /^\/nilai\/?$/,
      check(p, _m, query) {
        const nim = optStr(query.nim);
        const kelasId = optStr(query.kelas_id);
        if (nim === null || kelasId === null) return deny('Parameter query tidak valid', 400);
        if (p.role === 'mahasiswa') {
          if (nim !== undefined && nim !== p.nim) return deny('Mahasiswa hanya boleh melihat nilai miliknya sendiri');
          return allow('Mahasiswa melihat nilai miliknya sendiri');
        }
        if (p.role === 'dosen') {
          if (kelasId !== undefined) {
            if (!ID_RE.test(kelasId)) return deny('kelas_id tidak valid', 400);
            const cls = q.classById.get(Number(kelasId));
            if (!cls) return deny('Kelas tidak ditemukan', 404);
            if (cls.dosen_id !== p.id) return deny('Dosen bukan pengampu kelas ini');
          }
          return allow('Dosen melihat nilai pada kelas yang diampu');
        }
        return deny(`Role ${p.role} tidak berhak melihat /nilai`);
      },
    },
    // PUT /nilai/:id : dosen pengampu, belum final, dalam jam akses
    {
      method: 'PUT', re: /^\/nilai\/(\d{1,9})\/?$/,
      check(p, m) {
        if (p.role !== 'dosen') return deny(`Role ${p.role} tidak berhak mengubah nilai`);
        const g = q.gradeById.get(Number(m[1]));
        if (!g) return deny('Nilai tidak ditemukan', 404);
        if (g.dosen_id !== p.id) return deny('Dosen bukan pengampu kelas ini');
        if (g.is_final) return deny('Nilai sudah final dan tidak dapat diubah');
        const h = hoursViolation();
        if (h) return deny(h);
        return allow('Dosen pengampu, nilai belum final, dalam jam akses');
      },
    },
    // POST /kelas/:id/finalisasi : dosen pengampu, dalam jam akses
    {
      method: 'POST', re: /^\/kelas\/(\d{1,9})\/finalisasi\/?$/,
      check(p, m) {
        if (p.role !== 'dosen') return deny(`Role ${p.role} tidak berhak memfinalisasi kelas`);
        const cls = q.classById.get(Number(m[1]));
        if (!cls) return deny('Kelas tidak ditemukan', 404);
        if (cls.dosen_id !== p.id) return deny('Dosen bukan pengampu kelas ini');
        const h = hoursViolation();
        if (h) return deny(h);
        return allow('Dosen pengampu kelas, dalam jam akses');
      },
    },
    // GET /transkrip/:nim : mahasiswa (NIM sendiri), admin (semua)
    {
      method: 'GET', re: /^\/transkrip\/([^/]+)\/?$/,
      check(p, m) {
        const nim = decodeURIComponentSafe(m[1]);
        if (nim === null || !NIM_RE.test(nim)) return deny('NIM tidak valid', 400);
        if (p.role === 'admin') return allow('Admin melihat transkrip seluruh mahasiswa');
        if (p.role === 'mahasiswa') {
          if (p.nim !== nim) return deny('Mahasiswa hanya boleh melihat transkrip NIM sendiri');
          return allow('Mahasiswa melihat transkrip NIM sendiri');
        }
        return deny(`Role ${p.role} tidak berhak melihat transkrip`);
      },
    },
    // POST /transkrip/sinkron : hanya token service
    {
      method: 'POST', re: /^\/transkrip\/sinkron\/?$/,
      check(p) {
        if (p.type !== 'service' || p.role !== 'service') return deny('Sinkronisasi transkrip hanya menerima token service (token user ditolak)');
        return allow('Token service valid untuk sinkronisasi transkrip');
      },
    },
  ];

  function decodeURIComponentSafe(s) {
    try { return decodeURIComponent(s); } catch { return null; }
  }

  function decide(principal, { method, path, query }) {
    const rule = rules.find((r) => r.method === method && r.re.test(path));
    if (!rule) return deny('Tidak ada kebijakan untuk endpoint/metode ini (default deny)');
    return rule.check(principal, path.match(rule.re), query || {});
  }

  return { decide };
}

module.exports = { createPolicy };
