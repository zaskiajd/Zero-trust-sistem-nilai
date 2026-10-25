'use strict';
// Audit log gateway: waktu, subjek, endpoint, device, hasil (allow/deny), alasan.
// Ditulis ke tabel audit_logs. Tidak pernah menulis token, password, atau secret.

function clean(v, max = 128) {
  if (v === undefined || v === null) return null;
  return String(v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function createAudit(db) {
  const insert = db.prepare(
    `INSERT INTO audit_logs (timestamp, subject, method, endpoint, device_id, decision, reason, request_id)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const setStatusStmt = db.prepare('UPDATE audit_logs SET status_code = ? WHERE id = ?');

  // Mencatat satu keputusan untuk satu request.
  function log(req, { subject, decision, reason, device }) {
    try {
      const endpoint = (req.originalUrl || req.url || '').split('?')[0]; // query string tidak dicatat
      const info = insert.run(
        new Date().toISOString(),
        clean(subject) || 'anonymous',
        req.method,
        clean(endpoint, 256),
        clean(device !== undefined ? device : req.get('x-device-id'), 64),
        decision,
        clean(reason, 300),
        req.id || null
      );
      req.auditId = Number(info.lastInsertRowid);
    } catch (e) {
      console.error('[audit] gagal menulis log:', e.message);
    }
  }

  function setStatus(id, status) {
    if (!id) return;
    try { setStatusStmt.run(status, id); } catch (e) { console.error('[audit] gagal update status:', e.message); }
  }

  // Menolak request: catat deny lalu kirim respons.
  function deny(req, res, { status = 403, error = 'forbidden', reason, message, subject, device }) {
    log(req, { subject: subject || (req.principal && req.principal.subject) || 'anonymous', decision: 'deny', reason, device });
    // 'message' = teks untuk client (jika perlu lebih generik daripada alasan di audit)
    return res.status(status).json({ error, message: message || reason, request_id: req.id });
  }

  return { log, deny, setStatus };
}

module.exports = { createAudit, clean };
