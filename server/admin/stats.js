import express from 'express';

export default function createAdminStatsRouter(db) {
  const router = express.Router();

  router.get('/stats/overview', async (req, res) => {
    try {
      const [[users]] = await db.query(
        `SELECT
           COUNT(*) AS total_users,
           SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS new_users_7d,
           SUM(CASE WHEN last_login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS active_users_30d,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_users
         FROM users WHERE deleted_at IS NULL`
      );

      const [[tasks]] = await db.query(
        `SELECT
           COUNT(*) AS total_tasks,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_tasks,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_tasks,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_tasks,
           SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS tasks_7d,
           SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'error' THEN 1 ELSE 0 END) AS error_tasks_7d
         FROM tasks`
      );

      const [[images]] = await db.query(
        `SELECT
           COUNT(*) AS total_images,
           COALESCE(SUM(file_size), 0) AS total_bytes
         FROM images`
      );

      res.json({
        users: {
          total: Number(users.total_users || 0),
          new_7d: Number(users.new_users_7d || 0),
          active_30d: Number(users.active_users_30d || 0),
          pending: Number(users.pending_users || 0),
        },
        tasks: {
          total: Number(tasks.total_tasks || 0),
          running: Number(tasks.running_tasks || 0),
          done: Number(tasks.done_tasks || 0),
          error: Number(tasks.error_tasks || 0),
          tasks_7d: Number(tasks.tasks_7d || 0),
          error_tasks_7d: Number(tasks.error_tasks_7d || 0),
        },
        images: {
          total: Number(images.total_images || 0),
          total_bytes: Number(images.total_bytes || 0),
        },
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin overview error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/stats/tasks-trend', async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
      const [rows] = await db.query(
        `SELECT DATE(created_at) AS day,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error
         FROM tasks
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(created_at)
         ORDER BY day ASC`,
        [days]
      );

      const map = new Map();
      for (const r of rows) {
        const key = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
        map.set(key, { total: Number(r.total || 0), done: Number(r.done || 0), error: Number(r.error || 0) });
      }

      const items = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const v = map.get(key) || { total: 0, done: 0, error: 0 };
        items.push({ day: key, ...v });
      }

      res.json({ items });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin tasks trend error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/stats/storage-top', async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
      const [rows] = await db.query(
        `SELECT u.id, u.username, u.avatar_url,
                COUNT(i.id) AS image_count,
                COALESCE(SUM(i.file_size), 0) AS storage_bytes
         FROM users u
         LEFT JOIN images i ON i.user_id = u.id
         WHERE u.deleted_at IS NULL
         GROUP BY u.id, u.username, u.avatar_url
         ORDER BY storage_bytes DESC
         LIMIT ?`,
        [limit]
      );
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          username: r.username,
          avatar_url: r.avatar_url,
          image_count: Number(r.image_count || 0),
          storage_bytes: Number(r.storage_bytes || 0),
        })),
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin storage-top error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/stats/recent-failures', async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
      const [rows] = await db.query(
        `SELECT t.id, t.user_id, t.prompt, t.error_message, t.created_at, t.api_provider, t.api_model,
                u.username, u.avatar_url
         FROM tasks t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.status = 'error'
         ORDER BY t.created_at DESC
         LIMIT ?`,
        [limit]
      );
      res.json({ items: rows });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin recent-failures error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/stats/recent-users', async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
      const [rows] = await db.query(
        `SELECT id, username, avatar_url, email, status, role, created_at, last_login_at
         FROM users WHERE deleted_at IS NULL
         ORDER BY created_at DESC LIMIT ?`,
        [limit]
      );
      res.json({ items: rows });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin recent-users error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
