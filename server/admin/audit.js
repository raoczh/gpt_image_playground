import express from 'express';

function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

export default function createAdminAuditRouter(db) {
  const router = express.Router();

  router.get('/audit-log', async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const actorId = req.query.actor_id ? Number(req.query.actor_id) : null;
      const action = typeof req.query.action === 'string' && req.query.action ? req.query.action : null;
      const targetType = typeof req.query.target_type === 'string' && req.query.target_type ? req.query.target_type : null;
      const targetId = typeof req.query.target_id === 'string' && req.query.target_id ? req.query.target_id : null;

      const where = [];
      const params = [];
      if (actorId) { where.push('a.actor_id = ?'); params.push(actorId); }
      if (action) { where.push('a.action = ?'); params.push(action); }
      if (targetType) { where.push('a.target_type = ?'); params.push(targetType); }
      if (targetId) { where.push('a.target_id = ?'); params.push(targetId); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const [rows] = await db.query(
        `SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id,
                a.before_value, a.after_value, a.ip, a.ua, a.created_at,
                u.username AS actor_username, u.avatar_url AS actor_avatar
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         ${whereSql}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM admin_audit_log a ${whereSql}`,
        params
      );

      res.json({
        items: rows.map((r) => ({
          ...r,
          before_value: parseJson(r.before_value),
          after_value: parseJson(r.after_value),
        })),
        total: Number(countRows[0]?.total || 0),
        limit,
        offset,
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin audit log list error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/audit-log/:id', async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT a.*, u.username AS actor_username, u.avatar_url AS actor_avatar
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.id = ?`,
        [Number(req.params.id)]
      );
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const r = rows[0];
      res.json({
        ...r,
        before_value: parseJson(r.before_value),
        after_value: parseJson(r.after_value),
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin audit log detail error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
