import { getSystemConfig } from '../systemConfig.js';

// 维护模式中间件：开启时拒绝业务请求，但 admin 永远可访问、auth 路由保留
export function createMaintenanceMiddleware() {
  return async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/api/admin')) return next();
    if (req.path.startsWith('/api/auth')) return next();
    if (req.path.startsWith('/api/public')) return next();
    if (req.path === '/api/quota') return next();
    try {
      const enabled = await getSystemConfig('maintenance_mode');
      if (enabled === true) {
        const message = (await getSystemConfig('maintenance_message')) || '系统维护中，请稍后再试';
        return res.status(503).json({ error: 'maintenance', message });
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ⚠️  Maintenance mode check failed: ${err.message}`);
    }
    next();
  };
}
