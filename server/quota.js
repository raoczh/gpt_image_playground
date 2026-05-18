import db from './db.js';
import { getSystemConfig } from './systemConfig.js';

function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

async function getUserQuotaOverrides(userId) {
  const [rows] = await db.query(
    'SELECT quota_overrides FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId]
  );
  return parseJson(rows[0]?.quota_overrides) || {};
}

async function resolveLimit(userId, key) {
  const overrides = await getUserQuotaOverrides(userId);
  if (overrides && key in overrides) {
    const v = overrides[key];
    if (v === null) return null;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  const global = await getSystemConfig(key);
  if (global === null || global === undefined) return null;
  if (typeof global === 'number' && Number.isFinite(global) && global >= 0) return global;
  return null;
}

export async function getDailyGenerationCount(userId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE user_id = ? AND deleted_at IS NULL AND created_at >= CURDATE()`,
    [userId]
  );
  return Number(rows[0]?.c || 0);
}

export async function getUserStorageBytes(userId) {
  const [rows] = await db.query(
    `SELECT COALESCE(SUM(file_size), 0) AS total FROM images
     WHERE user_id = ? AND deleted_at IS NULL`,
    [userId]
  );
  return Number(rows[0]?.total || 0);
}

export async function checkDailyGenerationQuota(userId) {
  const limit = await resolveLimit(userId, 'daily_generation_limit');
  if (limit === null) return { ok: true };
  const used = await getDailyGenerationCount(userId);
  if (used >= limit) {
    return { ok: false, code: 'QUOTA_DAILY_EXCEEDED', message: `今日生成次数已达上限 ${limit}`, used, limit };
  }
  return { ok: true, used, limit };
}

export async function checkStorageQuota(userId, addBytes = 0) {
  const limitMb = await resolveLimit(userId, 'user_storage_limit_mb');
  if (limitMb === null) return { ok: true };
  const limit = limitMb * 1024 * 1024;
  const used = await getUserStorageBytes(userId);
  if (used + addBytes > limit) {
    return {
      ok: false,
      code: 'QUOTA_STORAGE_EXCEEDED',
      message: `存储空间已达上限 ${limitMb} MB`,
      used,
      limit,
    };
  }
  return { ok: true, used, limit };
}

export async function getQuotaSummary(userId) {
  const [dailyLimit, storageLimitMb] = await Promise.all([
    resolveLimit(userId, 'daily_generation_limit'),
    resolveLimit(userId, 'user_storage_limit_mb'),
  ]);
  const [used, storageBytes] = await Promise.all([
    getDailyGenerationCount(userId),
    getUserStorageBytes(userId),
  ]);
  return {
    daily: {
      limit: dailyLimit,
      used,
    },
    storage: {
      limit_bytes: storageLimitMb === null ? null : storageLimitMb * 1024 * 1024,
      limit_mb: storageLimitMb,
      used_bytes: storageBytes,
    },
  };
}
