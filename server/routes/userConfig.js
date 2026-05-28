import express from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { generateProfileId, resolveApiSettings } from '../services/apiSettings.js';

const app = express.Router();

// ==================== 用户设置路由 ====================

app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] ⚙️  Get settings - User ID: ${req.session.userId}`);
    const [rows] = await db.query(
      'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
      [req.session.userId]
    );

    const settings = resolveApiSettings(rows[0]);

    // 不返回完整的 API Key，只返回掩码
    const maskedApiKey = settings.apiKey ? '••••••••••••••••' : '';

    res.json({
      api_url: settings.baseUrl,
      api_key: maskedApiKey,
      use_default: !rows[0]?.api_url && !rows[0]?.api_key,
      settings: {
        model: settings.model,
        timeout: settings.timeout,
        apiFormat: settings.apiFormat,
      }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get settings error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/settings', requireAuth, async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 💾 Update settings - User ID: ${req.session.userId}`);
    const { api_url, api_key, use_default, settings } = req.body;

    const finalApiUrl = use_default ? null : api_url;
    const finalApiKey = use_default ? null : api_key;

    // 如果 api_key 未提供（undefined），则不更新它
    if (api_key === undefined) {
      await db.query(
        `INSERT INTO user_settings (user_id, api_url, settings)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE api_url = ?, settings = ?, updated_at = NOW()`,
        [req.session.userId, finalApiUrl, JSON.stringify(settings), finalApiUrl, JSON.stringify(settings)]
      );
    } else {
      await db.query(
        `INSERT INTO user_settings (user_id, api_url, api_key, settings)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE api_url = ?, api_key = ?, settings = ?, updated_at = NOW()`,
        [req.session.userId, finalApiUrl, finalApiKey, JSON.stringify(settings), finalApiUrl, finalApiKey, JSON.stringify(settings)]
      );
    }

    console.log(`[${new Date().toISOString()}] ✅ Settings updated`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update settings error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== 用户偏好（A-6 习惯开关） ====================
// 偏好持久化到 user_settings.settings JSON 的 preferences 子对象
// 与 API 配置（base_url/api_key）分离，避免互相影响
//
// 默认值与前端 DEFAULT_SETTINGS 保持一致；后端只透传，不做业务校验
const PREFERENCE_KEYS = [
  'enterSubmit',
  'clearInputAfterSubmit',
  'persistInputOnRestart',
];

function pickPreferences(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const key of PREFERENCE_KEYS) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
}

app.get('/api/preferences', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = ?',
      [req.session.userId]
    );
    const raw = rows[0]?.settings;
    const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
    const prefs = pickPreferences(parsed?.preferences);
    res.json({ preferences: prefs });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get preferences error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/preferences', requireAuth, async (req, res) => {
  try {
    const incoming = pickPreferences(req.body?.preferences);

    // 读现有 settings JSON，合并 preferences 子对象后写回，避免覆盖其他字段（model/timeout/apiFormat 等历史字段）
    const [rows] = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = ?',
      [req.session.userId]
    );
    const current = rows[0]?.settings
      ? (typeof rows[0].settings === 'string' ? JSON.parse(rows[0].settings) : rows[0].settings)
      : {};
    const next = {
      ...current,
      preferences: { ...(current.preferences || {}), ...incoming },
    };

    await db.query(
      `INSERT INTO user_settings (user_id, settings)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE settings = ?, updated_at = NOW()`,
      [req.session.userId, JSON.stringify(next), JSON.stringify(next)]
    );

    res.json({ success: true, preferences: next.preferences });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update preferences error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== API Profiles 路由 ====================

function maskApiKey(key) {
  return key ? '••••••••••••••••' : '';
}

function profileRowToJson(row) {
  const extra = row.extra_settings
    ? (typeof row.extra_settings === 'string' ? JSON.parse(row.extra_settings) : row.extra_settings)
    : {};
  return {
    id: row.id,
    name: row.name,
    provider: row.provider || 'openai',
    base_url: row.base_url || '',
    api_key_masked: maskApiKey(row.api_key),
    model: row.model || '',
    timeout: Number(row.timeout || 600),
    api_format: row.api_format || 'responses',
    extra,
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

app.get('/api/profiles', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default, created_at, updated_at FROM user_api_profiles WHERE user_id = ? ORDER BY is_default DESC, created_at ASC',
      [req.session.userId]
    );

    // 如果该用户还没有 profile，但 user_settings 表有旧记录，自动迁移一条默认 profile
    if (!rows.length) {
      const [legacyRows] = await db.query(
        'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
        [req.session.userId]
      );
      if (legacyRows.length) {
        const legacy = legacyRows[0];
        const settings = legacy.settings
          ? (typeof legacy.settings === 'string' ? JSON.parse(legacy.settings) : legacy.settings)
          : {};
        const id = `default-${req.session.userId}`;
        await db.query(
          `INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            id,
            req.session.userId,
            '默认',
            'openai',
            legacy.api_url || '',
            legacy.api_key || '',
            settings.model || 'gpt-image-1',
            Number(settings.timeout || 600),
            settings.apiFormat || 'responses',
          ]
        );
        return res.json({
          profiles: [
            {
              id,
              name: '默认',
              provider: 'openai',
              base_url: legacy.api_url || '',
              api_key_masked: maskApiKey(legacy.api_key),
              model: settings.model || 'gpt-image-1',
              timeout: Number(settings.timeout || 600),
              api_format: settings.apiFormat || 'responses',
              extra: {},
              is_default: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        });
      }
    }

    res.json({ profiles: rows.map(profileRowToJson) });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get profiles error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/profiles', requireAuth, async (req, res) => {
  try {
    const { name, provider, base_url, api_key, model, timeout, api_format, extra, is_default } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name 不能为空' });
    }
    const id = generateProfileId();
    const profile = {
      id,
      name: name.trim().slice(0, 100),
      provider: typeof provider === 'string' && provider ? provider : 'openai',
      base_url: typeof base_url === 'string' ? base_url : '',
      api_key: typeof api_key === 'string' ? api_key : '',
      model: typeof model === 'string' ? model : '',
      timeout: Math.max(10, Math.min(3600, Number(timeout) || 600)),
      api_format: api_format === 'imagen' ? 'imagen' : 'responses',
      extra_settings: extra && typeof extra === 'object' ? JSON.stringify(extra) : null,
      is_default: is_default ? 1 : 0,
    };

    if (profile.is_default) {
      await db.query('UPDATE user_api_profiles SET is_default = 0 WHERE user_id = ?', [req.session.userId]);
    }

    await db.query(
      `INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        req.session.userId,
        profile.name,
        profile.provider,
        profile.base_url,
        profile.api_key,
        profile.model,
        profile.timeout,
        profile.api_format,
        profile.extra_settings,
        profile.is_default,
      ]
    );

    res.json({ success: true, id });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Create profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, provider, base_url, api_key, model, timeout, api_format, extra } = req.body || {};

    const updates = [];
    const params = [];
    if (typeof name === 'string' && name.trim()) {
      updates.push('name = ?');
      params.push(name.trim().slice(0, 100));
    }
    if (typeof provider === 'string' && provider) {
      updates.push('provider = ?');
      params.push(provider);
    }
    if (typeof base_url === 'string') {
      updates.push('base_url = ?');
      params.push(base_url);
    }
    if (typeof api_key === 'string') {
      updates.push('api_key = ?');
      params.push(api_key);
    }
    if (typeof model === 'string') {
      updates.push('model = ?');
      params.push(model);
    }
    if (timeout !== undefined) {
      updates.push('timeout = ?');
      params.push(Math.max(10, Math.min(3600, Number(timeout) || 600)));
    }
    if (api_format !== undefined) {
      updates.push('api_format = ?');
      params.push(api_format === 'imagen' ? 'imagen' : 'responses');
    }
    if (extra !== undefined) {
      updates.push('extra_settings = ?');
      params.push(extra && typeof extra === 'object' ? JSON.stringify(extra) : null);
    }

    if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });

    params.push(id, req.session.userId);
    const [result] = await db.query(
      `UPDATE user_api_profiles SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Profile 不存在' });

    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    // 不允许删掉最后一个 profile
    const [rows] = await db.query('SELECT COUNT(*) AS count FROM user_api_profiles WHERE user_id = ?', [req.session.userId]);
    if (rows[0].count <= 1) {
      return res.status(400).json({ error: '至少保留一个 Profile' });
    }
    const [result] = await db.query('DELETE FROM user_api_profiles WHERE id = ? AND user_id = ?', [id, req.session.userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Profile 不存在' });

    // 如果删的是默认 profile，把第一条变成默认
    const [defRows] = await db.query('SELECT COUNT(*) AS count FROM user_api_profiles WHERE user_id = ? AND is_default = 1', [req.session.userId]);
    if (defRows[0].count === 0) {
      await db.query(
        'UPDATE user_api_profiles SET is_default = 1 WHERE id = (SELECT id FROM (SELECT id FROM user_api_profiles WHERE user_id = ? ORDER BY created_at ASC LIMIT 1) AS t)',
        [req.session.userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Delete profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/profiles/:id/default', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE user_api_profiles SET is_default = 0 WHERE user_id = ?', [req.session.userId]);
    const [result] = await db.query(
      'UPDATE user_api_profiles SET is_default = 1 WHERE id = ? AND user_id = ?',
      [id, req.session.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Profile 不存在' });
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Set default profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== Custom Providers 路由 ====================

app.get('/api/custom-providers', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, template, submit_config, edit_submit_config, poll_config, created_at, updated_at FROM user_custom_providers WHERE user_id = ? ORDER BY created_at ASC',
      [req.session.userId]
    );
    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      template: row.template,
      submit: row.submit_config ? (typeof row.submit_config === 'string' ? JSON.parse(row.submit_config) : row.submit_config) : null,
      editSubmit: row.edit_submit_config ? (typeof row.edit_submit_config === 'string' ? JSON.parse(row.edit_submit_config) : row.edit_submit_config) : null,
      poll: row.poll_config ? (typeof row.poll_config === 'string' ? JSON.parse(row.poll_config) : row.poll_config) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    res.json({ providers: items });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get custom providers error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/custom-providers', requireAuth, async (req, res) => {
  try {
    const { name, template, submit, editSubmit, poll } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name 不能为空' });
    if (!submit || typeof submit !== 'object') return res.status(400).json({ error: 'submit 配置必填' });
    const id = `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await db.query(
      `INSERT INTO user_custom_providers (id, user_id, name, template, submit_config, edit_submit_config, poll_config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.session.userId,
        name.trim().slice(0, 100),
        typeof template === 'string' ? template : 'http-image',
        JSON.stringify(submit),
        editSubmit ? JSON.stringify(editSubmit) : null,
        poll ? JSON.stringify(poll) : null,
      ]
    );
    res.json({ success: true, id });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Create custom provider error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/custom-providers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, template, submit, editSubmit, poll } = req.body || {};
    const updates = [];
    const params = [];
    if (typeof name === 'string' && name.trim()) { updates.push('name = ?'); params.push(name.trim().slice(0, 100)); }
    if (typeof template === 'string') { updates.push('template = ?'); params.push(template); }
    if (submit !== undefined) { updates.push('submit_config = ?'); params.push(submit ? JSON.stringify(submit) : null); }
    if (editSubmit !== undefined) { updates.push('edit_submit_config = ?'); params.push(editSubmit ? JSON.stringify(editSubmit) : null); }
    if (poll !== undefined) { updates.push('poll_config = ?'); params.push(poll ? JSON.stringify(poll) : null); }
    if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });
    params.push(id, req.session.userId);
    const [result] = await db.query(
      `UPDATE user_custom_providers SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Custom provider 不存在' });
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update custom provider error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/custom-providers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM user_custom_providers WHERE id = ? AND user_id = ?', [id, req.session.userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Custom provider 不存在' });
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Delete custom provider error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
