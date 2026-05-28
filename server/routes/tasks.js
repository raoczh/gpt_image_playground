import express from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { logAudit } from '../audit.js';
import { assertTaskAccess } from '../services/access.js';

const app = express.Router();

// ==================== 任务路由 ====================

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    // 分页：cursor 是上一页最后一条 (created_at, id) 的 base64 JSON；首页留空
    // 过滤：q 模糊匹配 prompt（前后 %）；status 取 'all' | 'running' | 'done' | 'error'
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = ['running', 'done', 'error'].includes(req.query.status) ? req.query.status : 'all';
    const onlyFavorite = req.query.favorite === '1' || req.query.favorite === 'true';

    // admin 可以通过 ?userId= 查别人的任务，?userId=all 查全部用户
    let targetUserId = Number(req.session.userId);
    let allUsers = false;
    if (req.query.userId !== undefined) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (req.query.userId === 'all') {
        allUsers = true;
      } else {
        const parsed = Number(req.query.userId);
        if (!Number.isFinite(parsed)) return res.status(400).json({ error: 'Invalid userId' });
        targetUserId = parsed;
      }
    }

    let cursorTs = null;
    let cursorId = null;
    if (req.query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(String(req.query.cursor), 'base64').toString('utf8'));
        if (decoded && decoded.ts && decoded.id) {
          cursorTs = new Date(decoded.ts);
          cursorId = String(decoded.id);
        }
      } catch {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
    }

    console.log(`[${new Date().toISOString()}] 📋 Get tasks - User: ${req.session.userId}, target=${allUsers ? 'all' : targetUserId}, q="${q}", status=${status}, limit=${limit}, cursor=${cursorTs ? 'yes' : 'no'}`);

    const where = ['t.deleted_at IS NULL'];
    const params = [];
    if (!allUsers) {
      where.push('t.user_id = ?');
      params.push(targetUserId);
    }
    if (status !== 'all') {
      where.push('t.status = ?');
      params.push(status);
    }
    if (onlyFavorite) {
      where.push('t.is_favorite = 1');
    }
    if (q) {
      where.push('t.prompt LIKE ?');
      params.push(`%${q}%`);
    }
    if (cursorTs && cursorId) {
      where.push('(t.created_at < ? OR (t.created_at = ? AND t.id < ?))');
      params.push(cursorTs, cursorTs, cursorId);
    }

    const sql = `SELECT t.*, u.username AS owner_username, u.avatar_url AS owner_avatar_url
                 FROM tasks t LEFT JOIN users u ON u.id = t.user_id
                 WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`;
    const [rows] = await db.query(sql, [...params, limit + 1]);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    console.log(`[${new Date().toISOString()}] 📊 Found ${pageRows.length} tasks (hasMore=${hasMore})`);

    const parsedRows = pageRows.map(task => {
      const inputImageIds = typeof task.input_image_ids === 'string' ? JSON.parse(task.input_image_ids) : task.input_image_ids;
      const outputImageIds = typeof task.output_image_ids === 'string' ? JSON.parse(task.output_image_ids) : task.output_image_ids;
      return { task, inputImageIds: inputImageIds || [], outputImageIds: outputImageIds || [] };
    });

    const allImageIds = new Set();
    for (const { inputImageIds, outputImageIds } of parsedRows) {
      for (const id of inputImageIds) allImageIds.add(id);
      for (const id of outputImageIds) allImageIds.add(id);
    }

    // admin 跨用户查看时图片可能不属于当前 session，按图片自身 user_id 检索
    const imageMap = new Map();
    if (allImageIds.size > 0) {
      const imageWhere = ['id IN (?)', 'deleted_at IS NULL'];
      const imageParams = [Array.from(allImageIds)];
      if (req.user.role !== 'admin') {
        imageWhere.push('user_id = ?');
        imageParams.push(req.session.userId);
      }
      const [images] = await db.query(
        `SELECT id, file_url, thumb_url, width, height FROM images WHERE ${imageWhere.join(' AND ')}`,
        imageParams
      );
      for (const img of images) imageMap.set(img.id, { url: img.file_url, thumb: img.thumb_url || '', width: img.width || null, height: img.height || null });
    }

    const items = parsedRows.map(({ task, inputImageIds, outputImageIds }) => {
      const inputImageUrls = inputImageIds.map(id => imageMap.get(id)?.url || '');
      const outputImageUrls = outputImageIds.map(id => imageMap.get(id)?.url || '');
      const inputThumbUrls = inputImageIds.map(id => imageMap.get(id)?.thumb || '');
      const outputThumbUrls = outputImageIds.map(id => imageMap.get(id)?.thumb || '');
      const outputImageDims = outputImageIds.map(id => {
        const img = imageMap.get(id);
        if (img && img.width && img.height) return { w: img.width, h: img.height };
        return null;
      });

      const parseJson = (v) => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string') {
          try { return JSON.parse(v); } catch { return null; }
        }
        return v;
      };

      const { owner_username, owner_avatar_url, ...rest } = task;
      return {
        ...rest,
        params: typeof task.params === 'string' ? JSON.parse(task.params) : task.params,
        actual_params: parseJson(task.actual_params),
        revised_prompt_by_image: parseJson(task.revised_prompt_by_image),
        raw_image_urls: parseJson(task.raw_image_urls),
        request_meta: parseJson(task.request_meta),
        input_image_ids: inputImageIds,
        output_image_ids: outputImageIds,
        input_image_urls: inputImageUrls,
        output_image_urls: outputImageUrls,
        input_thumb_urls: inputThumbUrls,
        output_thumb_urls: outputThumbUrls,
        output_image_dims: outputImageDims,
        owner: { id: task.user_id, username: owner_username || '', avatar_url: owner_avatar_url || '' },
      };
    });

    let nextCursor = null;
    if (hasMore && items.length > 0) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ ts: new Date(last.created_at).toISOString(), id: last.id })).toString('base64');
    }

    res.json({ items, nextCursor });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get tasks error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const { id, prompt, params, input_image_ids, started_at } = req.body;
    console.log(`[${new Date().toISOString()}] ➕ Create task - User ID: ${req.session.userId}, Task ID: ${id}, Prompt: "${prompt?.substring(0, 50)}..."`);

    await db.query(
      'INSERT INTO tasks (id, user_id, prompt, status, params, input_image_ids, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.session.userId, prompt, 'running', JSON.stringify(params), JSON.stringify(input_image_ids || []), started_at]
    );

    console.log(`[${new Date().toISOString()}] ✅ Task created - Task ID: ${id}`);
    res.json({ success: true, id });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Create task error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, error_message, output_image_ids, finished_at } = req.body;

    const access = await assertTaskAccess(id, req);
    if (!access) return res.status(404).json({ error: 'Task not found' });

    await db.query(
      'UPDATE tasks SET status = ?, error_message = ?, output_image_ids = ?, finished_at = ? WHERE id = ?',
      [status, error_message, JSON.stringify(output_image_ids || []), finished_at, id]
    );

    if (access.isAdminAccess) {
      logAudit({
        actorId: req.user.id,
        action: 'task.update_other_user',
        targetType: 'task',
        targetId: id,
        beforeValue: { owner_id: access.ownerId },
        afterValue: { status, error_message: error_message ? '...' : null, finished_at },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update task error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/tasks/:id/favorite', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const next = req.body && req.body.isFavorite ? 1 : 0;

    const access = await assertTaskAccess(id, req);
    if (!access) return res.status(404).json({ error: 'Task not found' });

    await db.query(
      'UPDATE tasks SET is_favorite = ? WHERE id = ? AND deleted_at IS NULL',
      [next, id]
    );

    if (access.isAdminAccess) {
      logAudit({
        actorId: req.user.id,
        action: 'task.update_other_user',
        targetType: 'task',
        targetId: id,
        beforeValue: { owner_id: access.ownerId },
        afterValue: { is_favorite: !!next },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
    }

    res.json({ success: true, isFavorite: Boolean(next) });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Toggle favorite error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/tasks/batch-delete', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.taskIds)
      ? req.body.taskIds.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 500)
      : [];
    if (!ids.length) return res.status(400).json({ error: 'taskIds is required' });

    const isAdmin = req.user.role === 'admin';
    console.log(`[${new Date().toISOString()}] 🗑️  Batch delete - User ID: ${req.session.userId}, count=${ids.length}, admin=${isAdmin}`);

    // 普通用户只能删自己的；admin 可以删任意用户的（按 ids 命中）
    const taskWhereSql = isAdmin
      ? 'id IN (?) AND deleted_at IS NULL'
      : 'id IN (?) AND user_id = ? AND deleted_at IS NULL';
    const taskWhereParams = isAdmin ? [ids] : [ids, req.session.userId];
    const [taskRows] = await db.query(
      `SELECT id, user_id, input_image_ids, output_image_ids FROM tasks WHERE ${taskWhereSql}`,
      taskWhereParams
    );

    if (!taskRows.length) {
      return res.json({ success: true, deletedCount: 0 });
    }

    const targetIds = taskRows.map((t) => t.id);
    const ownerIds = new Set(taskRows.map((t) => Number(t.user_id)));
    const targetImageIds = new Set();
    for (const t of taskRows) {
      const ii = typeof t.input_image_ids === 'string' ? JSON.parse(t.input_image_ids) : (t.input_image_ids || []);
      const oi = typeof t.output_image_ids === 'string' ? JSON.parse(t.output_image_ids) : (t.output_image_ids || []);
      for (const id of (ii || [])) targetImageIds.add(id);
      for (const id of (oi || [])) targetImageIds.add(id);
    }

    await db.query(
      `UPDATE tasks SET deleted_at = NOW() WHERE id IN (?)`,
      [targetIds]
    );

    if (targetImageIds.size > 0) {
      // 各 owner 各自检查孤立图片
      for (const ownerId of ownerIds) {
        const [otherTasks] = await db.query(
          'SELECT input_image_ids, output_image_ids FROM tasks WHERE user_id = ? AND deleted_at IS NULL',
          [ownerId]
        );
        const stillReferenced = new Set();
        for (const t of otherTasks) {
          const ii = typeof t.input_image_ids === 'string' ? JSON.parse(t.input_image_ids) : (t.input_image_ids || []);
          const oi = typeof t.output_image_ids === 'string' ? JSON.parse(t.output_image_ids) : (t.output_image_ids || []);
          for (const imgId of (ii || [])) stillReferenced.add(imgId);
          for (const imgId of (oi || [])) stillReferenced.add(imgId);
        }
        const orphans = Array.from(targetImageIds).filter((imgId) => !stillReferenced.has(imgId));
        if (orphans.length > 0) {
          await db.query(
            'UPDATE images SET deleted_at = NOW() WHERE id IN (?) AND user_id = ? AND deleted_at IS NULL',
            [orphans, ownerId]
          );
        }
      }
    }

    // M8: admin 跨用户批量删除审计
    const adminActorId = req.user.role === 'admin' ? req.user.id : null;
    if (adminActorId) {
      const otherTaskIds = taskRows
        .filter((t) => Number(t.user_id) !== Number(req.user.id))
        .map((t) => t.id);
      if (otherTaskIds.length > 0) {
        logAudit({
          actorId: adminActorId,
          action: 'task.batch_delete_other_user',
          targetType: 'task',
          targetId: null,
          beforeValue: {
            count: otherTaskIds.length,
            task_ids: otherTaskIds,
            owners: Array.from(ownerIds).filter((o) => o !== Number(req.user.id)),
          },
          ip: req.ip,
          ua: req.get('user-agent'),
        });
      }
    }

    res.json({ success: true, deletedCount: targetIds.length });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Batch delete error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const access = await assertTaskAccess(id, req);
    if (!access) return res.status(404).json({ error: 'Task not found' });
    const { ownerId, isAdminAccess } = access;

    const [taskRows] = await db.query(
      'SELECT input_image_ids, output_image_ids FROM tasks WHERE id = ? AND deleted_at IS NULL',
      [id]
    );

    await db.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id = ?',
      [id]
    );

    if (taskRows.length > 0) {
      const task = taskRows[0];
      const inputIds = typeof task.input_image_ids === 'string' ? JSON.parse(task.input_image_ids) : (task.input_image_ids || []);
      const outputIds = typeof task.output_image_ids === 'string' ? JSON.parse(task.output_image_ids) : (task.output_image_ids || []);
      const allImageIds = [...new Set([...(inputIds || []), ...(outputIds || [])])];

      if (allImageIds.length > 0) {
        const [otherTasks] = await db.query(
          'SELECT input_image_ids, output_image_ids FROM tasks WHERE user_id = ? AND deleted_at IS NULL',
          [ownerId]
        );

        const stillReferenced = new Set();
        for (const t of otherTasks) {
          const ii = typeof t.input_image_ids === 'string' ? JSON.parse(t.input_image_ids) : (t.input_image_ids || []);
          const oi = typeof t.output_image_ids === 'string' ? JSON.parse(t.output_image_ids) : (t.output_image_ids || []);
          for (const imgId of (ii || [])) stillReferenced.add(imgId);
          for (const imgId of (oi || [])) stillReferenced.add(imgId);
        }

        const orphanIds = allImageIds.filter(imgId => !stillReferenced.has(imgId));
        if (orphanIds.length > 0) {
          await db.query(
            'UPDATE images SET deleted_at = NOW() WHERE id IN (?) AND user_id = ? AND deleted_at IS NULL',
            [orphanIds, ownerId]
          );
        }
      }
    }

    // M8: 跨用户任务删除审计
    if (isAdminAccess) {
      logAudit({
        actorId: req.user.id,
        action: 'task.delete_other_user',
        targetType: 'task',
        targetId: id,
        beforeValue: { owner_id: ownerId },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Delete task error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/tasks', requireAuth, async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 🗑️  Clear all tasks - User ID: ${req.session.userId}`);
    const [result] = await db.query('UPDATE tasks SET deleted_at = NOW() WHERE user_id = ? AND deleted_at IS NULL', [req.session.userId]);
    // 同步软删除该用户的所有图片
    const [imgResult] = await db.query(
      'UPDATE images SET deleted_at = NOW() WHERE user_id = ? AND deleted_at IS NULL',
      [req.session.userId]
    );
    console.log(`[${new Date().toISOString()}] ✅ Cleared ${result.affectedRows} tasks, ${imgResult.affectedRows} images`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Clear tasks error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
