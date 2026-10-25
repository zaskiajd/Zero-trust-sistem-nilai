'use strict';
// Konfigurasi bersama. Setiap proses membaca .env di root repo.
// Variabel yang sudah ada di environment proses menang atas .env (dotenv tidak menimpa).
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

function required(name, minLen = 1) {
  const v = process.env[name];
  if (!v || v.length < minLen || v.startsWith('ganti-dengan')) {
    throw new Error(`Konfigurasi ${name} belum diisi dengan benar. Jalankan "npm run setup" atau isi .env (lihat .env.example).`);
  }
  return v;
}

function loadConfig() {
  const host = process.env.HOST || '127.0.0.1';
  const gatewayPort = Number(process.env.GATEWAY_PORT || 3000);
  const nilaiPort = Number(process.env.NILAI_PORT || 3001);
  const transkripPort = Number(process.env.TRANSKRIP_PORT || 3002);
  return {
    root: ROOT,
    host,
    ports: { gateway: gatewayPort, nilai: nilaiPort, transkrip: transkripPort },
    urls: {
      gateway: process.env.GATEWAY_URL || `http://127.0.0.1:${gatewayPort}`,
      nilai: process.env.NILAI_URL || `http://127.0.0.1:${nilaiPort}`,
      transkrip: process.env.TRANSKRIP_URL || `http://127.0.0.1:${transkripPort}`,
    },
    jwtSecret: required('JWT_SECRET', 16),
    gatewaySecret: required('GATEWAY_SECRET', 16),
    service: {
      clientId: required('SERVICE_CLIENT_ID'),
      clientSecret: required('SERVICE_CLIENT_SECRET', 16),
    },
    // Masa berlaku token ditetapkan soal (4.1), tidak dibuat configurable.
    token: {
      issuer: 'sistem-nilai-gateway',
      accessTtl: '10m',
      serviceTtl: '5m',
      refreshTtlMs: 24 * 60 * 60 * 1000,
    },
    access: {
      start: process.env.ACCESS_HOURS_START || '07:00',
      end: process.env.ACCESS_HOURS_END || '21:00',
      tz: process.env.ACCESS_TZ || 'Asia/Jakarta',
    },
    dbPath: path.resolve(ROOT, process.env.DB_PATH || './database/sistem-nilai.db'),
  };
}

module.exports = { loadConfig, ROOT };
