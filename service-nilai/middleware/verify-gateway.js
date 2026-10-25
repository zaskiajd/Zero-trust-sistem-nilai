'use strict';
// Verifikasi mandiri di Service Nilai (assume breach: tidak percaya pada jaringan internal).
// 1) X-Gateway-Secret harus benar  -> kalau tidak: 403 (service tidak bisa diakses langsung)
// 2) Access token / token service harus valid (tanda tangan, masa berlaku, issuer) -> kalau tidak: 401
// Gateway secret saja TIDAK cukup.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function createVerifyGateway({ cfg }) {
  return function verifyGateway(req, res, next) {
    const secret = req.get('x-gateway-secret');
    if (!secret || !safeEqual(secret, cfg.gatewaySecret)) {
      return res.status(403).json({ error: 'forbidden', message: 'X-Gateway-Secret tidak ada atau salah: akses langsung ke service ditolak' });
    }
    const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!m) {
      return res.status(401).json({ error: 'unauthorized', message: 'Token tidak ada atau format salah' });
    }
    try {
      req.auth = jwt.verify(m[1], cfg.jwtSecret, { algorithms: ['HS256'], issuer: cfg.token.issuer });
    } catch (e) {
      const message = e.name === 'TokenExpiredError' ? 'Token kedaluwarsa' : 'Token tidak valid';
      return res.status(401).json({ error: 'invalid_token', message });
    }
    next();
  };
}

module.exports = { createVerifyGateway };
