import express from 'express';
import cors from 'cors';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import sharp from 'sharp';
import db from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 80;
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = process.env.SESSION_COOKIE_NAME || 'connect.sid';
const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN || undefined;
const sessionCookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  domain: sessionCookieDomain,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};
const MIME_MAP = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const PROMPT_REWRITE_GUARD_PREFIX = 'Use the following text as the complete prompt. Do not rewrite it:';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required');
}

function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    path: sessionCookieOptions.path,
    httpOnly: sessionCookieOptions.httpOnly,
    sameSite: sessionCookieOptions.sameSite,
    secure: sessionCookieOptions.secure,
    domain: sessionCookieOptions.domain,
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function redirectWithError(res, error) {
  const location = new URL('/login', process.env.APP_ORIGIN || 'http://localhost:5173');
  location.searchParams.set('error', error);
  res.redirect(location.toString());
}

function resolveApiSettings(userSettingsRow) {
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

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(input);
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function normalizeBase64Image(value, fallbackMime) {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`;
}

async function fetchImageUrlAsDataUrl(url, fallbackMime, headers, signal) {
  const response = await fetch(url, {
    headers,
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || fallbackMime;
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function loadUserApiSettings(userId) {
  const [rows] = await db.query(
    'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
    [userId]
  );
  return resolveApiSettings(rows[0]);
}

// 上游错误信息 → 中文友好提示的关键词映射。顺序优先：先专业再泛化。
// 命中即返回；未命中保留原文兜底，避免信息丢失。
const UPSTREAM_ERROR_PATTERNS = [
  { re: /rate[\s_-]?limit|too many requests|429/i, msg: '请求过于频繁，请稍后再试（已触发上游限流）' },
  { re: /quota|insufficient|billing|payment|credit/i, msg: '账户额度不足或计费异常，请检查 API Key 余额' },
  { re: /safety|moderation|content[\s_-]?policy|blocked|filtered/i, msg: '内容被上游安全策略拒绝，请调整提示词或参考图后重试' },
  { re: /invalid[\s_-]?(size|dimension)|unsupported[\s_-]?size/i, msg: '尺寸不被上游支持，请在设置中改用支持的 size' },
  { re: /invalid[\s_-]?(api[\s_-]?key|authentication|token)|unauthorized|401/i, msg: 'API Key 无效或未授权，请在设置中检查' },
  { re: /timeout|timed?[\s_-]?out|ETIMEDOUT/i, msg: '上游响应超时，可在设置中调高超时时间后重试' },
  { re: /model[\s_-]?(not[\s_-]?found|unavailable|deprecated)/i, msg: '上游模型不可用，请在设置中检查 model 配置' },
  { re: /network|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i, msg: '网络异常，无法连接上游服务，请稍后重试' },
];

function friendlyUpstreamMessage(raw) {
  if (!raw) return '上游请求失败';
  const text = String(raw);
  for (const { re, msg } of UPSTREAM_ERROR_PATTERNS) {
    if (re.test(text)) return msg;
  }
  return text;
}

async function parseUpstreamError(response) {
  let errorMsg = `HTTP ${response.status}`;
  try {
    const errJson = await response.json();
    if (errJson.error?.message) errorMsg = errJson.error.message;
    else if (errJson.error) errorMsg = errJson.error;
    else if (errJson.message) errorMsg = errJson.message;
  } catch {
    try {
      errorMsg = await response.text();
    } catch {
      /* ignore */
    }
  }
  throw new Error(friendlyUpstreamMessage(errorMsg));
}

// 把生成/上传的图片字节写入磁盘并落库；与客户端 hashDataUrl 保持一致：sha256("data:${mime};base64,${b64}")。
// 已存在则恢复软删除并返回既有 url，避免重复落盘。
const THUMB_SIZE = 256;
const THUMB_QUALITY = 70;

// 生成 256px webp 缩略图 buffer；失败返回 null，由调用方决定降级
async function generateThumbnailBuffer(srcBuffer) {
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
async function writeThumbnail(srcBuffer, imageId, dir) {
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

async function saveGeneratedImageBytes({ userId, buffer, mime, source = 'generated' }) {
  const b64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;
  const imageId = crypto.createHash('sha256').update(dataUrl).digest('hex');

  const [existing] = await db.query('SELECT id, file_url, thumb_url, deleted_at FROM images WHERE id = ?', [imageId]);
  if (existing.length > 0) {
    if (existing[0].deleted_at) {
      await db.query('UPDATE images SET deleted_at = NULL WHERE id = ?', [imageId]);
      console.log(`[${new Date().toISOString()}] ♻️  Restored soft-deleted image - ID: ${imageId}`);
    } else {
      console.log(`[${new Date().toISOString()}] ♻️  Image already exists - ID: ${imageId}`);
    }
    return { id: imageId, url: existing[0].file_url, thumb: existing[0].thumb_url || '' };
  }

  const ext = (mime.split('/')[1] || 'png').toLowerCase();
  const uploadDir = process.env.IMAGE_UPLOAD_DIR || '/data/images';
  await fs.mkdir(uploadDir, { recursive: true });

  const filename = `${imageId}.${ext}`;
  const filePath = path.join(uploadDir, filename);
  await fs.writeFile(filePath, buffer);

  const { thumbPath, thumbUrl } = await writeThumbnail(buffer, imageId, uploadDir);

  const fileUrl = `${process.env.IMAGE_BASE_URL}/${filename}`;
  await db.query(
    'INSERT INTO images (id, user_id, file_path, file_url, thumb_path, thumb_url, file_size, mime_type, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [imageId, userId, filePath, fileUrl, thumbPath, thumbUrl, buffer.length, mime, source]
  );

  console.log(`[${new Date().toISOString()}] ✅ Image saved - ID: ${imageId}, Size: ${buffer.length} bytes, Thumb: ${thumbUrl ? 'ok' : 'skip'}`);
  return { id: imageId, url: fileUrl, thumb: thumbUrl || '' };
}

// 按 ID 从磁盘批量加载输入图片，保持顺序并构造 dataUrl 列表。缺图抛业务错误（statusCode=400）。
async function loadInputImageDataUrls(userId, inputImageIds) {
  if (!Array.isArray(inputImageIds) || inputImageIds.length === 0) return [];

  const [rows] = await db.query(
    'SELECT id, file_path, mime_type FROM images WHERE id IN (?) AND user_id = ? AND deleted_at IS NULL',
    [inputImageIds, userId]
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

async function callUpstreamImageApi(userId, payload) {
  console.log(`[${new Date().toISOString()}] 📡 Loading API settings for user ${userId}`);
  const apiSettings = await loadUserApiSettings(userId);
  const baseUrl = normalizeBaseUrl(apiSettings.baseUrl);

  console.log(`[${new Date().toISOString()}] ⚙️  API Config - BaseURL: ${baseUrl}, Model: ${apiSettings.model}, Timeout: ${apiSettings.timeout}s, Format: ${apiSettings.apiFormat}`);

  if (!baseUrl) {
    throw new Error('未配置默认 API URL');
  }
  if (!apiSettings.apiKey) {
    throw new Error('未配置默认 API Key');
  }

  const { prompt, params, inputImageIds } = payload;
  const inputImageDataUrls = await loadInputImageDataUrls(userId, inputImageIds);
  const isEdit = inputImageDataUrls.length > 0;
  const mime = MIME_MAP[params.output_format] || 'image/png';
  const timeout = Math.max(Number(apiSettings.timeout) || 600, 10) * 1000;
  const signal = AbortSignal.timeout(timeout);
  const authHeaders = {
    Authorization: `Bearer ${apiSettings.apiKey}`,
    'Cache-Control': 'no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
  };

  console.log(`[${new Date().toISOString()}] 🔧 Request params - IsEdit: ${isEdit}, Size: ${params.size}, Quality: ${params.quality}, Format: ${params.output_format}, Timeout: ${timeout}ms, Input image IDs: ${inputImageIds?.length || 0}`);

  if (apiSettings.apiFormat === 'responses') {
    const tool = {
      type: 'image_generation',
      quality: params.quality,
      size: params.size,
      output_format: params.output_format,
    };
    if (params.output_format !== 'png' && params.output_compression != null) {
      tool.output_compression = params.output_compression;
    }

    const guardedPrompt = `${PROMPT_REWRITE_GUARD_PREFIX}\n${prompt}`;
    let input;
    if (isEdit) {
      const content = [{ type: 'input_text', text: guardedPrompt }];
      for (const dataUrl of inputImageDataUrls) {
        content.push({ type: 'input_image', image_url: dataUrl });
      }
      input = [{ role: 'user', content }];
    } else {
      input = guardedPrompt;
    }

    const endpoint = `${baseUrl}/v1/responses`;
    const requestBody = {
      model: apiSettings.model,
      input,
      tools: [tool],
      tool_choice: 'required',
    };
    console.log(`[${new Date().toISOString()}] 🚀 Calling upstream API - Endpoint: ${endpoint}, Method: responses`);
    console.log(`[${new Date().toISOString()}] 📦 Request body:`, JSON.stringify(requestBody, null, 2));
    const fetchStartTime = Date.now();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authHeaders.Authorization,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, max-age=0',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
      body: JSON.stringify(requestBody),
      signal,
    });

    const fetchElapsed = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
    console.log(`[${new Date().toISOString()}] 📥 Upstream response received - Status: ${response.status}, Time: ${fetchElapsed}s`);

    if (!response.ok) {
      console.error(`[${new Date().toISOString()}] ⚠️  Upstream API error - Status: ${response.status}`);
      await parseUpstreamError(response);
    }

    const payloadJson = await response.json();
    const outputs = payloadJson?.output;
    if (!Array.isArray(outputs) || !outputs.length) {
      throw new Error('接口未返回图片数据');
    }

    const images = [];
    for (const item of outputs) {
      if (item.type === 'image_generation_call' && item.result) {
        images.push(normalizeBase64Image(item.result, mime));
      }
    }

    if (!images.length) {
      throw new Error('接口未返回可用图片数据');
    }

    return { images };
  }

  let response;
  const fetchStartTime = Date.now();

  if (isEdit) {
    const endpoint = `${baseUrl}/v1/images/edits`;
    console.log(`[${new Date().toISOString()}] 🚀 Calling upstream API - Endpoint: ${endpoint}, Method: edits, Images: ${inputImageDataUrls.length}`);

    const formData = new FormData();
    formData.append('model', apiSettings.model);
    formData.append('prompt', prompt);
    formData.append('size', params.size);
    formData.append('quality', params.quality);
    formData.append('output_format', params.output_format);
    formData.append('moderation', params.moderation);

    if (params.output_format !== 'png' && params.output_compression != null) {
      formData.append('output_compression', String(params.output_compression));
    }

    if (params.n && params.n > 1) {
      formData.append('n', String(params.n));
    }

    console.log(`[${new Date().toISOString()}] 📦 FormData fields: model=${apiSettings.model}, prompt="${prompt.substring(0, 50)}...", size=${params.size}, quality=${params.quality}, format=${params.output_format}, images=${inputImageDataUrls.length}, n=${params.n || 1}`);

    for (let i = 0; i < inputImageDataUrls.length; i++) {
      const dataUrl = inputImageDataUrls[i];
      const matches = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!matches) continue;
      const blob = new Blob([Buffer.from(matches[2], 'base64')], { type: matches[1] });
      const ext = matches[1].split('/')[1] || 'png';
      formData.append('image[]', blob, `input-${i + 1}.${ext}`);
      console.log(`[${new Date().toISOString()}] 📎 Added image ${i + 1}: ${matches[1]}, size: ${blob.size} bytes`);
    }

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authHeaders.Authorization,
        'Cache-Control': 'no-store, no-cache, max-age=0',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
      body: formData,
      signal,
    });
  } else {
    const endpoint = `${baseUrl}/v1/images/generations`;
    const requestBody = {
      model: apiSettings.model,
      prompt,
      size: params.size,
      quality: params.quality,
      output_format: params.output_format,
      moderation: params.moderation,
      ...(params.output_format !== 'png' && params.output_compression != null ? { output_compression: params.output_compression } : {}),
      ...(params.n > 1 ? { n: params.n } : {}),
    };
    console.log(`[${new Date().toISOString()}] 🚀 Calling upstream API - Endpoint: ${endpoint}, Method: generations`);
    console.log(`[${new Date().toISOString()}] 📦 Request body:`, JSON.stringify(requestBody, null, 2));

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authHeaders.Authorization,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, max-age=0',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
      body: JSON.stringify(requestBody),
      signal,
    });
  }

  const fetchElapsed = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
  console.log(`[${new Date().toISOString()}] 📥 Upstream response received - Status: ${response.status}, Time: ${fetchElapsed}s`);

  if (!response.ok) {
    console.error(`[${new Date().toISOString()}] ⚠️  Upstream API error - Status: ${response.status}`);
    await parseUpstreamError(response);
  }

  const payloadJson = await response.json();
  const data = payloadJson?.data;
  if (!Array.isArray(data) || !data.length) {
    throw new Error('接口未返回图片数据');
  }

  const images = [];
  for (const item of data) {
    if (item.b64_json) {
      images.push(normalizeBase64Image(item.b64_json, mime));
      continue;
    }
    if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) {
      images.push(await fetchImageUrlAsDataUrl(item.url, mime, authHeaders, signal));
    }
  }

  if (!images.length) {
    throw new Error('接口未返回可用图片数据');
  }

  return { images };
}

// Redis 客户端
let redisClient;
try {
  redisClient = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379')
    },
    password: process.env.REDIS_PASSWORD || undefined
  });
  await redisClient.connect();
  console.log('✅ Redis connected');
} catch (err) {
  console.warn('⚠️  Redis connection failed, using memory session:', err.message);
  redisClient = null;
}

// 信任反向代理（Nginx/Caddy），使 secure cookie 和 req.ip 正常工作
app.set('trust proxy', 1);

// 中间件
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session 配置
const sessionConfig = {
  name: sessionCookieName,
  secret: process.env.SESSION_SECRET,
  resave: false,
  rolling: true,
  saveUninitialized: false,
  cookie: sessionCookieOptions,
};

if (redisClient) {
  sessionConfig.store = new RedisStore({ client: redisClient });
}

app.use(session(sessionConfig));

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

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    console.log(`[${new Date().toISOString()}] 🚫 Unauthorized access attempt - IP: ${req.ip}, Path: ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ==================== 认证路由 ====================

app.get('/api/auth/github', async (req, res) => {
  console.log(`[${new Date().toISOString()}] 🔐 GitHub OAuth initiated - IP: ${req.ip}`);
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = process.env.GITHUB_CALLBACK_URL;
  const scope = 'user:email';
  const state = crypto.randomBytes(24).toString('hex');

  req.session.oauthState = state;
  await saveSession(req);

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  githubAuthUrl.searchParams.set('scope', scope);
  githubAuthUrl.searchParams.set('state', state);
  console.log(`[${new Date().toISOString()}] ↗️  Redirecting to GitHub - State: ${state.substring(0, 8)}...`);
  res.redirect(githubAuthUrl.toString());
});

app.get('/api/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;
  console.log(`[${new Date().toISOString()}] 🔙 GitHub callback - Code: ${code ? 'present' : 'missing'}, State: ${state?.substring(0, 8)}...`);

  if (!code) {
    console.error(`[${new Date().toISOString()}] ❌ OAuth callback failed - No code`);
    return redirectWithError(res, 'no_code');
  }

  if (!state || state !== req.session.oauthState) {
    console.error(`[${new Date().toISOString()}] ❌ OAuth callback failed - Invalid state`);
    return redirectWithError(res, 'invalid_state');
  }

  try {
    console.log(`[${new Date().toISOString()}] 🔄 Exchanging code for token`);
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    }, {
      headers: { Accept: 'application/json' }
    });

    const accessToken = tokenResponse.data.access_token;
    console.log(`[${new Date().toISOString()}] ✅ Token received, fetching user info`);

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const githubUser = userResponse.data;
    console.log(`[${new Date().toISOString()}] 👤 GitHub user: ${githubUser.login} (ID: ${githubUser.id})`);

    const [rows] = await db.query(
      'SELECT * FROM users WHERE github_id = ?',
      [githubUser.id.toString()]
    );

    let userId;
    if (rows.length > 0) {
      userId = rows[0].id;
      console.log(`[${new Date().toISOString()}] 🔄 Updating existing user ${userId}`);
      await db.query(
        'UPDATE users SET username = ?, avatar_url = ?, email = ?, updated_at = NOW() WHERE id = ?',
        [githubUser.login, githubUser.avatar_url, githubUser.email, userId]
      );
    } else {
      console.log(`[${new Date().toISOString()}] ➕ Creating new user`);
      const [result] = await db.query(
        'INSERT INTO users (github_id, username, avatar_url, email) VALUES (?, ?, ?, ?)',
        [githubUser.id.toString(), githubUser.login, githubUser.avatar_url, githubUser.email]
      );
      userId = result.insertId;
      console.log(`[${new Date().toISOString()}] ✅ New user created with ID ${userId}`);
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    req.session.userId = userId;
    req.session.username = githubUser.login;

    await saveSession(req);
    console.log(`[${new Date().toISOString()}] ✅ Login successful - User ${userId} (${githubUser.login})`);
    res.redirect(process.env.APP_ORIGIN || 'http://localhost:5173');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ GitHub OAuth error:`, error.message);
    redirectWithError(res, 'auth_failed');
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 👤 Get current user - User ID: ${req.session.userId}`);
    const [rows] = await db.query(
      'SELECT id, github_id, username, avatar_url, email, created_at FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (rows.length === 0) {
      console.error(`[${new Date().toISOString()}] ❌ User not found in DB - User ID: ${req.session.userId}`);
      clearSessionCookie(res);
      await destroySession(req).catch(() => {});
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(rows[0]);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get user error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 🚪 Logout - User ID: ${req.session?.userId || 'unknown'}`);
    if (req.session) {
      await destroySession(req);
    }
    clearSessionCookie(res);
    res.set('Clear-Site-Data', '"cache", "storage"');
    res.set('Cache-Control', 'no-store');
    console.log(`[${new Date().toISOString()}] ✅ Logout successful`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ Logout failed:`, err.message);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ==================== 用户设置路由 ====================

app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] ⚙️  Get settings - User ID: ${req.session.userId}`);
    const [rows] = await db.query(
      'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
      [req.session.userId]
    );

    const settings = resolveApiSettings(rows[0]);

    // 不返回完整的 API Key，只返回掩码
    const maskedApiKey = settings.apiKey ? '••••••••••••••••' : '';

    res.json({
      api_url: settings.baseUrl,
      api_key: maskedApiKey,
      use_default: !rows[0]?.api_url && !rows[0]?.api_key,
      settings: {
        model: settings.model,
        timeout: settings.timeout,
        apiFormat: settings.apiFormat,
      }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get settings error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/settings', requireAuth, async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] 💾 Update settings - User ID: ${req.session.userId}`);
    const { api_url, api_key, use_default, settings } = req.body;

    const finalApiUrl = use_default ? null : api_url;
    const finalApiKey = use_default ? null : api_key;

    // 如果 api_key 未提供（undefined），则不更新它
    if (api_key === undefined) {
      await db.query(
        `INSERT INTO user_settings (user_id, api_url, settings)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE api_url = ?, settings = ?, updated_at = NOW()`,
        [req.session.userId, finalApiUrl, JSON.stringify(settings), finalApiUrl, JSON.stringify(settings)]
      );
    } else {
      await db.query(
        `INSERT INTO user_settings (user_id, api_url, api_key, settings)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE api_url = ?, api_key = ?, settings = ?, updated_at = NOW()`,
        [req.session.userId, finalApiUrl, finalApiKey, JSON.stringify(settings), finalApiUrl, finalApiKey, JSON.stringify(settings)]
      );
    }

    console.log(`[${new Date().toISOString()}] ✅ Settings updated`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update settings error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== 任务路由 ====================

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    // 分页：cursor 是上一页最后一条 (created_at, id) 的 base64 JSON；首页留空
    // 过滤：q 模糊匹配 prompt（前后 %）；status 取 'all' | 'running' | 'done' | 'error'
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = ['running', 'done', 'error'].includes(req.query.status) ? req.query.status : 'all';
    const onlyFavorite = req.query.favorite === '1' || req.query.favorite === 'true';

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

    console.log(`[${new Date().toISOString()}] 📋 Get tasks - User: ${req.session.userId}, q="${q}", status=${status}, limit=${limit}, cursor=${cursorTs ? 'yes' : 'no'}`);

    const where = ['user_id = ?', 'deleted_at IS NULL'];
    const params = [req.session.userId];
    if (status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    if (onlyFavorite) {
      where.push('is_favorite = 1');
    }
    if (q) {
      where.push('prompt LIKE ?');
      params.push(`%${q}%`);
    }
    if (cursorTs && cursorId) {
      // 严格小于上一页最后一条的 (created_at, id)
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(cursorTs, cursorTs, cursorId);
    }

    // 多取 1 条用于判断是否还有下一页
    const sql = `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`;
    const [rows] = await db.query(sql, [...params, limit + 1]);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    console.log(`[${new Date().toISOString()}] 📊 Found ${pageRows.length} tasks (hasMore=${hasMore})`);

    // 一次性收集所有任务引用的图片 ID（输入 + 输出），批量查询 URL
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

    const imageMap = new Map();
    if (allImageIds.size > 0) {
      const [images] = await db.query(
        'SELECT id, file_url, thumb_url FROM images WHERE id IN (?) AND user_id = ? AND deleted_at IS NULL',
        [Array.from(allImageIds), req.session.userId]
      );
      for (const img of images) imageMap.set(img.id, { url: img.file_url, thumb: img.thumb_url || '' });
    }

    const items = parsedRows.map(({ task, inputImageIds, outputImageIds }) => {
      // 保留占位（缺失填空串），保证与 ID 数组的索引一一对应
      const inputImageUrls = inputImageIds.map(id => imageMap.get(id)?.url || '');
      const outputImageUrls = outputImageIds.map(id => imageMap.get(id)?.url || '');
      const inputThumbUrls = inputImageIds.map(id => imageMap.get(id)?.thumb || '');
      const outputThumbUrls = outputImageIds.map(id => imageMap.get(id)?.thumb || '');

      return {
        ...task,
        params: typeof task.params === 'string' ? JSON.parse(task.params) : task.params,
        input_image_ids: inputImageIds,
        output_image_ids: outputImageIds,
        input_image_urls: inputImageUrls,
        output_image_urls: outputImageUrls,
        input_thumb_urls: inputThumbUrls,
        output_thumb_urls: outputThumbUrls,
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
    console.log(`[${new Date().toISOString()}] 🔄 Update task - Task ID: ${id}, Status: ${status}, Images: ${output_image_ids?.length || 0}`);

    await db.query(
      'UPDATE tasks SET status = ?, error_message = ?, output_image_ids = ?, finished_at = ? WHERE id = ? AND user_id = ?',
      [status, error_message, JSON.stringify(output_image_ids || []), finished_at, id, req.session.userId]
    );

    console.log(`[${new Date().toISOString()}] ✅ Task updated - Task ID: ${id}`);
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
    console.log(`[${new Date().toISOString()}] ⭐ Toggle favorite - Task ID: ${id}, isFavorite: ${next}`);

    const [result] = await db.query(
      'UPDATE tasks SET is_favorite = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [next, id, req.session.userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Task not found' });
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

    console.log(`[${new Date().toISOString()}] 🗑️  Batch delete - User ID: ${req.session.userId}, count=${ids.length}`);

    // 先取出待删任务关联的图片 ID
    const [taskRows] = await db.query(
      'SELECT id, input_image_ids, output_image_ids FROM tasks WHERE id IN (?) AND user_id = ? AND deleted_at IS NULL',
      [ids, req.session.userId]
    );

    if (!taskRows.length) {
      return res.json({ success: true, deletedCount: 0 });
    }

    const targetIds = taskRows.map((t) => t.id);
    const targetImageIds = new Set();
    for (const t of taskRows) {
      const ii = typeof t.input_image_ids === 'string' ? JSON.parse(t.input_image_ids) : (t.input_image_ids || []);
      const oi = typeof t.output_image_ids === 'string' ? JSON.parse(t.output_image_ids) : (t.output_image_ids || []);
      for (const id of (ii || [])) targetImageIds.add(id);
      for (const id of (oi || [])) targetImageIds.add(id);
    }

    // 软删任务
    await db.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id IN (?) AND user_id = ?',
      [targetIds, req.session.userId]
    );

    // 清理孤立图片
    if (targetImageIds.size > 0) {
      const [otherTasks] = await db.query(
        'SELECT input_image_ids, output_image_ids FROM tasks WHERE user_id = ? AND deleted_at IS NULL',
        [req.session.userId]
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
        const [imgResult] = await db.query(
          'UPDATE images SET deleted_at = NOW() WHERE id IN (?) AND user_id = ? AND deleted_at IS NULL',
          [orphans, req.session.userId]
        );
        console.log(`[${new Date().toISOString()}] 🗑️  Soft-deleted ${imgResult.affectedRows} orphan images`);
      }
    }

    console.log(`[${new Date().toISOString()}] ✅ Batch deleted ${targetIds.length} tasks`);
    res.json({ success: true, deletedCount: targetIds.length });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Batch delete error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[${new Date().toISOString()}] 🗑️  Delete task - Task ID: ${id}, User ID: ${req.session.userId}`);

    // 先取出该任务关联的图片 ID
    const [taskRows] = await db.query(
      'SELECT input_image_ids, output_image_ids FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [id, req.session.userId]
    );

    await db.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id = ? AND user_id = ?',
      [id, req.session.userId]
    );

    // 联动软删除该任务关联的图片（若没有被其他存活任务引用）
    if (taskRows.length > 0) {
      const task = taskRows[0];
      const inputIds = typeof task.input_image_ids === 'string' ? JSON.parse(task.input_image_ids) : (task.input_image_ids || []);
      const outputIds = typeof task.output_image_ids === 'string' ? JSON.parse(task.output_image_ids) : (task.output_image_ids || []);
      const allImageIds = [...new Set([...(inputIds || []), ...(outputIds || [])])];

      if (allImageIds.length > 0) {
        // 找出当前用户其他存活任务仍在引用的图片 ID
        const [otherTasks] = await db.query(
          'SELECT input_image_ids, output_image_ids FROM tasks WHERE user_id = ? AND deleted_at IS NULL',
          [req.session.userId]
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
          const [imgResult] = await db.query(
            'UPDATE images SET deleted_at = NOW() WHERE id IN (?) AND user_id = ? AND deleted_at IS NULL',
            [orphanIds, req.session.userId]
          );
          console.log(`[${new Date().toISOString()}] 🗑️  Soft-deleted ${imgResult.affectedRows} associated images`);
        }
      }
    }

    console.log(`[${new Date().toISOString()}] ✅ Task deleted - Task ID: ${id}`);
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

// ==================== 生成代理路由 ====================

app.post('/api/generate', requireAuth, async (req, res) => {
  const startTime = Date.now();
  const taskId = req.body.taskId ? String(req.body.taskId) : null;
  console.log(`[${new Date().toISOString()}] 🎨 Generate request started - User: ${req.session.userId}, Task: ${taskId || 'none'}, Prompt: "${req.body.prompt?.substring(0, 50)}...", Input image IDs: ${req.body.inputImageIds?.length || 0}`);

  try {
    const result = await callUpstreamImageApi(req.session.userId, req.body);

    // 服务端直接落盘：避免再让客户端 POST 回 /api/images/save 走一次 base64 往返
    const saved = [];
    for (const dataUrl of result.images) {
      const matches = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!matches) continue;
      const item = await saveGeneratedImageBytes({
        userId: req.session.userId,
        buffer: Buffer.from(matches[2], 'base64'),
        mime: matches[1],
        source: 'generated',
      });
      saved.push(item);
    }

    if (!saved.length) {
      throw new Error('上游返回的图片均无法解析');
    }

    // 服务端直接接管 task 状态更新，避免依赖前端回调（前端断网时 task 仍能落 done）
    if (taskId) {
      try {
        await db.query(
          'UPDATE tasks SET status = ?, output_image_ids = ?, finished_at = ? WHERE id = ? AND user_id = ?',
          ['done', JSON.stringify(saved.map((s) => s.id)), Date.now(), taskId, req.session.userId]
        );
      } catch (e) {
        console.error(`[${new Date().toISOString()}] ⚠️  Update task to done failed (Task: ${taskId}): ${e.message}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[${new Date().toISOString()}] ✅ Generate success - User: ${req.session.userId}, Task: ${taskId || 'none'}, Images: ${saved.length}, Time: ${elapsed}s`);
    res.set('Cache-Control', 'no-store');
    res.json({ images: saved });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[${new Date().toISOString()}] ❌ Generate failed - User: ${req.session.userId}, Task: ${taskId || 'none'}, Time: ${elapsed}s`);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      cause: error.cause,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      response: error.response?.data
    });
    const status = error.statusCode || error.response?.status || 500;
    const rawMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message || 'Generate failed';
    // statusCode 是我们自己抛的业务错误（如参考图缺失），直接透传；其余走友好化（含 abort/timeout/network）
    const message = error.statusCode ? rawMessage : friendlyUpstreamMessage(rawMessage);

    // 同步把 task 写入 error 状态，前端断网时也有正确状态
    if (taskId) {
      try {
        await db.query(
          'UPDATE tasks SET status = ?, error_message = ?, finished_at = ? WHERE id = ? AND user_id = ?',
          ['error', message, Date.now(), taskId, req.session.userId]
        );
      } catch (e) {
        console.error(`[${new Date().toISOString()}] ⚠️  Update task to error failed (Task: ${taskId}): ${e.message}`);
      }
    }

    res.status(status).json({ error: message });
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

    await db.query(
      'INSERT INTO images (id, user_id, file_path, file_url, thumb_path, thumb_url, file_size, mime_type, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [imageId, req.session.userId, req.file.path, fileUrl, thumbPath, thumbUrl, req.file.size, req.file.mimetype, 'upload']
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
    console.log(`[${new Date().toISOString()}] 💾 Save image - User ID: ${req.session.userId}, Source: ${source}`);

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      console.error(`[${new Date().toISOString()}] ❌ Invalid data URL`);
      return res.status(400).json({ error: 'Invalid data URL' });
    }

    const matches = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!matches) {
      console.error(`[${new Date().toISOString()}] ❌ Invalid data URL format`);
      return res.status(400).json({ error: 'Invalid data URL format' });
    }

    const result = await saveGeneratedImageBytes({
      userId: req.session.userId,
      buffer: Buffer.from(matches[2], 'base64'),
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

    const [rows] = await db.query(
      'SELECT id, file_url, file_size, mime_type, source, created_at FROM images WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [id, req.session.userId]
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

app.use('/images', express.static(process.env.IMAGE_UPLOAD_DIR || '/data/images'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use(express.static('public'));

app.get('*', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] 🚀 Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📝 Environment: ${isProduction ? 'production' : 'development'}`);
  console.log(`[${new Date().toISOString()}] 🔗 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log(`[${new Date().toISOString()}] 🗄️  Redis: ${redisClient ? 'connected' : 'memory session'}`);
  // 异步触发 backfill，不阻塞 listen；首次启动数据多时也不影响接收请求
  backfillThumbnails().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Backfill thumbnails error:`, err.message);
  });
  // 启动时清理一次过期软删除文件，并每 24h 重复
  cleanupSoftDeleted().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Cleanup soft-deleted error:`, err.message);
  });
  setInterval(() => {
    cleanupSoftDeleted().catch((err) => {
      console.error(`[${new Date().toISOString()}] ❌ Cleanup soft-deleted error:`, err.message);
    });
  }, CLEANUP_INTERVAL_MS);
  // 启动时扫一次磁盘孤儿（DB 完全没记录的文件），只在启动时跑
  cleanupOrphanFiles().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Cleanup orphan files error:`, err.message);
  });
  // 启动时 + 每小时检测 zombie task（running 超时），避免前端断网导致 task 永远停在 running
  cleanupStuckTasks().catch((err) => {
    console.error(`[${new Date().toISOString()}] ❌ Cleanup stuck tasks error:`, err.message);
  });
  setInterval(() => {
    cleanupStuckTasks().catch((err) => {
      console.error(`[${new Date().toISOString()}] ❌ Cleanup stuck tasks error:`, err.message);
    });
  }, STUCK_TASK_CHECK_INTERVAL_MS);
});

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
