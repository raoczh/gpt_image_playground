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
    timeout: Number(storedSettings.timeout || process.env.DEFAULT_TIMEOUT || 300),
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
  throw new Error(errorMsg);
}

async function callUpstreamImageApi(userId, payload) {
  const apiSettings = await loadUserApiSettings(userId);
  const baseUrl = normalizeBaseUrl(apiSettings.baseUrl);
  if (!baseUrl) {
    throw new Error('未配置默认 API URL');
  }
  if (!apiSettings.apiKey) {
    throw new Error('未配置默认 API Key');
  }

  const { prompt, params, inputImageDataUrls } = payload;
  const isEdit = Array.isArray(inputImageDataUrls) && inputImageDataUrls.length > 0;
  const mime = MIME_MAP[params.output_format] || 'image/png';
  const timeout = Math.max(Number(apiSettings.timeout) || 300, 10) * 1000;
  const signal = AbortSignal.timeout(timeout);
  const authHeaders = {
    Authorization: `Bearer ${apiSettings.apiKey}`,
    'Cache-Control': 'no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
  };

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

    let input;
    if (isEdit) {
      const content = [{ type: 'input_text', text: prompt }];
      for (const dataUrl of inputImageDataUrls) {
        content.push({ type: 'input_image', image_url: dataUrl });
      }
      input = [{ role: 'user', content }];
    } else {
      input = prompt;
    }

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        model: apiSettings.model,
        input,
        tools: [tool],
        tool_choice: 'required',
      }),
      signal,
    });

    if (!response.ok) {
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
  if (isEdit) {
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

    for (let i = 0; i < inputImageDataUrls.length; i++) {
      const dataUrl = inputImageDataUrls[i];
      const matches = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!matches) continue;
      const blob = new Blob([Buffer.from(matches[2], 'base64')], { type: matches[1] });
      const ext = matches[1].split('/')[1] || 'png';
      formData.append('image[]', blob, `input-${i + 1}.${ext}`);
    }

    response = await fetch(`${baseUrl}/v1/images/edits`, {
      method: 'POST',
      headers: authHeaders,
      cache: 'no-store',
      body: formData,
      signal,
    });
  } else {
    response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        model: apiSettings.model,
        prompt,
        size: params.size,
        quality: params.quality,
        output_format: params.output_format,
        moderation: params.moderation,
        ...(params.output_format !== 'png' && params.output_compression != null ? { output_compression: params.output_compression } : {}),
        ...(params.n > 1 ? { n: params.n } : {}),
      }),
      signal,
    });
  }

  if (!response.ok) {
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
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ==================== 认证路由 ====================

app.get('/api/auth/github', async (req, res) => {
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
  res.redirect(githubAuthUrl.toString());
});

app.get('/api/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return redirectWithError(res, 'no_code');
  }

  if (!state || state !== req.session.oauthState) {
    return redirectWithError(res, 'invalid_state');
  }

  try {
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    }, {
      headers: { Accept: 'application/json' }
    });

    const accessToken = tokenResponse.data.access_token;

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const githubUser = userResponse.data;

    const [rows] = await db.query(
      'SELECT * FROM users WHERE github_id = ?',
      [githubUser.id.toString()]
    );

    let userId;
    if (rows.length > 0) {
      userId = rows[0].id;
      await db.query(
        'UPDATE users SET username = ?, avatar_url = ?, email = ?, updated_at = NOW() WHERE id = ?',
        [githubUser.login, githubUser.avatar_url, githubUser.email, userId]
      );
    } else {
      const [result] = await db.query(
        'INSERT INTO users (github_id, username, avatar_url, email) VALUES (?, ?, ?, ?)',
        [githubUser.id.toString(), githubUser.login, githubUser.avatar_url, githubUser.email]
      );
      userId = result.insertId;
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
    res.redirect(process.env.APP_ORIGIN || 'http://localhost:5173');
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    redirectWithError(res, 'auth_failed');
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, github_id, username, avatar_url, email, created_at FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (rows.length === 0) {
      clearSessionCookie(res);
      await destroySession(req).catch(() => {});
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    if (req.session) {
      await destroySession(req);
    }
    clearSessionCookie(res);
    res.set('Clear-Site-Data', '"cache", "storage"');
    res.set('Cache-Control', 'no-store');
    res.json({ success: true });
  } catch (err) {
    console.error('Logout failed:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ==================== 用户设置路由 ====================

app.get('/api/settings', requireAuth, async (req, res) => {
  try {
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
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/settings', requireAuth, async (req, res) => {
  try {
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

    res.json({ success: true });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== 任务路由 ====================

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000',
      [req.session.userId]
    );

    const tasks = rows.map(task => ({
      ...task,
      params: typeof task.params === 'string' ? JSON.parse(task.params) : task.params,
      input_image_ids: typeof task.input_image_ids === 'string' ? JSON.parse(task.input_image_ids) : task.input_image_ids,
      output_image_ids: typeof task.output_image_ids === 'string' ? JSON.parse(task.output_image_ids) : task.output_image_ids
    }));

    res.json(tasks);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const { id, prompt, params, input_image_ids, started_at } = req.body;

    await db.query(
      'INSERT INTO tasks (id, user_id, prompt, status, params, input_image_ids, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.session.userId, prompt, 'running', JSON.stringify(params), JSON.stringify(input_image_ids || []), started_at]
    );

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, error_message, output_image_ids, finished_at } = req.body;

    await db.query(
      'UPDATE tasks SET status = ?, error_message = ?, output_image_ids = ?, finished_at = ? WHERE id = ? AND user_id = ?',
      [status, error_message, JSON.stringify(output_image_ids || []), finished_at, id, req.session.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id = ? AND user_id = ?',
      [id, req.session.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/tasks', requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE tasks SET deleted_at = NOW() WHERE user_id = ? AND deleted_at IS NULL', [req.session.userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Clear tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== 生成代理路由 ====================

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const result = await callUpstreamImageApi(req.session.userId, req.body);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    console.error('Generate image error:', error.response?.data || error.message || error);
    const status = error.response?.status || 500;
    const message = error.response?.data?.error?.message || error.response?.data?.message || error.message || 'Generate failed';
    res.status(status).json({ error: message });
  }
});

// ==================== 图片路由 ====================

app.post('/api/images/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileBuffer = await fs.readFile(req.file.path);
    const imageId = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const fileUrl = `${process.env.IMAGE_BASE_URL}/${req.file.filename}`;

    const [existing] = await db.query('SELECT id, file_url FROM images WHERE id = ?', [imageId]);

    if (existing.length > 0) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.json({ id: imageId, url: existing[0].file_url });
    }

    await db.query(
      'INSERT INTO images (id, user_id, file_path, file_url, file_size, mime_type, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [imageId, req.session.userId, req.file.path, fileUrl, req.file.size, req.file.mimetype, 'upload']
    );

    res.json({ id: imageId, url: fileUrl });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/images/save', requireAuth, async (req, res) => {
  try {
    const { dataUrl, source = 'generated' } = req.body;

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid data URL' });
    }

    const imageId = crypto.createHash('sha256').update(dataUrl).digest('hex');

    const [existing] = await db.query('SELECT id, file_url FROM images WHERE id = ?', [imageId]);

    if (existing.length > 0) {
      return res.json({ id: imageId, url: existing[0].file_url });
    }

    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid data URL format' });
    }

    const ext = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const uploadDir = process.env.IMAGE_UPLOAD_DIR || '/data/images';
    await fs.mkdir(uploadDir, { recursive: true });

    const filename = `${imageId}.${ext}`;
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, buffer);

    const fileUrl = `${process.env.IMAGE_BASE_URL}/${filename}`;

    await db.query(
      'INSERT INTO images (id, user_id, file_path, file_url, file_size, mime_type, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [imageId, req.session.userId, filePath, fileUrl, buffer.length, `image/${ext}`, source]
    );

    res.json({ id: imageId, url: fileUrl });
  } catch (error) {
    console.error('Save image error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/images/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      'SELECT id, file_url, file_size, mime_type, source, created_at FROM images WHERE id = ? AND user_id = ?',
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
  console.log(`🚀 Server running on port ${PORT}`);
});
