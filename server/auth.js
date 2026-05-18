import db from './db.js';

const USER_CACHE_TTL_MS = 30 * 1000;
const userCache = new Map();

export function invalidateUserCache(userId) {
  if (userId == null) {
    userCache.clear();
    return;
  }
  userCache.delete(Number(userId));
}

async function loadUserById(userId) {
  const id = Number(userId);
  const cached = userCache.get(id);
  const now = Date.now();
  if (cached && cached.expireAt > now) return cached.user;

  const [rows] = await db.query(
    'SELECT id, role, status, deleted_at FROM users WHERE id = ?',
    [id]
  );
  const user = rows[0] || null;
  userCache.set(id, { user, expireAt: now + USER_CACHE_TTL_MS });
  return user;
}

function destroySessionAndClear(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
}

export function requireSession(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

export async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const user = await loadUserById(req.session.userId);
    if (!user || user.deleted_at) {
      await destroySessionAndClear(req);
      return res.status(401).json({ error: 'Unauthorized', reason: 'deleted' });
    }
    if (user.status === 'disabled') {
      await destroySessionAndClear(req);
      return res.status(403).json({ error: 'Forbidden', reason: 'disabled' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Forbidden', reason: 'pending' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ requireAuth error:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const user = await loadUserById(req.session.userId);
    if (!user || user.deleted_at) {
      await destroySessionAndClear(req);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (user.role !== 'admin' || user.status !== 'active') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.user = user;
    req.adminUser = user;
    next();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ requireAdmin error:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
