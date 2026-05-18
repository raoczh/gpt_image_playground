import express from 'express';
import crypto from 'crypto';
import { getAllSystemConfig, getSystemConfig, setSystemConfig } from '../systemConfig.js';
import { logAudit } from '../audit.js';

const ALLOWED_KEYS = new Set([
  'registration_mode',
  'daily_generation_limit',
  'user_storage_limit_mb',
  'maintenance_mode',
  'maintenance_message',
  'announcement',
  'default_api_profile',
  'review_message',
]);

function validateValue(key, value) {
  switch (key) {
    case 'registration_mode':
      if (!['open', 'allowlist', 'review'].includes(value)) return 'registration_mode 必须是 open / allowlist / review';
      return null;
    case 'daily_generation_limit':
    case 'user_storage_limit_mb':
      if (value !== null && (!Number.isFinite(value) || value < 0)) return `${key} 必须是非负数或 null`;
      return null;
    case 'maintenance_mode':
      if (typeof value !== 'boolean') return 'maintenance_mode 必须是布尔值';
      return null;
    case 'maintenance_message':
    case 'review_message':
      if (typeof value !== 'string') return `${key} 必须是字符串`;
      return null;
    case 'announcement':
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) return 'announcement 必须是对象或 null';
      return null;
    case 'default_api_profile':
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) return 'default_api_profile 必须是对象或 null';
      return null;
    default:
      return null;
  }
}

// 根据内容自动生成 announcement id，避免管理员忘记改 id 导致用户 dismiss 永久生效
function normalizeAnnouncement(value) {
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  const sig = JSON.stringify({ level: next.level || '', content: next.content || '' });
  next.id = crypto.createHash('sha1').update(sig).digest('hex').slice(0, 12);
  return next;
}

export default function createAdminConfigRouter() {
  const router = express.Router();

  router.get('/config', async (req, res) => {
    try {
      const all = await getAllSystemConfig();
      res.json({ config: all });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin get config error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/config/:key', async (req, res) => {
    try {
      const { key } = req.params;
      if (!ALLOWED_KEYS.has(key)) return res.status(404).json({ error: 'Unknown config key' });
      const value = await getSystemConfig(key);
      res.json({ key, value });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin get single config error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/config', async (req, res) => {
    try {
      const updates = req.body || {};
      if (typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ error: '请求体必须是对象' });
      }

      for (const [key, value] of Object.entries(updates)) {
        if (!ALLOWED_KEYS.has(key)) {
          return res.status(400).json({ error: `未知配置 key: ${key}` });
        }
        const err = validateValue(key, value);
        if (err) return res.status(400).json({ error: err });
      }

      const before = {};
      for (const key of Object.keys(updates)) {
        before[key] = await getSystemConfig(key);
      }

      for (const [key, value] of Object.entries(updates)) {
        const finalValue = key === 'announcement' ? normalizeAnnouncement(value) : value;
        if (key === 'announcement') updates[key] = finalValue;
        await setSystemConfig(key, finalValue, req.adminUser?.id || null);
      }

      logAudit({
        actorId: req.adminUser?.id,
        action: 'config.update',
        targetType: 'config',
        targetId: null,
        beforeValue: { keys: Object.keys(updates), values: before },
        afterValue: updates,
        ip: req.ip,
        ua: req.get('user-agent'),
      });

      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin update config error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
