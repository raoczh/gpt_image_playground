import path from 'path';
import fs from 'fs/promises';
import db from '../db.js';
import {
  deleteImageRowsAndFiles,
  deleteTasksAndUnreferencedImages,
  writeThumbnail,
} from '../services/imageStorage.js';

// 启动时为历史图片补缩略图（thumb_url IS NULL），并发限制 4
async function backfillThumbnails() {
  const [rows] = await db.query(
    'SELECT id, file_path FROM images WHERE thumb_url IS NULL'
  );
  if (rows.length === 0) {
    console.log(`[${new Date().toISOString()}] 🖼️  Thumbnail backfill: nothing to do`);
    return;
  }
  console.log(`[${new Date().toISOString()}] 🖼️  Backfilling ${rows.length} thumbnails...`);

  const CONCURRENCY = 4;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      try {
        const buffer = await fs.readFile(row.file_path);
        const { thumbPath, thumbUrl } = await writeThumbnail(buffer, row.id, path.dirname(row.file_path));
        if (!thumbUrl) {
          fail++;
          return;
        }
        await db.query('UPDATE images SET thumb_path = ?, thumb_url = ? WHERE id = ?', [thumbPath, thumbUrl, row.id]);
        ok++;
      } catch (err) {
        console.error(`[${new Date().toISOString()}] ⚠️  Backfill failed for ${row.id}: ${err.message}`);
        fail++;
      }
    }));
  }
  console.log(`[${new Date().toISOString()}] ✅ Backfill done: ${ok} success, ${fail} failed`);
}

const ERROR_TASK_RETAIN_DAYS = 5;
const NORMAL_TASK_RETAIN_DAYS = 15;

async function columnExists(tableName, columnName) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function dropColumnIndexes(tableName, columnName) {
  const [rows] = await db.query(
    `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND INDEX_NAME <> 'PRIMARY'`,
    [tableName, columnName]
  );
  for (const row of rows) {
    try {
      await db.query(`ALTER TABLE ${tableName} DROP INDEX ${row.INDEX_NAME}`);
    } catch (err) {
      console.warn(`[${new Date().toISOString()}] ⚠️  Drop index ${tableName}.${row.INDEX_NAME} failed: ${err.message}`);
    }
  }
}

async function dropColumnIfExists(tableName, columnName) {
  if (!(await columnExists(tableName, columnName))) return;
  await dropColumnIndexes(tableName, columnName);
  await db.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  console.log(`[${new Date().toISOString()}] 🧹 Dropped legacy ${tableName}.${columnName}`);
}

// 启动时迁移旧软删除数据：先物理清理遗留记录，再移除 tasks/images.deleted_at 列。
async function cleanupLegacySoftDeletedAndDropColumns() {
  const hasTaskDeletedAt = await columnExists('tasks', 'deleted_at');
  if (hasTaskDeletedAt) {
    const [taskRows] = await db.query(
      'SELECT id, input_image_ids, output_image_ids FROM tasks WHERE deleted_at IS NOT NULL'
    );
    if (taskRows.length > 0) {
      const result = await deleteTasksAndUnreferencedImages(taskRows);
      console.log(`[${new Date().toISOString()}] 🧹 Removed ${result.deletedTaskCount} legacy soft-deleted task(s), ${result.images.deleted} image(s)`);
    }
  }

  const hasImageDeletedAt = await columnExists('images', 'deleted_at');
  if (hasImageDeletedAt) {
    const [imageRows] = await db.query(
      'SELECT id, file_path, thumb_path FROM images WHERE deleted_at IS NOT NULL'
    );
    if (imageRows.length > 0) {
      const result = await deleteImageRowsAndFiles(imageRows);
      console.log(`[${new Date().toISOString()}] 🧹 Removed ${result.deleted} legacy soft-deleted image(s)`);
    }
  }

  await dropColumnIfExists('tasks', 'deleted_at');
  await dropColumnIfExists('images', 'deleted_at');
}

async function cleanupOldTasks() {
  const [taskRows] = await db.query(
    `SELECT id, input_image_ids, output_image_ids FROM tasks
     WHERE COALESCE(is_favorite, 0) = 0
       AND (
         (status = 'error' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY))
         OR (status <> 'error' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY))
       )`,
    [ERROR_TASK_RETAIN_DAYS, NORMAL_TASK_RETAIN_DAYS]
  );
  if (taskRows.length === 0) {
    console.log(`[${new Date().toISOString()}] 🧹 Old task cleanup: nothing to do`);
    return;
  }
  const result = await deleteTasksAndUnreferencedImages(taskRows);
  console.log(`[${new Date().toISOString()}] 🧹 Removed ${result.deletedTaskCount} old task(s), ${result.images.deleted} unreferenced image(s)`);
}

// 启动时扫一次磁盘孤儿文件：磁盘上有但 DB 完全没记录的文件直接 unlink。
// 本函数清"DB 从未引用过"的真孤儿（来自部分失败、历史脏数据、手动放进的文件等）。
async function cleanupOrphanFiles() {
  const uploadDir = process.env.IMAGE_UPLOAD_DIR || '/data/images';
  let diskFiles;
  try {
    diskFiles = await fs.readdir(uploadDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[${new Date().toISOString()}] 🧹 Orphan scan: upload dir does not exist yet`);
      return;
    }
    throw err;
  }
  if (diskFiles.length === 0) {
    console.log(`[${new Date().toISOString()}] 🧹 Orphan scan: empty dir`);
    return;
  }

  // 有效集合 = DB 中所有行引用过的 file_path / thumb_path。
  const [rows] = await db.query('SELECT file_path, thumb_path FROM images');
  const validPaths = new Set();
  for (const row of rows) {
    if (row.file_path) validPaths.add(path.resolve(row.file_path));
    if (row.thumb_path) validPaths.add(path.resolve(row.thumb_path));
  }

  console.log(`[${new Date().toISOString()}] 🧹 Orphan scan: ${diskFiles.length} files on disk, ${validPaths.size} referenced in DB`);

  let purged = 0;
  let kept = 0;
  let skipped = 0;
  for (const name of diskFiles) {
    const full = path.resolve(path.join(uploadDir, name));
    if (validPaths.has(full)) {
      kept++;
      continue;
    }
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) {
        skipped++;
        continue;
      }
      await fs.unlink(full);
      purged++;
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ⚠️  Orphan unlink failed for ${name}: ${err.message}`);
    }
  }
  console.log(`[${new Date().toISOString()}] ✅ Orphan scan done: ${purged} purged, ${kept} kept, ${skipped} skipped (non-file)`);
}

// 启动时 + 每小时扫描 zombie task：status='running' 且创建超过 STUCK_TASK_TIMEOUT_MIN 分钟。
// 出现场景：前端断网 → /api/generate 也没机会执行（task 创建但生成请求没发出），或者
//   服务端 /api/generate 进程崩了。把这些 task 标记为 error，前端拉取时能看到正确状态。
const STUCK_TASK_TIMEOUT_MIN = 30;
const STUCK_TASK_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

async function cleanupStuckTasks() {
  const [result] = await db.query(
    `UPDATE tasks
     SET status = 'error',
         error_message = COALESCE(error_message, ?),
         finished_at = COALESCE(finished_at, UNIX_TIMESTAMP(NOW()) * 1000)
     WHERE status = 'running'
       AND started_at < (UNIX_TIMESTAMP(NOW()) * 1000 - ? * 60 * 1000)`,
    ['生成超时（服务端检测）', STUCK_TASK_TIMEOUT_MIN]
  );
  if (result.affectedRows > 0) {
    console.log(`[${new Date().toISOString()}] 🧟 Cleaned ${result.affectedRows} stuck task(s) running > ${STUCK_TASK_TIMEOUT_MIN}min`);
  }
}

function scheduleNextMidnightCleanup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const delay = Math.max(1000, next.getTime() - now.getTime());
  const timer = setTimeout(async () => {
    try {
      await cleanupOldTasks();
      await cleanupOrphanFiles();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ❌ Midnight cleanup error:`, err.message);
    } finally {
      scheduleNextMidnightCleanup();
    }
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[${new Date().toISOString()}] 🕛 Next cleanup scheduled at ${next.toLocaleString()}`);
  return timer;
}


export {
  backfillThumbnails,
  cleanupLegacySoftDeletedAndDropColumns,
  cleanupOldTasks,
  cleanupOrphanFiles,
  cleanupStuckTasks,
  scheduleNextMidnightCleanup,
  STUCK_TASK_CHECK_INTERVAL_MS,
};
