import express from 'express';
import { invalidateUserCache } from '../auth.js';
import { logAudit } from '../audit.js';
import { deleteTasksAndUnreferencedImages, deleteUnreferencedImages } from '../services/imageStorage.js';

export default function createAdminUsersRouter(db, deps = {}) {
  const router = express.Router();
  const { sessionStore = null, generateProfileId = null } = deps;

  function parseJson(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch { return null; }
    }
    return v;
  }

  function profileRowToJson(row) {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider || 'openai',
      base_url: row.base_url || '',
      api_key: row.api_key || '',
      model: row.model || '',
      timeout: Number(row.timeout || 600),
      api_format: row.api_format || 'responses',
      extra: parseJson(row.extra_settings) || {},
      is_default: Boolean(row.is_default),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  function genProfileId() {
    if (typeof generateProfileId === 'function') return generateProfileId();
    return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function genCustomProviderId() {
    return `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function destroyUserSessions(userId) {
    if (!sessionStore || typeof sessionStore.all !== 'function') return;
    return new Promise((resolve) => {
      sessionStore.all((err, sessions) => {
        if (err || !sessions) return resolve();
        const targets = [];
        const entries = Array.isArray(sessions) ? sessions.map((s) => [s.id, s]) : Object.entries(sessions);
        for (const [sid, sess] of entries) {
          const data = typeof sess === 'string' ? (() => { try { return JSON.parse(sess); } catch { return {}; } })() : sess;
          if (data && Number(data.userId) === Number(userId)) targets.push(sid);
        }
        if (!targets.length) return resolve();
        let remaining = targets.length;
        for (const sid of targets) {
          sessionStore.destroy(sid, () => {
            if (--remaining === 0) resolve();
          });
        }
      });
    });
  }

  router.get('/users', async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const status = ['active', 'disabled', 'pending'].includes(req.query.status) ? req.query.status : null;
      const role = ['user', 'admin'].includes(req.query.role) ? req.query.role : null;

      const where = ['u.deleted_at IS NULL'];
      const params = [];
      if (q) {
        where.push('(u.username LIKE ? OR u.email LIKE ? OR u.github_id = ?)');
        params.push(`%${q}%`, `%${q}%`, q);
      }
      if (status) { where.push('u.status = ?'); params.push(status); }
      if (role) { where.push('u.role = ?'); params.push(role); }

      const sql = `
        SELECT u.id, u.github_id, u.username, u.avatar_url, u.email, u.role, u.status,
               u.last_login_at, u.created_at, u.updated_at, u.quota_overrides,
               (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id) AS task_count,
               (SELECT COUNT(*) FROM images i WHERE i.user_id = u.id) AS image_count,
               (SELECT COALESCE(SUM(i.file_size), 0) FROM images i WHERE i.user_id = u.id) AS storage_bytes
        FROM users u
        WHERE ${where.join(' AND ')}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ? OFFSET ?`;

      const [rows] = await db.query(sql, [...params, limit, offset]);

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM users u WHERE ${where.join(' AND ')}`,
        params
      );

      res.json({
        items: rows.map((r) => ({
          ...r,
          quota_overrides: parseJson(r.quota_overrides),
          task_count: Number(r.task_count || 0),
          image_count: Number(r.image_count || 0),
          storage_bytes: Number(r.storage_bytes || 0),
        })),
        total: Number(countRows[0]?.total || 0),
        limit,
        offset,
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin list users error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/users/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [rows] = await db.query(
        `SELECT u.id, u.github_id, u.username, u.avatar_url, u.email, u.role, u.status,
                u.last_login_at, u.created_at, u.updated_at, u.quota_overrides,
                (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id) AS task_count,
                (SELECT COUNT(*) FROM images i WHERE i.user_id = u.id) AS image_count,
                (SELECT COALESCE(SUM(i.file_size), 0) FROM images i WHERE i.user_id = u.id) AS storage_bytes
         FROM users u WHERE u.id = ? AND u.deleted_at IS NULL`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'User not found' });
      const r = rows[0];
      res.json({
        ...r,
        quota_overrides: parseJson(r.quota_overrides),
        task_count: Number(r.task_count || 0),
        image_count: Number(r.image_count || 0),
        storage_bytes: Number(r.storage_bytes || 0),
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin get user error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/users/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { role, status, quota_overrides } = req.body || {};

      if (id === Number(req.adminUser.id)) {
        if (role && role !== 'admin') {
          return res.status(400).json({ error: '不能把自己降级为普通用户' });
        }
        if (status && status !== 'active') {
          return res.status(400).json({ error: '不能修改自己的状态' });
        }
      }

      const [beforeRows] = await db.query(
        'SELECT role, status, quota_overrides FROM users WHERE id = ? AND deleted_at IS NULL',
        [id]
      );
      if (!beforeRows.length) return res.status(404).json({ error: 'User not found' });
      const before = {
        role: beforeRows[0].role,
        status: beforeRows[0].status,
        quota_overrides: parseJson(beforeRows[0].quota_overrides),
      };

      const updates = [];
      const params = [];
      const after = { ...before };
      if (role && ['user', 'admin'].includes(role)) {
        updates.push('role = ?'); params.push(role); after.role = role;
      }
      if (status && ['active', 'disabled', 'pending'].includes(status)) {
        updates.push('status = ?'); params.push(status); after.status = status;
      }
      if (quota_overrides !== undefined) {
        updates.push('quota_overrides = ?');
        params.push(quota_overrides ? JSON.stringify(quota_overrides) : null);
        after.quota_overrides = quota_overrides;
      }
      if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });

      params.push(id);
      await db.query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
        params
      );

      invalidateUserCache(id);
      if (status === 'disabled') {
        destroyUserSessions(id).catch(() => {});
      }

      // 审计：拆分为两个 action 便于查询
      if (role && role !== before.role) {
        logAudit({
          actorId: req.adminUser.id,
          action: 'user.update_role',
          targetType: 'user',
          targetId: String(id),
          beforeValue: { role: before.role },
          afterValue: { role },
          ip: req.ip,
          ua: req.get('user-agent'),
        });
      }
      if (status && status !== before.status) {
        logAudit({
          actorId: req.adminUser.id,
          action: 'user.update_status',
          targetType: 'user',
          targetId: String(id),
          beforeValue: { status: before.status },
          afterValue: { status },
          ip: req.ip,
          ua: req.get('user-agent'),
        });
      }
      if (quota_overrides !== undefined) {
        logAudit({
          actorId: req.adminUser.id,
          action: 'quota.override',
          targetType: 'user',
          targetId: String(id),
          beforeValue: { quota_overrides: before.quota_overrides },
          afterValue: { quota_overrides },
          ip: req.ip,
          ua: req.get('user-agent'),
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin update user error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/users/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (id === Number(req.adminUser.id)) {
        return res.status(400).json({ error: '不能删除自己' });
      }
      const [beforeRows] = await db.query('SELECT username FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!beforeRows.length) return res.status(404).json({ error: 'User not found' });

      await db.query(
        'UPDATE users SET deleted_at = NOW(), status = ? WHERE id = ? AND deleted_at IS NULL',
        ['disabled', id]
      );

      const [taskRows] = await db.query(
        'SELECT id, input_image_ids, output_image_ids FROM tasks WHERE user_id = ?',
        [id]
      );
      await deleteTasksAndUnreferencedImages(taskRows);
      const [imageRows] = await db.query('SELECT id FROM images WHERE user_id = ?', [id]);
      await deleteUnreferencedImages(imageRows.map((row) => row.id));

      invalidateUserCache(id);
      destroyUserSessions(id).catch(() => {});

      logAudit({
        actorId: req.adminUser.id,
        action: 'user.delete',
        targetType: 'user',
        targetId: String(id),
        beforeValue: { username: beforeRows[0].username },
        ip: req.ip,
        ua: req.get('user-agent'),
      });

      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin delete user error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/users/:id/logout', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (id === Number(req.adminUser.id)) {
        return res.status(400).json({ error: '不能强制下线自己' });
      }
      await destroyUserSessions(id);
      logAudit({
        actorId: req.adminUser.id,
        action: 'user.force_logout',
        targetType: 'user',
        targetId: String(id),
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin force logout error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/users/:id/approve', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [result] = await db.query(
        'UPDATE users SET status = ?, updated_at = NOW() WHERE id = ? AND status = ? AND deleted_at IS NULL',
        ['active', id, 'pending']
      );
      if (!result.affectedRows) return res.status(404).json({ error: '用户不存在或不在 pending 状态' });
      invalidateUserCache(id);
      logAudit({
        actorId: req.adminUser.id,
        action: 'user.approve',
        targetType: 'user',
        targetId: String(id),
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin approve user error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/users/:id/quota', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { quota_overrides } = req.body || {};
      const [beforeRows] = await db.query(
        'SELECT quota_overrides FROM users WHERE id = ? AND deleted_at IS NULL',
        [id]
      );
      if (!beforeRows.length) return res.status(404).json({ error: 'User not found' });
      const before = parseJson(beforeRows[0].quota_overrides);

      const value = quota_overrides ? JSON.stringify(quota_overrides) : null;
      await db.query(
        'UPDATE users SET quota_overrides = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL',
        [value, id]
      );
      invalidateUserCache(id);

      logAudit({
        actorId: req.adminUser.id,
        action: 'quota.override',
        targetType: 'user',
        targetId: String(id),
        beforeValue: { quota_overrides: before },
        afterValue: { quota_overrides },
        ip: req.ip,
        ua: req.get('user-agent'),
      });

      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin update quota error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/users/:id/settings', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [rows] = await db.query(
        'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
        [id]
      );
      const row = rows[0] || { api_url: '', api_key: '', settings: null };
      res.json({
        api_url: row.api_url || '',
        api_key: row.api_key || '',
        settings: parseJson(row.settings) || {},
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin get user settings error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/users/:id/settings', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { api_url, api_key, settings } = req.body || {};
      const settingsJson = settings && typeof settings === 'object' ? JSON.stringify(settings) : null;

      const [beforeRows] = await db.query(
        'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
        [id]
      );
      const before = beforeRows[0] ? {
        api_url: beforeRows[0].api_url,
        api_key: beforeRows[0].api_key,
        settings: parseJson(beforeRows[0].settings),
      } : null;

      if (api_key !== undefined) {
        await db.query(
          `INSERT INTO user_settings (user_id, api_url, api_key, settings)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE api_url = ?, api_key = ?, settings = ?, updated_at = NOW()`,
          [id, api_url || null, api_key || null, settingsJson, api_url || null, api_key || null, settingsJson]
        );
      } else {
        await db.query(
          `INSERT INTO user_settings (user_id, api_url, settings)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE api_url = ?, settings = ?, updated_at = NOW()`,
          [id, api_url || null, settingsJson, api_url || null, settingsJson]
        );
      }

      logAudit({
        actorId: req.adminUser.id,
        action: 'user_settings.update',
        targetType: 'user_settings',
        targetId: String(id),
        beforeValue: before,
        afterValue: { api_url, api_key, settings: settings || null },
        ip: req.ip,
        ua: req.get('user-agent'),
      });

      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin update user settings error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/users/:id/profiles', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [rows] = await db.query(
        'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default, created_at, updated_at FROM user_api_profiles WHERE user_id = ? ORDER BY is_default DESC, created_at ASC',
        [id]
      );
      res.json({ profiles: rows.map(profileRowToJson) });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin list profiles error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/users/:id/profiles', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { name, provider, base_url, api_key, model, timeout, api_format, extra, is_default } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name 不能为空' });
      }
      const id = genProfileId();

      // 首条 Profile 自动设默认，避免该用户没有默认 Profile
      const [existing] = await db.query(
        'SELECT COUNT(*) AS count FROM user_api_profiles WHERE user_id = ?',
        [userId]
      );
      const isFirstProfile = Number(existing[0]?.count || 0) === 0;
      const finalIsDefault = is_default || isFirstProfile;

      if (finalIsDefault) {
        await db.query('UPDATE user_api_profiles SET is_default = 0 WHERE user_id = ?', [userId]);
      }
      await db.query(
        `INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, userId,
          name.trim().slice(0, 100),
          typeof provider === 'string' && provider ? provider : 'openai',
          typeof base_url === 'string' ? base_url : '',
          typeof api_key === 'string' ? api_key : '',
          typeof model === 'string' ? model : '',
          Math.max(10, Math.min(3600, Number(timeout) || 600)),
          api_format === 'imagen' ? 'imagen' : 'responses',
          extra && typeof extra === 'object' ? JSON.stringify(extra) : null,
          finalIsDefault ? 1 : 0,
        ]
      );
      logAudit({
        actorId: req.adminUser.id,
        action: 'profile.create',
        targetType: 'api_profile',
        targetId: id,
        afterValue: { user_id: userId, name, provider, base_url, model, is_default: !!finalIsDefault },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true, id });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin create profile error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/users/:id/profiles/:pid', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { pid } = req.params;
      const { name, provider, base_url, api_key, model, timeout, api_format, extra, is_default } = req.body || {};

      const [beforeRows] = await db.query(
        'SELECT name, provider, base_url, model, is_default FROM user_api_profiles WHERE id = ? AND user_id = ?',
        [pid, userId]
      );
      if (!beforeRows.length) return res.status(404).json({ error: 'Profile 不存在' });

      if (is_default === true) {
        await db.query('UPDATE user_api_profiles SET is_default = 0 WHERE user_id = ?', [userId]);
      }

      const updates = [];
      const params = [];
      if (typeof name === 'string' && name.trim()) { updates.push('name = ?'); params.push(name.trim().slice(0, 100)); }
      if (typeof provider === 'string' && provider) { updates.push('provider = ?'); params.push(provider); }
      if (typeof base_url === 'string') { updates.push('base_url = ?'); params.push(base_url); }
      if (typeof api_key === 'string') { updates.push('api_key = ?'); params.push(api_key); }
      if (typeof model === 'string') { updates.push('model = ?'); params.push(model); }
      if (timeout !== undefined) { updates.push('timeout = ?'); params.push(Math.max(10, Math.min(3600, Number(timeout) || 600))); }
      if (api_format !== undefined) { updates.push('api_format = ?'); params.push(api_format === 'imagen' ? 'imagen' : 'responses'); }
      if (extra !== undefined) {
        updates.push('extra_settings = ?');
        params.push(extra && typeof extra === 'object' ? JSON.stringify(extra) : null);
      }
      if (is_default !== undefined) {
        updates.push('is_default = ?');
        params.push(is_default ? 1 : 0);
      }
      if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });

      params.push(pid, userId);
      await db.query(
        `UPDATE user_api_profiles SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        params
      );

      logAudit({
        actorId: req.adminUser.id,
        action: 'profile.update',
        targetType: 'api_profile',
        targetId: pid,
        beforeValue: { user_id: userId, ...beforeRows[0] },
        afterValue: { name, provider, base_url, model, is_default },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin update profile error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/users/:id/profiles/:pid', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { pid } = req.params;
      const [beforeRows] = await db.query(
        'SELECT name, provider FROM user_api_profiles WHERE id = ? AND user_id = ?',
        [pid, userId]
      );
      const [result] = await db.query(
        'DELETE FROM user_api_profiles WHERE id = ? AND user_id = ?',
        [pid, userId]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Profile 不存在' });

      const [defRows] = await db.query(
        'SELECT COUNT(*) AS count FROM user_api_profiles WHERE user_id = ? AND is_default = 1',
        [userId]
      );
      if (defRows[0].count === 0) {
        await db.query(
          'UPDATE user_api_profiles SET is_default = 1 WHERE id = (SELECT id FROM (SELECT id FROM user_api_profiles WHERE user_id = ? ORDER BY created_at ASC LIMIT 1) AS t)',
          [userId]
        );
      }

      logAudit({
        actorId: req.adminUser.id,
        action: 'profile.delete',
        targetType: 'api_profile',
        targetId: pid,
        beforeValue: { user_id: userId, ...(beforeRows[0] || {}) },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin delete profile error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/users/:id/custom-providers', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const [rows] = await db.query(
        'SELECT id, name, template, submit_config, edit_submit_config, poll_config, created_at, updated_at FROM user_custom_providers WHERE user_id = ? ORDER BY created_at ASC',
        [userId]
      );
      res.json({
        providers: rows.map((row) => ({
          id: row.id,
          name: row.name,
          template: row.template,
          submit: parseJson(row.submit_config),
          editSubmit: parseJson(row.edit_submit_config),
          poll: parseJson(row.poll_config),
          created_at: row.created_at,
          updated_at: row.updated_at,
        })),
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin list custom providers error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/users/:id/custom-providers', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { name, template, submit, editSubmit, poll } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name 不能为空' });
      if (!submit || typeof submit !== 'object') return res.status(400).json({ error: 'submit 配置必填' });
      const id = genCustomProviderId();
      await db.query(
        `INSERT INTO user_custom_providers (id, user_id, name, template, submit_config, edit_submit_config, poll_config)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id, userId,
          name.trim().slice(0, 100),
          typeof template === 'string' ? template : 'http-image',
          JSON.stringify(submit),
          editSubmit ? JSON.stringify(editSubmit) : null,
          poll ? JSON.stringify(poll) : null,
        ]
      );
      logAudit({
        actorId: req.adminUser.id,
        action: 'custom_provider.create',
        targetType: 'custom_provider',
        targetId: id,
        afterValue: { user_id: userId, name, template },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true, id });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin create custom provider error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/users/:id/custom-providers/:cpid', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { cpid } = req.params;
      const { name, template, submit, editSubmit, poll } = req.body || {};
      const [beforeRows] = await db.query(
        'SELECT name, template FROM user_custom_providers WHERE id = ? AND user_id = ?',
        [cpid, userId]
      );
      const updates = [];
      const params = [];
      if (typeof name === 'string' && name.trim()) { updates.push('name = ?'); params.push(name.trim().slice(0, 100)); }
      if (typeof template === 'string') { updates.push('template = ?'); params.push(template); }
      if (submit !== undefined) { updates.push('submit_config = ?'); params.push(submit ? JSON.stringify(submit) : null); }
      if (editSubmit !== undefined) { updates.push('edit_submit_config = ?'); params.push(editSubmit ? JSON.stringify(editSubmit) : null); }
      if (poll !== undefined) { updates.push('poll_config = ?'); params.push(poll ? JSON.stringify(poll) : null); }
      if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });
      params.push(cpid, userId);
      const [result] = await db.query(
        `UPDATE user_custom_providers SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        params
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Custom provider 不存在' });
      logAudit({
        actorId: req.adminUser.id,
        action: 'custom_provider.update',
        targetType: 'custom_provider',
        targetId: cpid,
        beforeValue: { user_id: userId, ...(beforeRows[0] || {}) },
        afterValue: { name, template },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin update custom provider error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/users/:id/images', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const source = ['upload', 'generated'].includes(req.query.source) ? req.query.source : null;

      const where = ['user_id = ?', 'deleted_at IS NULL'];
      const params = [userId];
      if (source) { where.push('source = ?'); params.push(source); }

      const [rows] = await db.query(
        `SELECT id, file_url, thumb_url, file_size, mime_type, source, width, height, created_at
         FROM images WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(file_size), 0) AS total_bytes
         FROM images WHERE ${where.join(' AND ')}`,
        params
      );

      res.json({
        items: rows,
        total: Number(countRows[0]?.total || 0),
        total_bytes: Number(countRows[0]?.total_bytes || 0),
        limit,
        offset,
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin list user images error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/users/:id/custom-providers/:cpid', async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { cpid } = req.params;
      const [beforeRows] = await db.query(
        'SELECT name FROM user_custom_providers WHERE id = ? AND user_id = ?',
        [cpid, userId]
      );
      const [result] = await db.query(
        'DELETE FROM user_custom_providers WHERE id = ? AND user_id = ?',
        [cpid, userId]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Custom provider 不存在' });
      logAudit({
        actorId: req.adminUser.id,
        action: 'custom_provider.delete',
        targetType: 'custom_provider',
        targetId: cpid,
        beforeValue: { user_id: userId, ...(beforeRows[0] || {}) },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Admin delete custom provider error:`, error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
