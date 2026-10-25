'use strict';
// Policy Administrator (PA): login, refresh, logout, penerbitan token service.
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { verifyPassword, hashPassword } = require('../shared/password');
const { clean } = require('./audit');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Bandingkan secret dengan waktu konstan (digest menyamakan panjang).
const safeEqual = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(),
  crypto.createHash('sha256').update(String(b)).digest()
);

function createAuthRouter({ db, cfg, audit }) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    device: db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ? AND active = 1'),
    insRefresh: db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, device_id, created_at, expires_at) VALUES (?,?,?,?,?)'),
    refreshByHash: db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?'),
    revoke: db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
  };

  let dummyHash; // dipakai agar waktu respons sama saat username tidak ada
  const getDummy = async () => (dummyHash ||= await hashPassword('dummy-password'));

  const signAccess = (user) => jwt.sign({ role: user.role }, cfg.jwtSecret, {
    algorithm: 'HS256', subject: String(user.id), issuer: cfg.token.issuer, expiresIn: cfg.token.accessTtl,
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  // POST /auth/login
  router.post('/login', wrap(async (req, res) => {
    const { username, password } = req.body || {};
    const subject = `user:${clean(username, 64)}`;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return audit.deny(req, res, { status: 400, error: 'bad_request', reason: 'username dan password wajib berupa string', subject });
    }
    const user = q.userByName.get(username);
    const ok = await verifyPassword(password, user ? user.password_hash : await getDummy());
    if (!user || !ok || !user.active) {
      return audit.deny(req, res, { status: 401, error: 'unauthorized', reason: 'Kredensial tidak valid (user/password salah)', message: 'Kredensial tidak valid', subject });
    }
    const deviceId = req.get('x-device-id');
    if (!deviceId) {
      return audit.deny(req, res, { status: 403, error: 'device_required', reason: 'Header X-Device-ID wajib', subject });
    }
    if (!q.device.get(user.id, deviceId)) {
      return audit.deny(req, res, { status: 403, error: 'device_not_registered', reason: 'Device tidak terdaftar untuk user ini', subject });
    }
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    q.insRefresh.run(user.id, sha256(refreshToken), deviceId, new Date(now).toISOString(), new Date(now + cfg.token.refreshTtlMs).toISOString());
    audit.log(req, { subject, decision: 'allow', reason: 'Login berhasil: kredensial valid dan device terdaftar' });
    res.json({
      access_token: signAccess(user), token_type: 'Bearer', expires_in: 600,
      refresh_token: refreshToken, refresh_expires_in: 86400,
      user: { id: user.id, username: user.username, role: user.role, nama: user.nama, nim: user.nim },
    });
  }));

  // Validasi refresh token (dipakai refresh & logout). Mengembalikan {row,user} atau {fail}.
  function checkRefresh(body) {
    const t = body && body.refresh_token;
    if (typeof t !== 'string' || !t) return { fail: { status: 400, error: 'bad_request', reason: 'refresh_token wajib' } };
    const row = q.refreshByHash.get(sha256(t));
    if (!row) return { fail: { status: 401, error: 'invalid_refresh_token', reason: 'Refresh token tidak dikenal' } };
    const user = q.userById.get(row.user_id);
    const subject = user ? `user:${user.username}` : 'anonymous';
    if (row.revoked_at) return { fail: { status: 401, error: 'invalid_refresh_token', reason: 'Refresh token sudah dicabut', subject } };
    if (new Date(row.expires_at).getTime() <= Date.now()) return { fail: { status: 401, error: 'invalid_refresh_token', reason: 'Refresh token kedaluwarsa', subject } };
    if (!user || !user.active) return { fail: { status: 401, error: 'invalid_refresh_token', reason: 'User nonaktif', subject } };
    return { row, user, subject };
  }

  // POST /auth/refresh
  router.post('/refresh', (req, res) => {
    const r = checkRefresh(req.body);
    if (r.fail) return audit.deny(req, res, r.fail);
    // Device saat login harus masih terdaftar & aktif (cabut device = refresh mati).
    if (!q.device.get(r.user.id, r.row.device_id)) {
      return audit.deny(req, res, { status: 403, error: 'device_not_registered', reason: 'Device pada refresh token tidak lagi terdaftar', subject: r.subject, device: r.row.device_id });
    }
    audit.log(req, { subject: r.subject, decision: 'allow', reason: 'Refresh token valid, access token baru diterbitkan', device: r.row.device_id });
    res.json({ access_token: signAccess(r.user), token_type: 'Bearer', expires_in: 600 });
  });

  // POST /auth/logout
  router.post('/logout', (req, res) => {
    const r = checkRefresh(req.body);
    if (r.fail) return audit.deny(req, res, r.fail);
    q.revoke.run(new Date().toISOString(), r.row.id);
    audit.log(req, { subject: r.subject, decision: 'allow', reason: 'Logout: refresh token dicabut', device: r.row.device_id });
    res.json({ message: 'Logout berhasil, refresh token dicabut' });
  });

  // POST /auth/service  (token service untuk Service Nilai)
  router.post('/service', (req, res) => {
    const { client_id: clientId, client_secret: clientSecret } = req.body || {};
    const subject = `service:${clean(clientId, 64)}`;
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
      return audit.deny(req, res, { status: 400, error: 'bad_request', reason: 'client_id dan client_secret wajib', subject });
    }
    const idOk = safeEqual(clientId, cfg.service.clientId);
    const secretOk = safeEqual(clientSecret, cfg.service.clientSecret);
    if (!(idOk && secretOk)) {
      return audit.deny(req, res, { status: 401, error: 'unauthorized', reason: 'Client ID/secret service tidak valid', subject });
    }
    const token = jwt.sign({ role: 'service' }, cfg.jwtSecret, {
      algorithm: 'HS256', subject: cfg.service.clientId, issuer: cfg.token.issuer, expiresIn: cfg.token.serviceTtl,
    });
    audit.log(req, { subject, decision: 'allow', reason: 'Token service diterbitkan (5 menit)' });
    res.json({ access_token: token, token_type: 'Bearer', expires_in: 300 });
  });

  // Semua selain 4 endpoint di atas: ditolak
  router.use((req, res) => audit.deny(req, res, { status: 404, error: 'not_found', reason: 'Endpoint /auth tidak dikenal (default deny)', subject: 'anonymous' }));

  return router;
}

module.exports = { createAuthRouter };
