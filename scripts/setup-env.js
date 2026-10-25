'use strict';
// Membuat .env dari .env.example dengan secret acak. Tidak menimpa .env yang sudah ada.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  console.log('.env sudah ada, tidak diubah.');
  process.exit(0);
}
const rnd = (n) => crypto.randomBytes(n).toString('hex');
let text = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
text = text
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${rnd(32)}`)
  .replace(/^GATEWAY_SECRET=.*$/m, `GATEWAY_SECRET=${rnd(24)}`)
  .replace(/^SERVICE_CLIENT_SECRET=.*$/m, `SERVICE_CLIENT_SECRET=${rnd(24)}`);
fs.writeFileSync(target, text, { mode: 0o600 });
console.log('.env dibuat dengan secret acak.');
