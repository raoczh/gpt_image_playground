import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { checkStorageQuota } from '../quota.js';
import { logAudit } from '../audit.js';
import { assertImageAccess } from '../services/access.js';
import { probeImageDims, saveGeneratedImageBytes, writeThumbnail } from '../services/imageStorage.js';

const app = express.Router();

// 图片上传配置
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = process.env.IMAGE_UPLOAD_DIR || '/data/images';
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const hash = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${hash}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// ==================== 图片路由 ====================

app.post('/api/images/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 📤 Upload image - User ID: ${req.session.userId}`);
    if (!req.file) {
      console.error(`[${new Date().toISOString()}] ❌ No file uploaded`);
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // M7: 存储配额校验
    const storageCheck = await checkStorageQuota(req.session.userId, req.file.size || 0);
    if (!storageCheck.ok) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(429).json({ error: storageCheck.message, code: storageCheck.code });
    }

    const fileBuffer = await fs.readFile(req.file.path);
    // 与客户端 hashDataUrl 和 /api/images/save 保持一致：sha256(dataUrl 字符串)
    const ext = (path.extname(req.file.originalname).slice(1) || 'png').toLowerCase();
    const mime = req.file.mimetype || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const dataUrl = `data:${mime};base64,${fileBuffer.toString('base64')}`;
    const imageId = crypto.createHash('sha256').update(dataUrl).digest('hex');
    const fileUrl = `${process.env.IMAGE_BASE_URL}/${req.file.filename}`;

    console.log(`[${new Date().toISOString()}] 🔍 Check existing image - ID: ${imageId}`);
    const [existing] = await db.query('SELECT id, file_url, thumb_url, deleted_at FROM images WHERE id = ?', [imageId]);

    if (existing.length > 0) {
      // 若图片之前被软删除，则恢复
      if (existing[0].deleted_at) {
        await db.query('UPDATE images SET deleted_at = NULL WHERE id = ?', [imageId]);
        console.log(`[${new Date().toISOString()}] ♻️  Restored soft-deleted image - ID: ${imageId}`);
      } else {
        console.log(`[${new Date().toISOString()}] ♻️  Image already exists, removing duplicate`);
      }
      await fs.unlink(req.file.path).catch(() => {});
      return res.json({ id: imageId, url: existing[0].file_url, thumb: existing[0].thumb_url || '' });
    }

    const { thumbPath, thumbUrl } = await writeThumbnail(fileBuffer, imageId, path.dirname(req.file.path));
    const { width, height } = await probeImageDims(fileBuffer);

    await db.query(
      'INSERT INTO images (id, user_id, file_path, file_url, thumb_path, thumb_url, file_size, mime_type, source, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [imageId, req.session.userId, req.file.path, fileUrl, thumbPath, thumbUrl, req.file.size, req.file.mimetype, 'upload', width, height]
    );

    console.log(`[${new Date().toISOString()}] ✅ Image uploaded - ID: ${imageId}, Size: ${req.file.size} bytes, Thumb: ${thumbUrl ? 'ok' : 'skip'}`);
    res.json({ id: imageId, url: fileUrl, thumb: thumbUrl || '' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Upload image error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/images/save', requireAuth, async (req, res) => {
  try {
    const { dataUrl, source = 'generated' } = req.body;

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid data URL' });
    }

    const matches = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid data URL format' });
    }

    const buffer = Buffer.from(matches[2], 'base64');
    const storageCheck = await checkStorageQuota(req.session.userId, buffer.length);
    if (!storageCheck.ok) {
      return res.status(429).json({ error: storageCheck.message, code: storageCheck.code });
    }

    const result = await saveGeneratedImageBytes({
      userId: req.session.userId,
      buffer,
      mime: matches[1],
      source,
    });
    res.json(result);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Save image error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/images/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const access = await assertImageAccess(id, req);
    if (!access) return res.status(404).json({ error: 'Image not found' });

    const [rows] = await db.query(
      'SELECT id, user_id, file_url, file_size, mime_type, source, created_at FROM images WHERE id = ? AND deleted_at IS NULL',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/images/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await assertImageAccess(id, req);
    if (!access) return res.status(404).json({ error: 'Image not found' });

    await db.query(
      'UPDATE images SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id]
    );

    if (access.isAdminAccess) {
      logAudit({
        actorId: req.user.id,
        action: 'image.delete_other_user',
        targetType: 'image',
        targetId: id,
        beforeValue: { owner_id: access.ownerId },
        ip: req.ip,
        ua: req.get('user-agent'),
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
