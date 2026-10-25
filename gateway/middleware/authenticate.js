'use strict';
// PEP langkah 1: verifikasi JWT (tanda tangan, masa berlaku, issuer) lalu muat atribut dari database.
const jwt = require('jsonwebtoken');

function createAuthenticate({ cfg, db, audit }) {
  const userById = db.prepare('SELECT id, username, role, nim, nama, active FROM users WHERE id = ?');

  return function authenticate(req, res, next) {
    const header = req.get('authorization');
    if (!header) {
      return audit.deny(req, res, { status: 401, error: 'unauthorized', reason: 'Access token tidak ada', subject: 'anonymous' });
    }
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) {
      return audit.deny(req, res, { status: 401, error: 'unauthorized', reason: 'Format Authorization tidak valid (harus Bearer <token>)', subject: 'anonymous' });
    }

    let payload;
    try {
      payload = jwt.verify(m[1], cfg.jwtSecret, { algorithms: ['HS256'], issuer: cfg.token.issuer });
    } catch (e) {
      const reason = e.name === 'TokenExpiredError' ? 'Access token kedaluwarsa' : 'Access token tidak valid (tanda tangan/format salah)';
      return audit.deny(req, res, { status: 401, error: 'invalid_token', reason, subject: 'anonymous' });
    }

    // Token service (role: service)
    if (payload.role === 'service') {
      if (payload.sub !== cfg.service.clientId) {
        return audit.deny(req, res, { status: 401, error: 'invalid_token', reason: 'Subjek token service tidak dikenal', subject: 'anonymous' });
      }
      req.principal = { type: 'service', id: payload.sub, role: 'service', subject: `service:${payload.sub}` };
      return next();
    }

    // Token user: atribut diambil dari database, bukan hanya dari klaim token.
    const user = userById.get(Number(payload.sub));
    if (!user || !user.active) {
      return audit.deny(req, res, { status: 401, error: 'invalid_token', reason: 'User pada token tidak ditemukan atau nonaktif', subject: 'anonymous' });
    }
    if (user.role !== payload.role) {
      return audit.deny(req, res, { status: 401, error: 'invalid_token', reason: 'Role pada token tidak sesuai database', subject: `user:${user.username}` });
    }
    req.principal = { type: 'user', id: user.id, role: user.role, username: user.username, nim: user.nim, nama: user.nama, subject: `user:${user.username}` };
    next();
  };
}

module.exports = { createAuthenticate };
