'use strict';
// Klien sinkronisasi: Service Nilai -> GATEWAY -> Service Transkrip.
// Tidak pernah memanggil port 3002 langsung. Memakai token service dari POST /auth/service.

function createTranskripClient({ cfg }) {
  let cached = null; // { token, expMs }

  async function getServiceToken(force = false) {
    if (!force && cached && cached.expMs - Date.now() > 30_000) return cached.token;
    const res = await fetch(`${cfg.urls.gateway}/auth/service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.service.clientId, client_secret: cfg.service.clientSecret }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Gagal memperoleh token service (HTTP ${res.status})`);
    const data = await res.json();
    cached = { token: data.access_token, expMs: Date.now() + (data.expires_in || 300) * 1000 };
    return cached.token;
  }

  async function callSinkron(kelasId, token) {
    return fetch(`${cfg.urls.gateway}/transkrip/sinkron`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kelas_id: kelasId }),
      signal: AbortSignal.timeout(8000),
    });
  }

  // Mengembalikan { jumlah } jika berhasil; melempar Error dengan pesan jelas jika gagal.
  async function sinkronTranskrip(kelasId) {
    let token = await getServiceToken();
    let res = await callSinkron(kelasId, token);
    if (res.status === 401) { // token mungkin kedaluwarsa: ambil baru, coba sekali lagi
      token = await getServiceToken(true);
      res = await callSinkron(kelasId, token);
    }
    let body = null;
    try { body = await res.json(); } catch { /* respons bukan JSON */ }
    if (!res.ok) {
      throw new Error(`Sinkronisasi ditolak/gagal (HTTP ${res.status}): ${(body && body.message) || 'tanpa pesan'}`);
    }
    return body;
  }

  return { sinkronTranskrip };
}

module.exports = { createTranskripClient };
