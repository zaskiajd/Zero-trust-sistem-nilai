'use strict';
// API Gateway = Policy Enforcement Point (PEP), port 3000.
// Urutan: konteks request -> /auth/* (PE/PA) -> autentikasi JWT -> cek device -> Policy Engine -> audit -> proxy.
const crypto = require('crypto');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { loadConfig } = require('../shared/config');
const { openDb } = require('../shared/db');
const { createAudit } = require('./audit');
const { createAuthRouter } = require('./auth');
const { createAuthenticate } = require('./middleware/authenticate');
const { createDeviceCheck } = require('./middleware/device');
const { createPolicy } = require('./policy');

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const audit = createAudit(db);
const policy = createPolicy({ db, cfg });

const app = express();
app.disable('x-powered-by');

// 0. Konteks request + pencatatan status akhir ke audit log
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.on('finish', () => audit.setStatus(req.auditId, res.statusCode));
  next();
});

// 1. Endpoint /auth/* ditangani gateway sendiri (Policy Engine / Policy Administrator)
app.use('/auth', createAuthRouter({ db, cfg, audit }));

// 2. Semua endpoint lain: autentikasi -> device -> kebijakan
app.use(createAuthenticate({ cfg, db, audit }));
app.use(createDeviceCheck({ db, audit }));
app.use((req, res, next) => {
  const decision = policy.decide(req.principal, { method: req.method, path: req.path, query: req.query });
  if (!decision.allow) {
    return audit.deny(req, res, { status: decision.status, error: decision.status === 404 ? 'not_found' : decision.status === 400 ? 'bad_request' : 'forbidden', reason: decision.reason });
  }
  audit.log(req, { subject: req.principal.subject, decision: 'allow', reason: decision.reason });
  next();
});

// 3. Teruskan ke service dengan X-Gateway-Secret. Body tidak diparse di gateway (stream diteruskan apa adanya).
function proxyTo(target, pathRe) {
  return createProxyMiddleware({
    target,
    pathFilter: (pathname) => pathRe.test(pathname),
    proxyTimeout: 10000,
    timeout: 10000,
    on: {
      proxyReq(proxyReq, req) {
        proxyReq.setHeader('X-Gateway-Secret', cfg.gatewaySecret); // menimpa header sama dari client
        proxyReq.setHeader('X-Request-ID', req.id);
      },
      error(err, req, res) {
        console.error(`[gateway] upstream error ${req.method} ${req.path}: ${err.code || err.message}`);
        if (res.headersSent || typeof res.writeHead !== 'function') return;
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_gateway', message: 'Service tujuan tidak dapat dihubungi', request_id: req.id }));
      },
    },
  });
}
app.use(proxyTo(cfg.urls.nilai, /^\/(nilai|kelas)(\/|$)/i));
app.use(proxyTo(cfg.urls.transkrip, /^\/transkrip(\/|$)/i));

// Tidak ada route cocok (seharusnya sudah ditolak policy)
app.use((req, res) => audit.deny(req, res, { status: 404, error: 'not_found', reason: 'Route tidak ditemukan' }));

// Error handler (mis. JSON body rusak di /auth/*)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('[gateway] error:', err.message);
  const reason = status === 500 ? 'Kesalahan internal gateway' : 'Request tidak valid (body/JSON rusak atau terlalu besar)';
  if (!res.headersSent) audit.deny(req, res, { status, error: status === 500 ? 'internal_error' : 'bad_request', reason, subject: (req.principal && req.principal.subject) || 'anonymous' });
});

app.listen(cfg.ports.gateway, cfg.host, () => {
  console.log(`[gateway] PEP aktif di http://${cfg.host}:${cfg.ports.gateway}`);
});
