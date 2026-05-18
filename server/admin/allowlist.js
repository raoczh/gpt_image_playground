import express from 'express';
import { logAudit } from '../audit.js';

export default function createAdminAllowlistRouter(db) {
  const router = express.Router();

  router.get('/allowlist', async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT a.id, a.github_username, a.note, a.created_at, a.added_by, u.username AS added_by_username
         FROM registration_allowlist a
         LEFT JOIN users u ON u.id = a.added_by
         ORDER BY a.created_at DESC`
      );
      res.json({ items: rows });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin list allowlist error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/allowlist', async (req, res) => {
    try {
      const { github_username, note } = req.body || {};
      if (!github_username || typeof github_username !== 'string' || !github_username.trim()) {
        return res.status(400).json({ error: 'github_username 不能为空' });
      }
      const username = github_username.trim().toLowerCase();
      const [result] = await db.query(
        'INSERT INTO registration_allowlist (github_username, added_by, note) VALUES (?, ?, ?)',
        [username, req.adminUser?.id || null, typeof note === 'string' ? note.slice(0, 255) : null]
      );
      logAudit({
        actorId: req.adminUser?.id,
        action: 'allowlist.add',
        targetType: 'allowlist',
        targetId: String(result.insertId),
        afterValue: { github_username: username, note },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true, id: result.insertId });
    } catch (error) {
      if (error && error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '该用户名已在白名单中' });
      }
      console.error(`[${new Date().toISOString()}] ❌ Admin add allowlist error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/allowlist/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [beforeRows] = await db.query('SELECT github_username FROM registration_allowlist WHERE id = ?', [id]);
      const [result] = await db.query('DELETE FROM registration_allowlist WHERE id = ?', [id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'Not found' });
      logAudit({
        actorId: req.adminUser?.id,
        action: 'allowlist.remove',
        targetType: 'allowlist',
        targetId: String(id),
        beforeValue: { github_username: beforeRows[0]?.github_username },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin delete allowlist error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
