import db from '../db.js';

export function resolveApiSettings(userSettingsRow) {
  const storedSettings = userSettingsRow?.settings
    ? (typeof userSettingsRow.settings === 'string' ? JSON.parse(userSettingsRow.settings) : userSettingsRow.settings)
    : {};

  return {
    baseUrl: userSettingsRow?.api_url || process.env.DEFAULT_API_URL || '',
    apiKey: userSettingsRow?.api_key || process.env.DEFAULT_API_KEY || '',
    model: storedSettings.model || process.env.DEFAULT_MODEL || 'gpt-5.3-codex',
    timeout: Number(storedSettings.timeout || process.env.DEFAULT_TIMEOUT || 600),
    apiFormat: storedSettings.apiFormat || process.env.DEFAULT_API_FORMAT || 'responses',
  };
}

export async function loadUserApiSettings(userId, profileId = null) {
  // 1. 如果指定 profileId，优先从 user_api_profiles 加载该 profile
  if (profileId) {
    const [profileRows] = await db.query(
      'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings FROM user_api_profiles WHERE id = ? AND user_id = ?',
      [profileId, userId]
    );
    if (profileRows.length) return profileRowToSettings(profileRows[0]);
  }

  // 2. 取默认 profile
  const [defaultRows] = await db.query(
    'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings FROM user_api_profiles WHERE user_id = ? AND is_default = 1 ORDER BY created_at ASC LIMIT 1',
    [userId]
  );
  if (defaultRows.length) return profileRowToSettings(defaultRows[0]);

  // 3. 取该用户第一条 profile（如果有的话）
  const [firstRows] = await db.query(
    'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings FROM user_api_profiles WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
    [userId]
  );
  if (firstRows.length) return profileRowToSettings(firstRows[0]);

  // 4. 回退到旧版 user_settings 表（兼容）
  const [rows] = await db.query(
    'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
    [userId]
  );
  return resolveApiSettings(rows[0]);
}

export function profileRowToSettings(row) {
  const extra = row.extra_settings
    ? (typeof row.extra_settings === 'string' ? JSON.parse(row.extra_settings) : row.extra_settings)
    : {};
  return {
    profileId: row.id,
    profileName: row.name,
    provider: row.provider || 'openai',
    baseUrl: row.base_url || process.env.DEFAULT_API_URL || '',
    apiKey: row.api_key || process.env.DEFAULT_API_KEY || '',
    model: row.model || 'gpt-image-1',
    timeout: Number(row.timeout || 600),
    apiFormat: row.api_format || 'responses',
    extra,
  };
}


export function generateProfileId() {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
