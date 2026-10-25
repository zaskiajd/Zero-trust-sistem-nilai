'use strict';
// Membuat environment Postman dari .env: URL + secret terisi otomatis, sehingga
// tidak perlu menyalin secret secara manual dan secret tidak ikut ter-commit.
// Jalankan: npm run postman:env
const fs = require('fs');
const path = require('path');
const { loadConfig, ROOT } = require('../shared/config');

const OUT = path.join(ROOT, 'tests', 'postman', 'local.postman_environment.json');

// Password akun demo didefinisikan di database/init.js; dibaca agar tidak duplikat.
function labPassword() {
  const src = fs.readFileSync(path.join(ROOT, 'database', 'init.js'), 'utf8');
  const m = src.match(/LAB_PASSWORD\s*=\s*'([^']+)'/);
  return m ? m[1] : 'Praktikum#2026';
}

const cfg = loadConfig();

const env = {
  id: 'a7f3c1e2-5b64-4d8a-9c10-zero-trust-sni',
  name: 'Zero Trust Sistem Nilai - Lokal',
  values: [
    { key: 'baseUrl', value: cfg.urls.gateway, type: 'default', enabled: true },
    { key: 'nilaiUrl', value: cfg.urls.nilai, type: 'default', enabled: true },
    { key: 'transkripUrl', value: cfg.urls.transkrip, type: 'default', enabled: true },
    { key: 'gatewaySecret', value: cfg.gatewaySecret, type: 'secret', enabled: true },
    { key: 'serviceClientId', value: cfg.service.clientId, type: 'default', enabled: true },
    { key: 'serviceSecret', value: cfg.service.clientSecret, type: 'secret', enabled: true },
    { key: 'password', value: labPassword(), type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
  _postman_exported_using: 'scripts/gen-postman-env.js',
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(env, null, 2) + '\n', 'utf8');

console.log(`Environment Postman dibuat: ${path.relative(ROOT, OUT)}`);
console.log(`  baseUrl       : ${cfg.urls.gateway}`);
console.log(`  nilaiUrl      : ${cfg.urls.nilai}`);
console.log(`  transkripUrl  : ${cfg.urls.transkrip}`);
console.log('  secret terisi : GATEWAY_SECRET & SERVICE_CLIENT_SECRET (dari .env)');
console.log('File ini memuat secret, jadi tidak di-commit (lihat .gitignore).');
