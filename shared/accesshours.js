'use strict';
// Pemeriksaan jam akses untuk perubahan/finalisasi nilai (soal 4.3).
// Dipakai gateway (Policy Engine) DAN Service Nilai (verifikasi ulang).

function parseHM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str).trim());
  if (!m) throw new Error(`Format jam tidak valid: "${str}" (gunakan HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) throw new Error(`Jam di luar rentang: "${str}"`);
  return h * 60 + min;
}

function minutesOfDay(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

// Rentang [start, end). Jika start > end, rentang melewati tengah malam.
function isWithinAccessHours(access, date = new Date()) {
  const start = parseHM(access.start);
  const end = parseHM(access.end);
  const now = minutesOfDay(date, access.tz);
  const ok = start <= end ? now >= start && now < end : now >= start || now < end;
  return { ok, now, label: `${access.start}-${access.end} ${access.tz}` };
}

module.exports = { isWithinAccessHours, parseHM };
