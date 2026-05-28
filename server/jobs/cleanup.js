import path from 'path';
import fs from 'fs/promises';
import db from '../db.js';
import { writeThumbnail } from '../services/imageStorage.js';

// 启动时为历史图片补缩略图（thumb_url IS NULL），并发限制 4
async function backfillThumbnails() {
  const [rows] = await db.query(
    "SELECT id, file_path FROM images WHERE thumb_url IS NULL AND deleted_at IS NULL"
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

// 物理清理：把 deleted_at 超过 SOFT_DELETE_RETAIN_DAYS 天的 images 行真正删除并清磁盘文件，
// 同时硬删过期的 tasks 行。失败单条跳过、记日志，不抛错（被定时器 catch 即可）。
const SOFT_DELETE_RETAIN_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function cleanupSoftDeleted() {
  // 1) 物理清理图片
  const [imgRows] = await db.query(
    'SELECT id, file_path, thumb_path FROM images WHERE deleted_at IS NOT NULL AND deleted_at < (NOW() - INTERVAL ? DAY)',
    [SOFT_DELETE_RETAIN_DAYS]
  );
  if (imgRows.length === 0) {
    console.log(`[${new Date().toISOString()}] 🧹 Image cleanup: nothing to do`);
  } else {
    console.log(`[${new Date().toISOString()}] 🧹 Purging ${imgRows.length} images soft-deleted > ${SOFT_DELETE_RETAIN_DAYS}d...`);
    let ok = 0;
    let fail = 0;
    for (const row of imgRows) {
      try {
        await fs.unlink(row.file_path).catch(() => {});
        if (row.thumb_path) await fs.unlink(row.thumb_path).catch(() => {});
        await db.query('DELETE FROM images WHERE id = ?', [row.id]);
        ok++;
      } catch (err) {
        console.error(`[${new Date().toISOString()}] ⚠️  Image purge failed for ${row.id}: ${err.message}`);
        fail++;
      }
    }
    console.log(`[${new Date().toISOString()}] ✅ Image purge done: ${ok} purged, ${fail} failed`);
  }

  // 2) 硬删过期任务行（无物理文件，单条 SQL）
  const [taskResult] = await db.query(
    'DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < (NOW() - INTERVAL ? DAY)',
    [SOFT_DELETE_RETAIN_DAYS]
  );
  if (taskResult.affectedRows > 0) {
    console.log(`[${new Date().toISOString()}] 🧹 Purged ${taskResult.affectedRows} task rows soft-deleted > ${SOFT_DELETE_RETAIN_DAYS}d`);
  }
}

// 启动时扫一次磁盘孤儿文件：磁盘上有但 DB 完全没记录（包括软删行）的文件直接 unlink。
// 与 cleanupSoftDeleted 职责分工：后者按 30 天保留期清"软删超期"的 DB 行+文件；
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

  // 有效集合 = DB 中所有行引用过的 file_path / thumb_path，不区分 deleted_at
  // （软删行在 30 天保留期内仍然要保留物理文件，由 cleanupSoftDeleted 处理）
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
       AND deleted_at IS NULL
       AND started_at < (UNIX_TIMESTAMP(NOW()) * 1000 - ? * 60 * 1000)`,
    ['生成超时（服务端检测）', STUCK_TASK_TIMEOUT_MIN]
  );
  if (result.affectedRows > 0) {
    console.log(`[${new Date().toISOString()}] 🧟 Cleaned ${result.affectedRows} stuck task(s) running > ${STUCK_TASK_TIMEOUT_MIN}min`);
  }
}


export {
  backfillThumbnails,
  cleanupSoftDeleted,
  cleanupOrphanFiles,
  cleanupStuckTasks,
  CLEANUP_INTERVAL_MS,
  STUCK_TASK_CHECK_INTERVAL_MS,
};
