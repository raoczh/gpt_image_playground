import db from '../db.js';

// admin 跨用户直通：任意写/读操作允许 admin 操作其他用户的资源
// helper：返回 { ownerId, isAdminAccess } 或 null
export async function assertTaskAccess(taskId, req) {
  const [rows] = await db.query(
    'SELECT user_id FROM tasks WHERE id = ?',
    [taskId]
  );
  if (!rows.length) return null;
  const ownerId = Number(rows[0].user_id);
  const isOwner = ownerId === Number(req.user.id);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) return null;
  return { ownerId, isAdminAccess: !isOwner && isAdmin };
}

export async function assertImageAccess(imageId, req) {
  const [rows] = await db.query(
    'SELECT user_id FROM images WHERE id = ?',
    [imageId]
  );
  if (!rows.length) return null;
  const ownerId = Number(rows[0].user_id);
  const isOwner = ownerId === Number(req.user.id);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) return null;
  return { ownerId, isAdminAccess: !isOwner && isAdmin };
}
