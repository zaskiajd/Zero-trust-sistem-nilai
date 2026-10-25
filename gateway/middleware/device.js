'use strict';
// PEP langkah 2: verifikasi konteks. Device harus terdaftar & aktif untuk user yang bersangkutan.
// Panggilan antar-service (token service) tidak memakai device.
function createDeviceCheck({ db, audit }) {
  const find = db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ? AND active = 1');

  return function deviceCheck(req, res, next) {
    const p = req.principal;
    if (p.type === 'service') return next();
    const deviceId = req.get('x-device-id');
    if (!deviceId) {
      return audit.deny(req, res, { status: 403, error: 'device_required', reason: 'Header X-Device-ID wajib' });
    }
    if (!find.get(p.id, deviceId)) {
      return audit.deny(req, res, { status: 403, error: 'device_not_registered', reason: 'Device tidak terdaftar untuk user ini' });
    }
    next();
  };
}

module.exports = { createDeviceCheck };
