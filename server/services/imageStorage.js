import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import db from '../db.js';

// 把生成/上传的图片字节写入磁盘并落库；与客户端 hashDataUrl 保持一致：sha256("data:${mime};base64,${b64}")。
// 已存在则返回既有 url，避免重复落盘。
const THUMB_SIZE = 256;
const THUMB_QUALITY = 70;

export function parseImageIdArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((id) => typeof id === 'string' && id.length > 0);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id.length > 0) : [];
  } catch {
    return [];
  }
}

export function collectImageIdsFromTasks(taskRows) {
  const imageIds = new Set();
  for (const task of taskRows || []) {
    for (const id of parseImageIdArray(task.input_image_ids)) imageIds.add(id);
    for (const id of parseImageIdArray(task.output_image_ids)) imageIds.add(id);
  }
  return Array.from(imageIds);
}

async function getReferencedImageIds(imageIds) {
  const targets = new Set((imageIds || []).filter(Boolean));
  const referenced = new Set();
  if (targets.size === 0) return referenced;

  const [tasks] = await db.query('SELECT input_image_ids, output_image_ids FROM tasks');
  for (const task of tasks) {
    for (const id of parseImageIdArray(task.input_image_ids)) {
      if (targets.has(id)) referenced.add(id);
    }
    for (const id of parseImageIdArray(task.output_image_ids)) {
      if (targets.has(id)) referenced.add(id);
    }
    if (referenced.size === targets.size) break;
  }
  return referenced;
}

export async function unlinkImageFiles(imageRow) {
  if (!imageRow) return;
  if (imageRow.file_path) await fs.unlink(imageRow.file_path).catch(() => {});
  if (imageRow.thumb_path) await fs.unlink(imageRow.thumb_path).catch(() => {});
}

export async function deleteImageRowsAndFiles(imageRows) {
  let deleted = 0;
  let failed = 0;
  for (const row of imageRows || []) {
    try {
      await unlinkImageFiles(row);
      await db.query('DELETE FROM images WHERE id = ?', [row.id]);
      deleted++;
    } catch (err) {
      failed++;
      console.error(`[${new Date().toISOString()}] ⚠️  Image delete failed for ${row.id}: ${err.message}`);
    }
  }
  return { deleted, failed };
}

export async function deleteUnreferencedImages(imageIds) {
  const uniqueIds = Array.from(new Set((imageIds || []).filter(Boolean)));
  if (uniqueIds.length === 0) return { requested: 0, deleted: 0, failed: 0, skippedReferenced: 0 };

  const referenced = await getReferencedImageIds(uniqueIds);
  const deletableIds = uniqueIds.filter((id) => !referenced.has(id));
  if (deletableIds.length === 0) {
    return { requested: uniqueIds.length, deleted: 0, failed: 0, skippedReferenced: referenced.size };
  }

  const [rows] = await db.query(
    'SELECT id, file_path, thumb_path FROM images WHERE id IN (?)',
    [deletableIds]
  );
  const result = await deleteImageRowsAndFiles(rows);
  return {
    requested: uniqueIds.length,
    deleted: result.deleted,
    failed: result.failed,
    skippedReferenced: referenced.size,
  };
}

export async function deleteImageIfUnreferenced(imageId) {
  const result = await deleteUnreferencedImages([imageId]);
  return result.deleted > 0;
}

export async function deleteTasksAndUnreferencedImages(taskRows) {
  const rows = Array.isArray(taskRows) ? taskRows : [];
  const taskIds = rows.map((task) => task.id).filter(Boolean);
  if (taskIds.length === 0) return { deletedTaskCount: 0, images: await deleteUnreferencedImages([]) };

  const imageIds = collectImageIdsFromTasks(rows);
  const [result] = await db.query('DELETE FROM tasks WHERE id IN (?)', [taskIds]);
  const images = await deleteUnreferencedImages(imageIds);
  return { deletedTaskCount: result.affectedRows || 0, images };
}

// 生成 256px webp 缩略图 buffer；失败返回 null，由调用方决定降级
export async function probeImageDims(srcBuffer) {
  try {
    const meta = await sharp(srcBuffer).metadata();
    if (meta && meta.width && meta.height) return { width: meta.width, height: meta.height };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ⚠️  Image metadata probe failed: ${err.message}`);
  }
  return { width: null, height: null };
}

export async function generateThumbnailBuffer(srcBuffer) {
  try {
    return await sharp(srcBuffer)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ⚠️  Thumbnail generation failed: ${err.message}`);
    return null;
  }
}

// 写缩略图到磁盘并返回 { thumbPath, thumbUrl }；失败返回 { thumbPath: null, thumbUrl: null }
export async function writeThumbnail(srcBuffer, imageId, dir) {
  const thumb = await generateThumbnailBuffer(srcBuffer);
  if (!thumb) return { thumbPath: null, thumbUrl: null };
  const thumbName = `${imageId}_thumb.webp`;
  const thumbPath = path.join(dir, thumbName);
  try {
    await fs.writeFile(thumbPath, thumb);
    return { thumbPath, thumbUrl: `${process.env.IMAGE_BASE_URL}/${thumbName}` };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ⚠️  Thumbnail write failed for ${imageId}: ${err.message}`);
    return { thumbPath: null, thumbUrl: null };
  }
}

export async function saveGeneratedImageBytes({ userId, buffer, mime, source = 'generated' }) {
  const b64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;
  const imageId = crypto.createHash('sha256').update(dataUrl).digest('hex');

  const [existing] = await db.query('SELECT id, file_url, thumb_url, width, height FROM images WHERE id = ?', [imageId]);
  if (existing.length > 0) {
    console.log(`[${new Date().toISOString()}] ♻️  Image already exists - ID: ${imageId}`);
    const dims = (existing[0].width && existing[0].height) ? { w: existing[0].width, h: existing[0].height } : null;
    return { id: imageId, url: existing[0].file_url, thumb: existing[0].thumb_url || '', dims, isNew: false };
  }

  const ext = (mime.split('/')[1] || 'png').toLowerCase();
  const uploadDir = process.env.IMAGE_UPLOAD_DIR || '/data/images';
  await fs.mkdir(uploadDir, { recursive: true });

  const filename = `${imageId}.${ext}`;
  const filePath = path.join(uploadDir, filename);
  await fs.writeFile(filePath, buffer);

  const { thumbPath, thumbUrl } = await writeThumbnail(buffer, imageId, uploadDir);
  const { width, height } = await probeImageDims(buffer);

  const fileUrl = `${process.env.IMAGE_BASE_URL}/${filename}`;
  await db.query(
    'INSERT INTO images (id, user_id, file_path, file_url, thumb_path, thumb_url, file_size, mime_type, source, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [imageId, userId, filePath, fileUrl, thumbPath, thumbUrl, buffer.length, mime, source, width, height]
  );

  const dims = (width && height) ? { w: width, h: height } : null;
  console.log(`[${new Date().toISOString()}] ✅ Image saved - ID: ${imageId}, Size: ${buffer.length} bytes, Dims: ${dims ? `${dims.w}×${dims.h}` : 'unknown'}, Thumb: ${thumbUrl ? 'ok' : 'skip'}`);
  return { id: imageId, url: fileUrl, thumb: thumbUrl || '', dims, isNew: true };
}

// 按 ID 从磁盘批量加载输入图片，保持顺序并构造 dataUrl 列表。缺图抛业务错误（statusCode=400）。
// 不按 user_id 过滤：images 表 id = sha256(dataUrl) 已是全局唯一去重主键，撞图/admin 跨用户复用都共享同一条记录。
export async function loadInputImageDataUrls(inputImageIds) {
  if (!Array.isArray(inputImageIds) || inputImageIds.length === 0) return [];

  const [rows] = await db.query(
    'SELECT id, file_path, mime_type FROM images WHERE id IN (?)',
    [inputImageIds]
  );
  const map = new Map(rows.map((r) => [r.id, r]));

  const dataUrls = [];
  for (const id of inputImageIds) {
    const row = map.get(id);
    if (!row) {
      const err = new Error(`参考图 ${id} 不存在或已被删除`);
      err.statusCode = 400;
      throw err;
    }
    const buffer = await fs.readFile(row.file_path);
    dataUrls.push(`data:${row.mime_type};base64,${buffer.toString('base64')}`);
  }
  return dataUrls;
}
