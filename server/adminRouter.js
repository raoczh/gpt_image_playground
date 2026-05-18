import express from 'express';
import { requireAdmin } from './auth.js';
import createAdminUsersRouter from './admin/users.js';
import createAdminConfigRouter from './admin/config.js';
import createAdminAllowlistRouter from './admin/allowlist.js';
import createAdminStatsRouter from './admin/stats.js';
import createAdminAuditRouter from './admin/audit.js';

export default function createAdminRouter(db, deps = {}) {
  const router = express.Router();

  router.use(requireAdmin);

  router.get('/health', (req, res) => {
    res.json({ ok: true, admin: { id: req.adminUser.id, role: req.adminUser.role } });
  });

  router.use(createAdminUsersRouter(db, deps));
  router.use(createAdminConfigRouter());
  router.use(createAdminAllowlistRouter(db));
  router.use(createAdminStatsRouter(db));
  router.use(createAdminAuditRouter(db));

  return router;
}
