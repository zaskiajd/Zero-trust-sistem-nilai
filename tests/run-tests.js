'use strict';
// Pengujian otomatis end-to-end. Menjalankan gateway + 2 service nyata dengan database sementara,
// lalu menembak API lewat HTTP dan mencatat hasil AKTUAL ke tests/hasil-pengujian.md.
// Jalankan: npm test   (port 3000-3002 harus kosong; hentikan "npm start" dahulu)
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { loadConfig } = require('../shared/config');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(__dirname, 'tmp');
const DB_FILE = path.join(TMP, 'test.db');
const PASSWORD = 'Praktikum#2026';
const base = loadConfig(); // hanya untuk membaca secret/port dari .env
const GW = `http://127.0.0.1:${base.ports.gateway}`;
const NILAI = `http://127.0.0.1:${base.ports.nilai}`;
const TRANSKRIP = `http://127.0.0.1:${base.ports.transkrip}`;
const DEV = { admin: 'DEV-ADMIN-01', dosen1: 'DEV-DOSEN-01', dosen2: 'DEV-DOSEN-02', mhs1: 'DEV-MHS-01', mhs2: 'DEV-MHS-02', mhs3: 'DEV-MHS-03' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- proses ----------
const procs = {};
const SERVICES = { transkrip: 'service-transkrip/app.js', nilai: 'service-nilai/app.js', gateway: 'gateway/app.js' };
const PORTS = { transkrip: base.ports.transkrip, nilai: base.ports.nilai, gateway: base.ports.gateway };
let envOverride = {};

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}
async function waitPort(port, up = true) {
  for (let i = 0; i < 80; i++) { if ((await portOpen(port)) === up) return; await sleep(100); }
  throw new Error(`Port ${port} tidak ${up ? 'terbuka' : 'tertutup'}`);
}
async function startSvc(name) {
  const p = spawn(process.execPath, [path.join(ROOT, SERVICES[name])], {
    cwd: ROOT, env: { ...process.env, DB_PATH: DB_FILE, ...envOverride }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('exit', (c) => { if (c && procs[name] === p) console.error(`[uji] ${name} berhenti tak terduga: ${err.slice(0, 300)}`); });
  procs[name] = p;
  await waitPort(PORTS[name], true);
}
async function stopSvc(name) {
  const p = procs[name];
  if (!p) return;
  delete procs[name];
  p.kill();
  await waitPort(PORTS[name], false);
}
async function startAll(env = {}) { envOverride = env; for (const n of ['transkrip', 'nilai', 'gateway']) await startSvc(n); }
async function stopAll() { for (const n of ['gateway', 'nilai', 'transkrip']) await stopSvc(n); }
process.on('exit', () => Object.values(procs).forEach((p) => p.kill()));

// ---------- HTTP ----------
async function http(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, json };
}
const gw = (p, { token, device, ...rest } = {}) => http(GW + p, {
  ...rest,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(device ? { 'X-Device-ID': device } : {}), ...(rest.headers || {}) },
});
const login = async (u, device = DEV[u]) => {
  const r = await gw('/auth/login', { method: 'POST', device, body: { username: u, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${u} gagal: ${r.status}`);
  return { access: r.json.access_token, refresh: r.json.refresh_token, dev: device };
};
const as = (s) => ({ token: s.access, device: s.dev });
const msg = (r) => `HTTP ${r.status}${r.json && (r.json.message || r.json.error) ? ` - ${r.json.message || r.json.error}` : ''}`;

// ---------- pencatatan hasil ----------
const results = [];
async function t(no, tujuan, request, harapan, fn) {
  let pass = false; let aktual;
  try { [pass, aktual] = await fn(); } catch (e) { aktual = `Exception: ${e.message}`; }
  results.push({ no, tujuan, request, harapan, aktual, status: pass ? 'LULUS' : 'GAGAL' });
  console.log(`${pass ? 'LULUS' : 'GAGAL'}  ${no}  ${tujuan}  =>  ${aktual}`);
}
const forge = (claims, secret, opts = {}) => jwt.sign(claims, secret, { algorithm: 'HS256', issuer: base.token.issuer, ...opts });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const hourLabel = (h) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
const currentHour = (tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

// ---------- main ----------
async function main() {
  for (const p of Object.values(PORTS)) {
    if (await portOpen(p)) { console.error(`Port ${p} sedang dipakai. Hentikan aplikasi yang berjalan (npm start) lalu ulangi.`); process.exit(2); }
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const init = spawnSync(process.execPath, [path.join(ROOT, 'database/init.js')], { cwd: ROOT, env: { ...process.env, DB_PATH: DB_FILE }, encoding: 'utf8' });
  if (init.status !== 0) { console.error(init.stderr || init.stdout); process.exit(2); }
  const db = new Database(DB_FILE);
  db.pragma('busy_timeout = 5000');
  const uid = (u) => db.prepare('SELECT id FROM users WHERE username=?').get(u).id;
  const gradeId = (cls, mhs) => db.prepare('SELECT id FROM grades WHERE class_id=? AND student_id=?').get(cls, uid(mhs)).id;
  const nim = (u) => db.prepare('SELECT nim FROM users WHERE username=?').get(u).nim;

  // ===== FASE A: jam akses dibuka seharian =====
  console.log('\n== FASE A: jam akses 00:00-24:00 ==');
  await startAll({ ACCESS_HOURS_START: '00:00', ACCESS_HOURS_END: '24:00' });

  await t('1', 'Login valid + device terdaftar menerbitkan access & refresh token', 'POST /auth/login (mhs1, X-Device-ID: DEV-MHS-01)', '200; access token JWT 10 menit berisi sub & role; refresh token 1 hari tersimpan di DB (sebagai hash)', async () => {
    const r = await gw('/auth/login', { method: 'POST', device: DEV.mhs1, body: { username: 'mhs1', password: PASSWORD } });
    const c = r.json && r.json.access_token ? jwt.decode(r.json.access_token) : {};
    const row = db.prepare('SELECT created_at, expires_at, token_hash FROM refresh_tokens ORDER BY id DESC LIMIT 1').get();
    const dayMs = new Date(row.expires_at) - new Date(row.created_at);
    const ok = r.status === 200 && c.exp - c.iat === 600 && c.sub === String(uid('mhs1')) && c.role === 'mahasiswa' && dayMs === 86400000 && row.token_hash !== r.json.refresh_token;
    return [ok, `${msg(r)}; exp-iat=${c.exp - c.iat}s, sub=${c.sub}, role=${c.role}; refresh berlaku ${dayMs / 3600000} jam, disimpan sebagai hash`];
  });
  const mhs1 = await login('mhs1'); const mhs2 = await login('mhs2');
  const dosen1 = await login('dosen1'); const dosen2 = await login('dosen2'); const admin = await login('admin');

  await t('2', 'Login password salah ditolak', 'POST /auth/login (password salah)', '401', async () => {
    const r = await gw('/auth/login', { method: 'POST', device: DEV.mhs1, body: { username: 'mhs1', password: 'salah' } });
    return [r.status === 401, msg(r)];
  });
  await t('2b', 'Login user tidak ada ditolak (pesan sama, tidak membocorkan user)', 'POST /auth/login (user tidak ada)', '401', async () => {
    const r = await gw('/auth/login', { method: 'POST', device: DEV.mhs1, body: { username: 'hantu', password: PASSWORD } });
    return [r.status === 401, msg(r)];
  });
  await t('3a', 'Login dari device tidak terdaftar ditolak', 'POST /auth/login (kredensial benar, X-Device-ID: DEV-TIDAK-ADA)', '403', async () => {
    const r = await gw('/auth/login', { method: 'POST', device: 'DEV-TIDAK-ADA', body: { username: 'mhs1', password: PASSWORD } });
    return [r.status === 403, msg(r)];
  });
  await t('3b', 'Device milik user lain ditolak saat login', 'POST /auth/login (mhs1 memakai DEV-MHS-02)', '403', async () => {
    const r = await gw('/auth/login', { method: 'POST', device: DEV.mhs2, body: { username: 'mhs1', password: PASSWORD } });
    return [r.status === 403, msg(r)];
  });
  await t('3c', 'Request terlindungi dari device tidak terdaftar ditolak', 'GET /nilai (token mhs1 valid, X-Device-ID: DEV-TIDAK-ADA)', '403', async () => {
    const r = await gw('/nilai', { token: mhs1.access, device: 'DEV-TIDAK-ADA' });
    return [r.status === 403, msg(r)];
  });
  await t('3d', 'Device milik user lain ditolak pada request terlindungi', 'GET /nilai (token mhs1, X-Device-ID: DEV-MHS-02)', '403', async () => {
    const r = await gw('/nilai', { token: mhs1.access, device: DEV.mhs2 });
    return [r.status === 403, msg(r)];
  });
  await t('3e', 'Request tanpa header X-Device-ID ditolak', 'GET /nilai (token valid, tanpa X-Device-ID)', '403', async () => {
    const r = await gw('/nilai', { token: mhs1.access });
    return [r.status === 403, msg(r)];
  });
  await t('4', 'Request terlindungi tanpa access token ditolak', 'GET /nilai (tanpa Authorization)', '401', async () => {
    const r = await gw('/nilai', { device: DEV.mhs1 });
    return [r.status === 401, msg(r)];
  });
  await t('5a', 'Access token kedaluwarsa ditolak', 'GET /nilai (JWT exp 10 detik lalu, ditandatangani benar)', '401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const tok = forge({ role: 'mahasiswa', iat: now - 700, exp: now - 10 }, base.jwtSecret, { subject: String(uid('mhs1')) });
    const r = await gw('/nilai', { token: tok, device: DEV.mhs1 });
    return [r.status === 401, msg(r)];
  });
  await t('5b', 'Token dengan tanda tangan salah ditolak', 'GET /nilai (JWT ditandatangani secret lain)', '401', async () => {
    const tok = forge({ role: 'admin' }, 'secret-palsu-secret-palsu-1234', { subject: String(uid('admin')), expiresIn: '10m' });
    const r = await gw('/nilai', { token: tok, device: DEV.admin });
    return [r.status === 401, msg(r)];
  });
  await t('5c', 'Token alg=none ditolak', 'GET /nilai (JWT tanpa tanda tangan)', '401', async () => {
    const tok = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: String(uid('admin')), role: 'admin', iss: base.token.issuer, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    const r = await gw('/nilai', { token: tok, device: DEV.admin });
    return [r.status === 401, msg(r)];
  });
  await t('5d', 'Role di token tidak cocok database ditolak', 'GET /nilai (token valid ditandatangani benar, sub=mhs1 tetapi role=dosen)', '401', async () => {
    const tok = forge({ role: 'dosen' }, base.jwtSecret, { subject: String(uid('mhs1')), expiresIn: '10m' });
    const r = await gw('/nilai', { token: tok, device: DEV.mhs1 });
    return [r.status === 401, msg(r)];
  });

  await t('6', 'Refresh token valid menerbitkan access token baru', 'POST /auth/refresh {refresh_token}', '200 + access token baru yang dapat dipakai', async () => {
    const fresh = await login('mhs3');
    const r = await gw('/auth/refresh', { method: 'POST', body: { refresh_token: fresh.refresh } });
    const use = r.json && r.json.access_token ? await gw('/nilai', { token: r.json.access_token, device: DEV.mhs3 }) : { status: 0 };
    return [r.status === 200 && use.status === 200, `refresh ${msg(r)}; pemakaian token baru: HTTP ${use.status}`];
  });
  await t('7', 'Refresh token yang sudah logout/dicabut ditolak', 'POST /auth/logout lalu POST /auth/refresh dengan token yang sama', 'logout 200, refresh 401, logout ulang 401, kolom revoked_at terisi', async () => {
    const s = await login('mhs3');
    const out = await gw('/auth/logout', { method: 'POST', body: { refresh_token: s.refresh } });
    const ref = await gw('/auth/refresh', { method: 'POST', body: { refresh_token: s.refresh } });
    const out2 = await gw('/auth/logout', { method: 'POST', body: { refresh_token: s.refresh } });
    const revoked = db.prepare('SELECT COUNT(*) n FROM refresh_tokens WHERE revoked_at IS NOT NULL').get().n;
    return [out.status === 200 && ref.status === 401 && out2.status === 401 && revoked >= 1, `logout ${out.status}, refresh ${msg(ref)}, logout ulang ${out2.status}, baris revoked_at terisi=${revoked}`];
  });
  await t('7b', 'Refresh token kedaluwarsa ditolak', 'POST /auth/refresh (expires_at di DB dimundurkan)', '401', async () => {
    const s = await login('mhs3');
    db.prepare('UPDATE refresh_tokens SET expires_at=? WHERE id=(SELECT MAX(id) FROM refresh_tokens WHERE user_id=?)').run(new Date(Date.now() - 1000).toISOString(), uid('mhs3'));
    const r = await gw('/auth/refresh', { method: 'POST', body: { refresh_token: s.refresh } });
    return [r.status === 401, msg(r)];
  });
  await t('7c', 'Refresh token palsu ditolak', 'POST /auth/refresh {refresh_token: "acak"}', '401', async () => {
    const r = await gw('/auth/refresh', { method: 'POST', body: { refresh_token: 'acak-tidak-ada' } });
    return [r.status === 401, msg(r)];
  });

  await t('7e', 'Device yang dinonaktifkan membuat refresh token tidak dapat dipakai', 'POST /auth/refresh setelah devices.active=0 untuk device login', '403', async () => {
    const s = await login('mhs3');
    db.prepare('UPDATE devices SET active=0 WHERE user_id=?').run(uid('mhs3'));
    const r = await gw('/auth/refresh', { method: 'POST', body: { refresh_token: s.refresh } });
    db.prepare('UPDATE devices SET active=1 WHERE user_id=?').run(uid('mhs3'));
    return [r.status === 403, msg(r)];
  });

  await t('8a', 'Mahasiswa hanya melihat nilai miliknya', 'GET /nilai (mhs1)', '200, semua baris ber-NIM mhs1', async () => {
    const r = await gw('/nilai', as(mhs1));
    const rows = (r.json && r.json.data) || [];
    return [r.status === 200 && rows.length === 2 && rows.every((x) => x.nim === nim('mhs1')), `${msg(r)}; ${rows.length} baris, NIM: ${[...new Set(rows.map((x) => x.nim))].join(',')}`];
  });
  await t('8b', 'Mahasiswa meminta nilai mahasiswa lain ditolak', 'GET /nilai?nim=2210002 (mhs1)', '403', async () => {
    const r = await gw(`/nilai?nim=${nim('mhs2')}`, as(mhs1));
    return [r.status === 403, msg(r)];
  });
  await t('8c', 'Dosen hanya melihat nilai kelas yang diampu', 'GET /nilai (dosen1)', '200, hanya IF301', async () => {
    const r = await gw('/nilai', as(dosen1));
    const rows = (r.json && r.json.data) || [];
    return [r.status === 200 && rows.length === 3 && rows.every((x) => x.kode_mk === 'IF301'), `${msg(r)}; kelas: ${[...new Set(rows.map((x) => x.kode_mk))].join(',')}`];
  });
  await t('8d', 'Dosen meminta nilai kelas dosen lain ditolak', 'GET /nilai?kelas_id=2 (dosen1)', '403', async () => {
    const r = await gw('/nilai?kelas_id=2', as(dosen1));
    return [r.status === 403, msg(r)];
  });
  await t('8e', 'Admin tidak berhak ke /nilai (least privilege, Tabel 3)', 'GET /nilai (admin)', '403', async () => {
    const r = await gw('/nilai', as(admin));
    return [r.status === 403, msg(r)];
  });

  await t('9', 'Dosen tidak dapat mengubah nilai kelas dosen lain', 'PUT /nilai/<id kelas 2> (dosen1)', '403; nilai di DB tidak berubah', async () => {
    const id = gradeId(2, 'mhs1');
    const r = await gw(`/nilai/${id}`, { ...as(dosen1), method: 'PUT', body: { nilai: 100 } });
    const unchanged = db.prepare('SELECT nilai FROM grades WHERE id=?').get(id).nilai === 80;
    return [r.status === 403 && unchanged, `${msg(r)}; nilai di DB tidak berubah=${unchanged}`];
  });
  await t('10', 'Dosen pengampu mengubah nilai yang belum final dalam jam akses', 'PUT /nilai/<id kelas 1> {nilai: 91} (dosen1)', '200 dan nilai berubah di DB', async () => {
    const id = gradeId(1, 'mhs1');
    const r = await gw(`/nilai/${id}`, { ...as(dosen1), method: 'PUT', body: { nilai: 91 } });
    const v = db.prepare('SELECT nilai FROM grades WHERE id=?').get(id).nilai;
    return [r.status === 200 && v === 91, `${msg(r)}; nilai di DB=${v}`];
  });
  await t('10b', 'Validasi input nilai (di luar 0-100 / bukan angka)', 'PUT /nilai/<id> {nilai: 150} dan {nilai: "A"}', '400 untuk keduanya', async () => {
    const id = gradeId(1, 'mhs1');
    const a = await gw(`/nilai/${id}`, { ...as(dosen1), method: 'PUT', body: { nilai: 150 } });
    const b = await gw(`/nilai/${id}`, { ...as(dosen1), method: 'PUT', body: { nilai: 'A' } });
    return [a.status === 400 && b.status === 400, `150 -> ${a.status}, "A" -> ${b.status}`];
  });
  await t('10c', 'Mahasiswa tidak dapat mengubah nilai', 'PUT /nilai/<id> (mhs1)', '403', async () => {
    const r = await gw(`/nilai/${gradeId(1, 'mhs1')}`, { ...as(mhs1), method: 'PUT', body: { nilai: 100 } });
    return [r.status === 403, msg(r)];
  });

  await t('13', 'Dosen pengampu memfinalisasi kelas, sinkron ke transkrip lewat gateway', 'POST /kelas/2/finalisasi (dosen2)', '200; nilai final; transkrip terisi; audit memuat POST /auth/service & POST /transkrip/sinkron oleh service', async () => {
    const r = await gw('/kelas/2/finalisasi', { ...as(dosen2), method: 'POST' });
    const finals = db.prepare('SELECT COUNT(*) n FROM grades WHERE class_id=2 AND is_final=1').get().n;
    const tr = db.prepare('SELECT COUNT(*) n FROM transcripts WHERE class_id=2').get().n;
    const status = db.prepare('SELECT sync_status s FROM classes WHERE id=2').get().s;
    const aud = db.prepare("SELECT endpoint FROM audit_logs WHERE subject LIKE 'service:%' AND decision='allow'").all().map((x) => x.endpoint);
    const ok = r.status === 200 && finals === 3 && tr === 3 && status === 'tersinkron' && aud.includes('/auth/service') && aud.includes('/transkrip/sinkron');
    return [ok, `${msg(r)}; nilai final=${finals}, baris transkrip=${tr}, sync_status=${status}; audit service: ${aud.join(', ')}`];
  });
  await t('11', 'Nilai yang sudah final tidak dapat diubah', 'PUT /nilai/<id kelas 2> (dosen2, setelah finalisasi)', '403; nilai tetap 80', async () => {
    const id = gradeId(2, 'mhs1');
    const r = await gw(`/nilai/${id}`, { ...as(dosen2), method: 'PUT', body: { nilai: 100 } });
    const v = db.prepare('SELECT nilai FROM grades WHERE id=?').get(id).nilai;
    return [r.status === 403 && v === 80, `${msg(r)}; nilai di DB=${v}`];
  });
  await t('13b', 'Dosen lain tidak dapat memfinalisasi kelas yang bukan miliknya', 'POST /kelas/2/finalisasi (dosen1)', '403', async () => {
    const r = await gw('/kelas/2/finalisasi', { ...as(dosen1), method: 'POST' });
    return [r.status === 403, msg(r)];
  });
  await t('13c', 'Mahasiswa tidak dapat memfinalisasi kelas', 'POST /kelas/1/finalisasi (mhs1)', '403', async () => {
    const r = await gw('/kelas/1/finalisasi', { ...as(mhs1), method: 'POST' });
    return [r.status === 403, msg(r)];
  });

  await t('14', 'Admin melihat transkrip seluruh mahasiswa', 'GET /transkrip/2210001 dan /2210002 (admin)', '200 untuk keduanya', async () => {
    const a = await gw(`/transkrip/${nim('mhs1')}`, as(admin));
    const b = await gw(`/transkrip/${nim('mhs2')}`, as(admin));
    return [a.status === 200 && b.status === 200 && a.json.transkrip.length === 1, `NIM1 ${a.status} (${a.json && a.json.transkrip.length} MK), NIM2 ${b.status}`];
  });
  await t('15', 'Mahasiswa melihat transkrip NIM sendiri', 'GET /transkrip/2210001 (mhs1)', '200, berisi IF302 nilai 80', async () => {
    const r = await gw(`/transkrip/${nim('mhs1')}`, as(mhs1));
    const row = r.json && r.json.transkrip && r.json.transkrip[0];
    return [r.status === 200 && !!row && row.kode_mk === 'IF302' && row.nilai === 80, `${msg(r)}; ${row ? `${row.kode_mk}=${row.nilai}` : 'kosong'}`];
  });
  await t('16', 'Mahasiswa tidak dapat melihat transkrip NIM lain', 'GET /transkrip/2210002 (mhs1)', '403', async () => {
    const r = await gw(`/transkrip/${nim('mhs2')}`, as(mhs1));
    return [r.status === 403, msg(r)];
  });
  await t('16b', 'Dosen tidak berhak melihat transkrip', 'GET /transkrip/2210001 (dosen1)', '403', async () => {
    const r = await gw(`/transkrip/${nim('mhs1')}`, as(dosen1));
    return [r.status === 403, msg(r)];
  });

  await t('17', 'Token user (dosen & admin) ditolak pada /transkrip/sinkron lewat gateway', 'POST /transkrip/sinkron {kelas_id:2} (dosen2 lalu admin)', '403 untuk keduanya', async () => {
    const a = await gw('/transkrip/sinkron', { ...as(dosen2), method: 'POST', body: { kelas_id: 2 } });
    const b = await gw('/transkrip/sinkron', { ...as(admin), method: 'POST', body: { kelas_id: 2 } });
    return [a.status === 403 && b.status === 403, `dosen: ${msg(a)}; admin: ${msg(b)}`];
  });
  await t('17b', 'Service Transkrip sendiri menolak token user pada sinkron (gateway secret benar)', `POST ${TRANSKRIP}/transkrip/sinkron langsung, X-Gateway-Secret benar + token dosen2`, '403', async () => {
    const r = await http(`${TRANSKRIP}/transkrip/sinkron`, { method: 'POST', headers: { 'X-Gateway-Secret': base.gatewaySecret, Authorization: `Bearer ${dosen2.access}` }, body: { kelas_id: 2 } });
    return [r.status === 403, msg(r)];
  });

  await t('21', 'Token service: kredensial salah ditolak, benar diterima (5 menit, role service)', 'POST /auth/service (secret salah, id salah, benar)', '401, 401, 200 (exp-iat=300, role=service)', async () => {
    const bad1 = await gw('/auth/service', { method: 'POST', body: { client_id: base.service.clientId, client_secret: 'salah-salah-salah-salah' } });
    const bad2 = await gw('/auth/service', { method: 'POST', body: { client_id: 'bukan-service', client_secret: base.service.clientSecret } });
    const ok = await gw('/auth/service', { method: 'POST', body: { client_id: base.service.clientId, client_secret: base.service.clientSecret } });
    const c = ok.json && ok.json.access_token ? jwt.decode(ok.json.access_token) : {};
    return [bad1.status === 401 && bad2.status === 401 && ok.status === 200 && c.role === 'service' && c.exp - c.iat === 300, `${bad1.status}, ${bad2.status}, ${ok.status}; exp-iat=${c.exp - c.iat}s role=${c.role}`];
  });
  let svcToken;
  await t('18', 'Token service valid dipakai untuk sinkronisasi melalui gateway (idempoten, tanpa duplikat)', 'POST /transkrip/sinkron {kelas_id:2} (token service)', '200; baris transkrip kelas 2 tetap 3', async () => {
    const tk = await gw('/auth/service', { method: 'POST', body: { client_id: base.service.clientId, client_secret: base.service.clientSecret } });
    svcToken = tk.json.access_token;
    const r = await gw('/transkrip/sinkron', { token: svcToken, method: 'POST', body: { kelas_id: 2 } });
    const n = db.prepare('SELECT COUNT(*) n FROM transcripts WHERE class_id=2').get().n;
    return [r.status === 200 && n === 3, `${msg(r)}; baris transkrip kelas 2=${n}`];
  });
  await t('18b', 'Token service tidak boleh dipakai pada endpoint user', 'GET /nilai dan GET /transkrip/2210001 (token service)', '403 untuk keduanya', async () => {
    const a = await gw('/nilai', { token: svcToken });
    const b = await gw(`/transkrip/${nim('mhs1')}`, { token: svcToken });
    return [a.status === 403 && b.status === 403, `/nilai ${a.status}, /transkrip ${b.status}`];
  });
  await t('18c', 'Sinkron kelas yang belum final ditolak (sumber = DB, bukan kiriman pemanggil)', 'POST /transkrip/sinkron {kelas_id:1} (token service)', '409', async () => {
    const r = await gw('/transkrip/sinkron', { token: svcToken, method: 'POST', body: { kelas_id: 1 } });
    return [r.status === 409, msg(r)];
  });

  await t('19', 'Request langsung ke Service Nilai/Transkrip tanpa gateway secret ditolak (walau token user valid)', `GET ${NILAI}/nilai, GET ${TRANSKRIP}/transkrip/2210001 tanpa/salah X-Gateway-Secret`, '403 untuk semuanya', async () => {
    const a = await http(`${NILAI}/nilai`, { headers: { Authorization: `Bearer ${mhs1.access}` } });
    const b = await http(`${TRANSKRIP}/transkrip/${nim('mhs1')}`, { headers: { Authorization: `Bearer ${admin.access}` } });
    const c = await http(`${NILAI}/nilai`, { headers: { 'X-Gateway-Secret': 'tebakan-salah', Authorization: `Bearer ${mhs1.access}` } });
    return [a.status === 403 && b.status === 403 && c.status === 403, `nilai ${a.status}, transkrip ${b.status}, secret salah ${c.status}`];
  });
  await t('20', 'Gateway secret benar tetapi token tidak valid tetap ditolak di service', 'Request langsung ke service dengan X-Gateway-Secret benar: tanpa token / token acak / kedaluwarsa / service palsu', '401 untuk semuanya', async () => {
    const hd = { 'X-Gateway-Secret': base.gatewaySecret };
    const now = Math.floor(Date.now() / 1000);
    const expired = forge({ role: 'mahasiswa', iat: now - 700, exp: now - 10 }, base.jwtSecret, { subject: String(uid('mhs1')) });
    const fakeSvc = forge({ role: 'service' }, 'secret-palsu-secret-palsu-1234', { subject: base.service.clientId, expiresIn: '5m' });
    const a = await http(`${NILAI}/nilai`, { headers: hd });
    const b = await http(`${NILAI}/nilai`, { headers: { ...hd, Authorization: 'Bearer abc.def.ghi' } });
    const c = await http(`${TRANSKRIP}/transkrip/${nim('mhs1')}`, { headers: { ...hd, Authorization: `Bearer ${expired}` } });
    const d = await http(`${TRANSKRIP}/transkrip/sinkron`, { method: 'POST', headers: { ...hd, Authorization: `Bearer ${fakeSvc}` }, body: { kelas_id: 2 } });
    return [[a, b, c, d].every((x) => x.status === 401), `tanpa token ${a.status}, token acak ${b.status}, kedaluwarsa ${c.status}, service palsu ${d.status}`];
  });
  await t('20b', 'Client tidak dapat memalsukan X-Gateway-Secret lewat gateway (gateway menimpa header)', 'GET /nilai via gateway dengan X-Gateway-Secret palsu + token mhs1', '200 (secret palsu tidak berpengaruh)', async () => {
    const r = await gw('/nilai', { ...as(mhs1), headers: { 'X-Gateway-Secret': 'palsu' } });
    return [r.status === 200, msg(r)];
  });
  await t('20c', 'Endpoint/metode tak dikenal ditolak (default deny)', 'GET /admin, DELETE /nilai/1, GET /nilai%2F..%2Ftranskrip%2F2210002', '403 untuk semuanya', async () => {
    const a = await gw('/admin', as(admin));
    const b = await gw('/nilai/1', { ...as(dosen1), method: 'DELETE' });
    const c = await gw('/nilai%2F..%2Ftranskrip%2F2210002', as(mhs1));
    return [[a, b, c].every((x) => x.status === 403), `/admin ${a.status}, DELETE ${b.status}, encoded traversal ${c.status}`];
  });
  await t('20d', 'JSON rusak pada /auth/login ditangani dengan 400 (bukan crash)', 'POST /auth/login body "{rusak"', '400', async () => {
    const res = await fetch(`${GW}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-ID': DEV.mhs1 }, body: '{rusak' });
    return [res.status === 400, `HTTP ${res.status}`];
  });

  // ===== FASE B: jam akses ditutup (simulasi di luar jam) =====
  console.log('\n== FASE B: jam akses ditutup ==');
  await stopAll();
  const hNow = currentHour(base.access.tz);
  const closed = { ACCESS_HOURS_START: hourLabel(hNow + 2), ACCESS_HOURS_END: hourLabel(hNow + 3) };
  await startAll(closed);
  const dosen1b = await login('dosen1');
  const win = `${closed.ACCESS_HOURS_START}-${closed.ACCESS_HOURS_END}`;
  await t('12a', 'Perubahan nilai di luar jam akses ditolak', `PUT /nilai/<id kelas 1> (dosen1; jam akses dikonfigurasi ${win}, sekarang di luar rentang)`, '403 "Di luar jam akses"; nilai tidak berubah', async () => {
    const id = gradeId(1, 'mhs2');
    const before = db.prepare('SELECT nilai FROM grades WHERE id=?').get(id).nilai;
    const r = await gw(`/nilai/${id}`, { ...as(dosen1b), method: 'PUT', body: { nilai: 99 } });
    const after = db.prepare('SELECT nilai FROM grades WHERE id=?').get(id).nilai;
    return [r.status === 403 && /jam akses/i.test(r.json.message) && before === after, `${msg(r)}; nilai ${before} -> ${after}`];
  });
  await t('12b', 'Finalisasi di luar jam akses ditolak', 'POST /kelas/1/finalisasi (dosen1, di luar jam)', '403; kelas tetap belum final', async () => {
    const r = await gw('/kelas/1/finalisasi', { ...as(dosen1b), method: 'POST' });
    const finals = db.prepare('SELECT COUNT(*) n FROM grades WHERE class_id=1 AND is_final=1').get().n;
    return [r.status === 403 && /jam akses/i.test(r.json.message) && finals === 0, `${msg(r)}; nilai final kelas 1=${finals}`];
  });
  await t('12c', 'Service Nilai memeriksa ulang jam akses sendiri (gateway dilewati, secret & token valid)', 'PUT langsung ke Service Nilai dengan X-Gateway-Secret + token dosen1', '403 "Di luar jam akses" dari service', async () => {
    const r = await http(`${NILAI}/nilai/${gradeId(1, 'mhs2')}`, { method: 'PUT', headers: { 'X-Gateway-Secret': base.gatewaySecret, Authorization: `Bearer ${dosen1b.access}` }, body: { nilai: 99 } });
    return [r.status === 403 && /jam akses/i.test(r.json.message), msg(r)];
  });
  await t('12d', 'Jam akses hanya membatasi perubahan/finalisasi; membaca tetap boleh', 'GET /nilai (dosen1, di luar jam)', '200', async () => {
    const r = await gw('/nilai', as(dosen1b));
    return [r.status === 200, msg(r)];
  });

  // ===== FASE C: sinkron gagal lalu dicoba ulang =====
  console.log('\n== FASE C: kegagalan sinkronisasi ==');
  await stopAll();
  await startAll({ ACCESS_HOURS_START: '00:00', ACCESS_HOURS_END: '24:00' });
  const d1 = await login('dosen1'); const m1 = await login('mhs1');
  await stopSvc('transkrip'); // Service Transkrip dimatikan
  await t('S1', 'Sinkron gagal ditangani jelas: 502, status final tercatat, sync_status=gagal (tidak diam-diam)', 'POST /kelas/1/finalisasi (dosen1) saat Service Transkrip mati', '502 dengan sinkron.status=gagal; classes.sync_status=gagal; nilai tetap final; transkrip kosong', async () => {
    const r = await gw('/kelas/1/finalisasi', { ...as(d1), method: 'POST' });
    const cls = db.prepare('SELECT sync_status s FROM classes WHERE id=1').get();
    const finals = db.prepare('SELECT COUNT(*) n FROM grades WHERE class_id=1 AND is_final=1').get().n;
    const trn = db.prepare('SELECT COUNT(*) n FROM transcripts WHERE class_id=1').get().n;
    return [r.status === 502 && r.json.sinkron.status === 'gagal' && cls.s === 'gagal' && finals === 3 && trn === 0, `${msg(r)}; sync_status=${cls.s}; final=${finals}; transkrip=${trn}`];
  });
  await startSvc('transkrip');
  await t('S2', 'Mengulang finalisasi (idempoten) menyelesaikan sinkron yang gagal', 'POST /kelas/1/finalisasi (dosen1) setelah Service Transkrip hidup lagi', '200; sync_status=tersinkron; transkrip mhs1 memuat IF301 dan IF302', async () => {
    const r = await gw('/kelas/1/finalisasi', { ...as(d1), method: 'POST' });
    const cls = db.prepare('SELECT sync_status s FROM classes WHERE id=1').get().s;
    const tr = await gw(`/transkrip/${nim('mhs1')}`, as(m1));
    const mk = ((tr.json && tr.json.transkrip) || []).map((x) => x.kode_mk);
    return [r.status === 200 && cls === 'tersinkron' && mk.includes('IF301') && mk.includes('IF302'), `${msg(r)}; sync_status=${cls}; transkrip mhs1: ${mk.join(',')}`];
  });

  // ===== audit log =====
  await t('22', 'Audit log mencatat waktu, subjek, endpoint, device, hasil (allow & deny), dan alasan', 'SELECT dari tabel audit_logs setelah seluruh skenario', 'Ada baris allow & deny; kolom wajib terisi; tidak ada token/secret/password di log', async () => {
    const rows = db.prepare('SELECT * FROM audit_logs').all();
    const allow = rows.filter((r) => r.decision === 'allow').length;
    const deny = rows.filter((r) => r.decision === 'deny').length;
    const missing = rows.filter((r) => !r.timestamp || !r.subject || !r.endpoint || !r.decision || !r.reason).length;
    const userNoDevice = rows.filter((r) => r.subject.startsWith('user:') && !r.device_id && !['/auth/refresh', '/auth/logout'].includes(r.endpoint) && !/X-Device-ID wajib/.test(r.reason)).length;
    const blob = JSON.stringify(rows);
    const leak = [base.jwtSecret, base.gatewaySecret, base.service.clientSecret, PASSWORD, 'eyJhbGciOi'].some((s) => blob.includes(s));
    const subjects = new Set(rows.map((r) => r.subject.split(':')[0]));
    const ok = allow > 0 && deny > 0 && missing === 0 && userNoDevice === 0 && !leak && subjects.has('service') && subjects.has('user') && subjects.has('anonymous');
    return [ok, `${rows.length} baris (allow=${allow}, deny=${deny}); kolom wajib kosong=${missing}; baris user tanpa device (di luar kasus header device memang kosong)=${userNoDevice}; bocor secret/token=${leak}; tipe subjek=${[...subjects].join('/')}`];
  });
  const sample = db.prepare("SELECT timestamp, subject, method, endpoint, device_id, decision, status_code, reason FROM audit_logs WHERE decision='deny' ORDER BY id DESC LIMIT 8").all();

  db.close();
  await stopAll();

  // ---------- laporan ----------
  const pass = results.filter((r) => r.status === 'LULUS').length;
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md = [
    '# Hasil Pengujian Otomatis',
    '',
    `Dihasilkan oleh \`npm test\` (tests/run-tests.js) pada ${new Date().toISOString()} dengan Node ${process.version}.`,
    'Semua "Hasil aktual" berasal dari respons HTTP dan isi database nyata saat pengujian berjalan (bukan ditulis manual).',
    '',
    `**Ringkasan: ${pass}/${results.length} lulus.**`,
    '',
    '| No | Tujuan | Request | Hasil diharapkan | Hasil aktual | Status |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.no} | ${esc(r.tujuan)} | ${esc(r.request)} | ${esc(r.harapan)} | ${esc(r.aktual)} | ${r.status} |`),
    '',
    '## Contoh audit log (8 penolakan terakhir)',
    '',
    '| Waktu | Subjek | Request | Device | Hasil | HTTP | Alasan |',
    '|---|---|---|---|---|---|---|',
    ...sample.map((s) => `| ${s.timestamp} | ${esc(s.subject)} | ${s.method} ${esc(s.endpoint)} | ${s.device_id || '-'} | ${s.decision} | ${s.status_code} | ${esc(s.reason)} |`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'hasil-pengujian.md'), md);
  console.log(`\nRINGKASAN: ${pass}/${results.length} lulus. Laporan: tests/hasil-pengujian.md`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (e) => { console.error('Pengujian berhenti:', e); await stopAll().catch(() => {}); process.exit(2); });
