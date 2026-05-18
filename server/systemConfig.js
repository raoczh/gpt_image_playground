import db from './db.js';

const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

export function invalidateConfigCache(key) {
  if (key == null) {
    cache.clear();
    return;
  }
  cache.delete(key);
}

export async function getSystemConfig(key) {
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expireAt > now) return cached.value;

  const [rows] = await db.query(
    'SELECT config_value FROM system_config WHERE config_key = ?',
    [key]
  );
  const value = rows.length ? parseJson(rows[0].config_value) : null;
  cache.set(key, { value, expireAt: now + CACHE_TTL_MS });
  return value;
}

export async function getAllSystemConfig() {
  const [rows] = await db.query('SELECT config_key, config_value, updated_at FROM system_config');
  const result = {};
  for (const r of rows) {
    result[r.config_key] = {
      value: parseJson(r.config_value),
      updated_at: r.updated_at,
    };
  }
  return result;
}

export async function setSystemConfig(key, value, actorId = null) {
  await db.query(
    `INSERT INTO system_config (config_key, config_value, updated_by)
     VALUES (?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE config_value = CAST(? AS JSON), updated_by = ?, updated_at = NOW()`,
    [key, JSON.stringify(value), actorId, JSON.stringify(value), actorId]
  );
  invalidateConfigCache(key);
}
