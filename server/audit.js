import db from './db.js';

export async function logAudit({
  actorId,
  action,
  targetType = null,
  targetId = null,
  beforeValue = null,
  afterValue = null,
  ip = null,
  ua = null,
}) {
  try {
    await db.query(
      `INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, before_value, after_value, ip, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorId,
        action,
        targetType,
        targetId,
        beforeValue ? JSON.stringify(beforeValue) : null,
        afterValue ? JSON.stringify(afterValue) : null,
        ip ? String(ip).slice(0, 64) : null,
        ua ? String(ua).slice(0, 255) : null,
      ]
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ⚠️  Audit log write failed: ${err.message}`);
  }
}

export function auditMiddleware(req) {
  return {
    log: (entry) => logAudit({
      actorId: req.adminUser?.id || req.user?.id || null,
      ip: req.ip,
      ua: req.get?.('user-agent'),
      ...entry,
    }),
  };
}
