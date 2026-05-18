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
import { requireAuth, requireAdmin, requireSession, invalidateUserCache } from './auth.js';
import createAdminRouter from './adminRouter.js';
import { getSystemConfig } from './systemConfig.js';
import { checkDailyGenerationQuota, checkStorageQuota, getQuotaSummary } from './quota.js';
import { logAudit } from './audit.js';

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

async function loadUserApiSettings(userId, profileId = null) {
  // 1. 如果指定 profileId，优先从 user_api_profiles 加载该 profile
  if (profileId) {
    const [profileRows] = await db.query(
      'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings FROM user_api_profiles WHERE id = ? AND user_id = ?',
      [profileId, userId]
    );
    if (profileRows.length) return profileRowToSettings(profileRows[0]);
  }

  // 2. 取默认 profile
  const [defaultRows] = await db.query(
    'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings FROM user_api_profiles WHERE user_id = ? AND is_default = 1 ORDER BY created_at ASC LIMIT 1',
    [userId]
  );
  if (defaultRows.length) return profileRowToSettings(defaultRows[0]);

  // 3. 取该用户第一条 profile（如果有的话）
  const [firstRows] = await db.query(
    'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings FROM user_api_profiles WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
    [userId]
  );
  if (firstRows.length) return profileRowToSettings(firstRows[0]);

  // 4. 回退到旧版 user_settings 表（兼容）
  const [rows] = await db.query(
    'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
    [userId]
  );
  return resolveApiSettings(rows[0]);
}

function profileRowToSettings(row) {
  const extra = row.extra_settings
    ? (typeof row.extra_settings === 'string' ? JSON.parse(row.extra_settings) : row.extra_settings)
    : {};
  return {
    profileId: row.id,
    profileName: row.name,
    provider: row.provider || 'openai',
    baseUrl: row.base_url || process.env.DEFAULT_API_URL || '',
    apiKey: row.api_key || process.env.DEFAULT_API_KEY || '',
    model: row.model || 'gpt-image-1',
    timeout: Number(row.timeout || 600),
    apiFormat: row.api_format || 'responses',
    extra,
  };
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

async function callUpstreamImageApi(userId, payload, ctx) {
  console.log(`[${new Date().toISOString()}] 📡 Loading API settings for user ${userId}, profileId=${payload.profileId || 'default'}`);
  const apiSettings = await loadUserApiSettings(userId, payload.profileId || null);
  // 把已加载的 profile 信息回写出去（task 快照）
  if (ctx) {
    ctx.apiSettings = apiSettings;
  }
  const baseUrl = normalizeBaseUrl(apiSettings.baseUrl);

  console.log(`[${new Date().toISOString()}] ⚙️  API Config - Provider: ${apiSettings.provider}, BaseURL: ${baseUrl}, Model: ${apiSettings.model}, Timeout: ${apiSettings.timeout}s, Format: ${apiSettings.apiFormat}`);

  if (!baseUrl) {
    throw new Error('未配置默认 API URL');
  }
  if (!apiSettings.apiKey) {
    throw new Error('未配置默认 API Key');
  }

  const { prompt, params, inputImageIds, maskDataUrl, maskTargetImageId } = payload;
  const inputImageDataUrls = await loadInputImageDataUrls(userId, inputImageIds);
  const isEdit = inputImageDataUrls.length > 0;
  const mime = MIME_MAP[params.output_format] || 'image/png';
  const timeout = Math.max(Number(apiSettings.timeout) || 600, 10) * 1000;
  const signal = AbortSignal.timeout(timeout);

  if (apiSettings.provider && apiSettings.provider !== 'openai') {
    // 只支持 OpenAI 兼容路径；其他 provider 在本部署下未启用
    const err = new Error(`Provider "${apiSettings.provider}" 未启用，请使用 OpenAI 兼容配置`);
    err.statusCode = 400;
    throw err;
  }

  return callOpenAIImageApi({
    apiSettings,
    baseUrl,
    prompt,
    params,
    inputImageDataUrls,
    isEdit,
    mime,
    maskDataUrl,
    maskTargetImageId,
    signal,
    timeout,
  });
}

async function callOpenAIImageApi(opts) {
  const { apiSettings, baseUrl, prompt, params, inputImageDataUrls, isEdit, mime, maskDataUrl, maskTargetImageId, signal } = opts;
  const authHeaders = {
    Authorization: `Bearer ${apiSettings.apiKey}`,
    'Cache-Control': 'no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
  };

  console.log(`[${new Date().toISOString()}] 🔧 OpenAI Request - IsEdit: ${isEdit}, Size: ${params.size}, Quality: ${params.quality}, Format: ${params.output_format}`);

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
    const revisedPrompts = [];
    const actualParamsCollected = {};
    for (const item of outputs) {
      if (item.type === 'image_generation_call' && item.result) {
        images.push(normalizeBase64Image(item.result, mime));
        if (typeof item.revised_prompt === 'string' && item.revised_prompt) {
          revisedPrompts.push(item.revised_prompt);
        }
        // 收集 API 实际响应里的 size / quality / output_format 等参数
        for (const key of ['size', 'quality', 'output_format', 'output_compression', 'moderation']) {
          if (item[key] !== undefined && actualParamsCollected[key] === undefined) {
            actualParamsCollected[key] = item[key];
          }
        }
      }
    }

    if (!images.length) {
      throw new Error('接口未返回可用图片数据');
    }

    return {
      images,
      actualParams: Object.keys(actualParamsCollected).length > 0 ? actualParamsCollected : null,
      revisedPrompts: revisedPrompts.length > 0 ? revisedPrompts : null,
      rawPayload: payloadJson,
      rawImageUrls: null,
    };
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

    // 蒙版编辑：把 maskDataUrl append 到 FormData。要求 mask 与第一张参考图（target）对齐
    if (maskDataUrl && typeof maskDataUrl === 'string') {
      const maskMatches = maskDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (maskMatches) {
        const maskBlob = new Blob([Buffer.from(maskMatches[2], 'base64')], { type: maskMatches[1] });
        formData.append('mask', maskBlob, 'mask.png');
        console.log(`[${new Date().toISOString()}] 🎨 Added mask: ${maskMatches[1]}, size: ${maskBlob.size} bytes, targetId: ${maskTargetImageId || 'n/a'}`);
      } else {
        console.warn(`[${new Date().toISOString()}] ⚠️  Invalid maskDataUrl format, mask skipped`);
      }
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
  const rawImageUrls = [];
  const revisedPrompts = [];
  for (const item of data) {
    if (typeof item.revised_prompt === 'string' && item.revised_prompt) {
      revisedPrompts.push(item.revised_prompt);
    }
    if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) {
      rawImageUrls.push(item.url);
    }
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

  // images/edits 和 images/generations 响应里 size/quality 通常以 payload 顶层字段返回
  const actualParams = {};
  for (const key of ['size', 'quality', 'output_format', 'output_compression', 'moderation']) {
    if (payloadJson[key] !== undefined) actualParams[key] = payloadJson[key];
  }

  return {
    images,
    actualParams: Object.keys(actualParams).length > 0 ? actualParams : null,
    revisedPrompts: revisedPrompts.length > 0 ? revisedPrompts : null,
    rawPayload: payloadJson,
    rawImageUrls: rawImageUrls.length > 0 ? rawImageUrls : null,
  };
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
const sessionStoreInstance = redisClient ? new RedisStore({ client: redisClient }) : null;
const sessionConfig = {
  name: sessionCookieName,
  secret: process.env.SESSION_SECRET,
  resave: false,
  rolling: true,
  saveUninitialized: false,
  cookie: sessionCookieOptions,
};

if (sessionStoreInstance) {
  sessionConfig.store = sessionStoreInstance;
}

app.use(session(sessionConfig));

// 维护模式中间件：开启时拒绝业务请求，但 admin 永远可访问、auth 路由保留
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/admin')) return next();
  if (req.path.startsWith('/api/auth')) return next();
  if (req.path.startsWith('/api/public')) return next();
  if (req.path === '/api/quota') return next();
  try {
    const enabled = await getSystemConfig('maintenance_mode');
    if (enabled === true) {
      const message = (await getSystemConfig('maintenance_message')) || '系统维护中，请稍后再试';
      return res.status(503).json({ error: 'maintenance', message });
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ⚠️  Maintenance mode check failed: ${err.message}`);
  }
  next();
});

// 公开配置接口：前端横幅 / 维护页 / 登录前展示用，无需认证
app.get('/api/public/site-config', async (_req, res) => {
  try {
    const [maintenance, message, announcement, registrationMode, reviewMessage] = await Promise.all([
      getSystemConfig('maintenance_mode'),
      getSystemConfig('maintenance_message'),
      getSystemConfig('announcement'),
      getSystemConfig('registration_mode'),
      getSystemConfig('review_message'),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      maintenance_mode: maintenance === true,
      maintenance_message: message || '',
      announcement: announcement || null,
      registration_mode: registrationMode || 'open',
      review_message: reviewMessage || '',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Site config error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

// ==================== 认证路由 ====================
// 认证中间件 (requireAuth / requireAdmin / requireSession) 由 ./auth.js 提供
// requireAuth 会查 users 表（30s 缓存）拦截 disabled / pending / 软删用户

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
      if (rows[0].deleted_at) {
        console.warn(`[${new Date().toISOString()}] 🚫 Login blocked - user soft-deleted: ${userId}`);
        return redirectWithError(res, 'account_deleted');
      }
      if (rows[0].status === 'disabled') {
        console.warn(`[${new Date().toISOString()}] 🚫 Login blocked - user disabled: ${userId}`);
        return redirectWithError(res, 'disabled');
      }
      await db.query(
        'UPDATE users SET username = ?, avatar_url = ?, email = ?, last_login_at = NOW(), updated_at = NOW() WHERE id = ?',
        [githubUser.login, githubUser.avatar_url, githubUser.email, userId]
      );
      invalidateUserCache(userId);
    } else {
      // M5：按 registration_mode 决定新用户创建策略
      const registrationMode = (await getSystemConfig('registration_mode')) || 'open';
      let initialStatus = 'active';

      if (registrationMode === 'allowlist') {
        const username = String(githubUser.login || '').toLowerCase();
        const [allowRows] = await db.query(
          'SELECT id FROM registration_allowlist WHERE github_username = ?',
          [username]
        );
        if (!allowRows.length) {
          console.warn(`[${new Date().toISOString()}] 🚫 Registration blocked - not in allowlist: ${username}`);
          return redirectWithError(res, 'not_allowed');
        }
        initialStatus = 'active';
      } else if (registrationMode === 'review') {
        initialStatus = 'pending';
      }

      console.log(`[${new Date().toISOString()}] ➕ Creating new user (mode=${registrationMode}, status=${initialStatus})`);
      const [result] = await db.query(
        'INSERT INTO users (github_id, username, avatar_url, email, status, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [githubUser.id.toString(), githubUser.login, githubUser.avatar_url, githubUser.email, initialStatus]
      );
      userId = result.insertId;
      console.log(`[${new Date().toISOString()}] ✅ New user created with ID ${userId}`);

      // M5：注入默认 Profile（如配置）
      try {
        const defaultProfile = await getSystemConfig('default_api_profile');
        if (defaultProfile && typeof defaultProfile === 'object') {
          const profileId = generateProfileId();
          await db.query(
            `INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              profileId,
              userId,
              String(defaultProfile.name || '默认').slice(0, 100),
              String(defaultProfile.provider || 'openai'),
              String(defaultProfile.base_url || ''),
              String(defaultProfile.api_key || ''),
              String(defaultProfile.model || ''),
              Math.max(10, Math.min(3600, Number(defaultProfile.timeout) || 600)),
              defaultProfile.api_format === 'imagen' ? 'imagen' : 'responses',
              defaultProfile.extra && typeof defaultProfile.extra === 'object' ? JSON.stringify(defaultProfile.extra) : null,
            ]
          );
          console.log(`[${new Date().toISOString()}] 🎁 Injected default profile for new user ${userId}`);
        }
      } catch (err) {
        console.error(`[${new Date().toISOString()}] ⚠️  Failed to inject default profile: ${err.message}`);
      }
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

app.use('/api/admin', createAdminRouter(db, { sessionStore: sessionStoreInstance, generateProfileId }));

app.get('/api/quota', requireAuth, async (req, res) => {
  try {
    const summary = await getQuotaSummary(req.session.userId);
    res.json(summary);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Quota summary error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/me', requireSession, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, github_id, username, avatar_url, email, role, status, last_login_at, created_at FROM users WHERE id = ? AND deleted_at IS NULL',
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

// ==================== 用户偏好（A-6 习惯开关） ====================
// 偏好持久化到 user_settings.settings JSON 的 preferences 子对象
// 与 API 配置（base_url/api_key）分离，避免互相影响
//
// 默认值与前端 DEFAULT_SETTINGS 保持一致；后端只透传，不做业务校验
const PREFERENCE_KEYS = [
  'enterSubmit',
  'clearInputAfterSubmit',
  'persistInputOnRestart',
  'reuseTaskApiProfileTemporarily',
  'alwaysShowRetryButton',
];

function pickPreferences(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const key of PREFERENCE_KEYS) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
}

app.get('/api/preferences', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = ?',
      [req.session.userId]
    );
    const raw = rows[0]?.settings;
    const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
    const prefs = pickPreferences(parsed?.preferences);
    res.json({ preferences: prefs });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get preferences error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/preferences', requireAuth, async (req, res) => {
  try {
    const incoming = pickPreferences(req.body?.preferences);

    // 读现有 settings JSON，合并 preferences 子对象后写回，避免覆盖其他字段（model/timeout/apiFormat 等历史字段）
    const [rows] = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = ?',
      [req.session.userId]
    );
    const current = rows[0]?.settings
      ? (typeof rows[0].settings === 'string' ? JSON.parse(rows[0].settings) : rows[0].settings)
      : {};
    const next = {
      ...current,
      preferences: { ...(current.preferences || {}), ...incoming },
    };

    await db.query(
      `INSERT INTO user_settings (user_id, settings)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE settings = ?, updated_at = NOW()`,
      [req.session.userId, JSON.stringify(next), JSON.stringify(next)]
    );

    res.json({ success: true, preferences: next.preferences });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update preferences error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== API Profiles 路由 ====================

function generateProfileId() {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function maskApiKey(key) {
  return key ? '••••••••••••••••' : '';
}

function profileRowToJson(row) {
  const extra = row.extra_settings
    ? (typeof row.extra_settings === 'string' ? JSON.parse(row.extra_settings) : row.extra_settings)
    : {};
  return {
    id: row.id,
    name: row.name,
    provider: row.provider || 'openai',
    base_url: row.base_url || '',
    api_key_masked: maskApiKey(row.api_key),
    model: row.model || '',
    timeout: Number(row.timeout || 600),
    api_format: row.api_format || 'responses',
    extra,
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

app.get('/api/profiles', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default, created_at, updated_at FROM user_api_profiles WHERE user_id = ? ORDER BY is_default DESC, created_at ASC',
      [req.session.userId]
    );

    // 如果该用户还没有 profile，但 user_settings 表有旧记录，自动迁移一条默认 profile
    if (!rows.length) {
      const [legacyRows] = await db.query(
        'SELECT api_url, api_key, settings FROM user_settings WHERE user_id = ?',
        [req.session.userId]
      );
      if (legacyRows.length) {
        const legacy = legacyRows[0];
        const settings = legacy.settings
          ? (typeof legacy.settings === 'string' ? JSON.parse(legacy.settings) : legacy.settings)
          : {};
        const id = `default-${req.session.userId}`;
        await db.query(
          `INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            id,
            req.session.userId,
            '默认',
            'openai',
            legacy.api_url || '',
            legacy.api_key || '',
            settings.model || 'gpt-image-1',
            Number(settings.timeout || 600),
            settings.apiFormat || 'responses',
          ]
        );
        return res.json({
          profiles: [
            {
              id,
              name: '默认',
              provider: 'openai',
              base_url: legacy.api_url || '',
              api_key_masked: maskApiKey(legacy.api_key),
              model: settings.model || 'gpt-image-1',
              timeout: Number(settings.timeout || 600),
              api_format: settings.apiFormat || 'responses',
              extra: {},
              is_default: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        });
      }
    }

    res.json({ profiles: rows.map(profileRowToJson) });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get profiles error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/profiles', requireAuth, async (req, res) => {
  try {
    const { name, provider, base_url, api_key, model, timeout, api_format, extra, is_default } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name 不能为空' });
    }
    const id = generateProfileId();
    const profile = {
      id,
      name: name.trim().slice(0, 100),
      provider: typeof provider === 'string' && provider ? provider : 'openai',
      base_url: typeof base_url === 'string' ? base_url : '',
      api_key: typeof api_key === 'string' ? api_key : '',
      model: typeof model === 'string' ? model : '',
      timeout: Math.max(10, Math.min(3600, Number(timeout) || 600)),
      api_format: api_format === 'imagen' ? 'imagen' : 'responses',
      extra_settings: extra && typeof extra === 'object' ? JSON.stringify(extra) : null,
      is_default: is_default ? 1 : 0,
    };

    if (profile.is_default) {
      await db.query('UPDATE user_api_profiles SET is_default = 0 WHERE user_id = ?', [req.session.userId]);
    }

    await db.query(
      `INSERT INTO user_api_profiles (id, user_id, name, provider, base_url, api_key, model, timeout, api_format, extra_settings, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        req.session.userId,
        profile.name,
        profile.provider,
        profile.base_url,
        profile.api_key,
        profile.model,
        profile.timeout,
        profile.api_format,
        profile.extra_settings,
        profile.is_default,
      ]
    );

    res.json({ success: true, id });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Create profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, provider, base_url, api_key, model, timeout, api_format, extra } = req.body || {};

    const updates = [];
    const params = [];
    if (typeof name === 'string' && name.trim()) {
      updates.push('name = ?');
      params.push(name.trim().slice(0, 100));
    }
    if (typeof provider === 'string' && provider) {
      updates.push('provider = ?');
      params.push(provider);
    }
    if (typeof base_url === 'string') {
      updates.push('base_url = ?');
      params.push(base_url);
    }
    if (typeof api_key === 'string') {
      updates.push('api_key = ?');
      params.push(api_key);
    }
    if (typeof model === 'string') {
      updates.push('model = ?');
      params.push(model);
    }
    if (timeout !== undefined) {
      updates.push('timeout = ?');
      params.push(Math.max(10, Math.min(3600, Number(timeout) || 600)));
    }
    if (api_format !== undefined) {
      updates.push('api_format = ?');
      params.push(api_format === 'imagen' ? 'imagen' : 'responses');
    }
    if (extra !== undefined) {
      updates.push('extra_settings = ?');
      params.push(extra && typeof extra === 'object' ? JSON.stringify(extra) : null);
    }

    if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });

    params.push(id, req.session.userId);
    const [result] = await db.query(
      `UPDATE user_api_profiles SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Profile 不存在' });

    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    // 不允许删掉最后一个 profile
    const [rows] = await db.query('SELECT COUNT(*) AS count FROM user_api_profiles WHERE user_id = ?', [req.session.userId]);
    if (rows[0].count <= 1) {
      return res.status(400).json({ error: '至少保留一个 Profile' });
    }
    const [result] = await db.query('DELETE FROM user_api_profiles WHERE id = ? AND user_id = ?', [id, req.session.userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Profile 不存在' });

    // 如果删的是默认 profile，把第一条变成默认
    const [defRows] = await db.query('SELECT COUNT(*) AS count FROM user_api_profiles WHERE user_id = ? AND is_default = 1', [req.session.userId]);
    if (defRows[0].count === 0) {
      await db.query(
        'UPDATE user_api_profiles SET is_default = 1 WHERE id = (SELECT id FROM (SELECT id FROM user_api_profiles WHERE user_id = ? ORDER BY created_at ASC LIMIT 1) AS t)',
        [req.session.userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Delete profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/profiles/:id/default', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE user_api_profiles SET is_default = 0 WHERE user_id = ?', [req.session.userId]);
    const [result] = await db.query(
      'UPDATE user_api_profiles SET is_default = 1 WHERE id = ? AND user_id = ?',
      [id, req.session.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Profile 不存在' });
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Set default profile error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== Custom Providers 路由 ====================

app.get('/api/custom-providers', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, template, submit_config, edit_submit_config, poll_config, created_at, updated_at FROM user_custom_providers WHERE user_id = ? ORDER BY created_at ASC',
      [req.session.userId]
    );
    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      template: row.template,
      submit: row.submit_config ? (typeof row.submit_config === 'string' ? JSON.parse(row.submit_config) : row.submit_config) : null,
      editSubmit: row.edit_submit_config ? (typeof row.edit_submit_config === 'string' ? JSON.parse(row.edit_submit_config) : row.edit_submit_config) : null,
      poll: row.poll_config ? (typeof row.poll_config === 'string' ? JSON.parse(row.poll_config) : row.poll_config) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    res.json({ providers: items });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Get custom providers error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/custom-providers', requireAuth, async (req, res) => {
  try {
    const { name, template, submit, editSubmit, poll } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name 不能为空' });
    if (!submit || typeof submit !== 'object') return res.status(400).json({ error: 'submit 配置必填' });
    const id = `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await db.query(
      `INSERT INTO user_custom_providers (id, user_id, name, template, submit_config, edit_submit_config, poll_config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.session.userId,
        name.trim().slice(0, 100),
        typeof template === 'string' ? template : 'http-image',
        JSON.stringify(submit),
        editSubmit ? JSON.stringify(editSubmit) : null,
        poll ? JSON.stringify(poll) : null,
      ]
    );
    res.json({ success: true, id });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Create custom provider error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/custom-providers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, template, submit, editSubmit, poll } = req.body || {};
    const updates = [];
    const params = [];
    if (typeof name === 'string' && name.trim()) { updates.push('name = ?'); params.push(name.trim().slice(0, 100)); }
    if (typeof template === 'string') { updates.push('template = ?'); params.push(template); }
    if (submit !== undefined) { updates.push('submit_config = ?'); params.push(submit ? JSON.stringify(submit) : null); }
    if (editSubmit !== undefined) { updates.push('edit_submit_config = ?'); params.push(editSubmit ? JSON.stringify(editSubmit) : null); }
    if (poll !== undefined) { updates.push('poll_config = ?'); params.push(poll ? JSON.stringify(poll) : null); }
    if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });
    params.push(id, req.session.userId);
    const [result] = await db.query(
      `UPDATE user_custom_providers SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Custom provider 不存在' });
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Update custom provider error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/custom-providers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM user_custom_providers WHERE id = ? AND user_id = ?', [id, req.session.userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Custom provider 不存在' });
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Delete custom provider error:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== 任务路由 ====================
// admin 跨用户直通：任意写/读操作允许 admin 操作其他用户的资源
// helper：返回 { ownerId, isAdminAccess } 或 null
async function assertTaskAccess(taskId, req) {
  const [rows] = await db.query(
    'SELECT user_id FROM tasks WHERE id = ? AND deleted_at IS NULL',
    [taskId]
  );
  if (!rows.length) return null;
  const ownerId = Number(rows[0].user_id);
  const isOwner = ownerId === Number(req.user.id);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) return null;
  return { ownerId, isAdminAccess: !isOwner && isAdmin };
}

async function assertImageAccess(imageId, req) {
  const [rows] = await db.query(
    'SELECT user_id FROM images WHERE id = ? AND deleted_at IS NULL',
    [imageId]
  );
  if (!rows.length) return null;
  const ownerId = Number(rows[0].user_id);
  const isOwner = ownerId === Number(req.user.id);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) return null;
  return { ownerId, isAdminAccess: !isOwner && isAdmin };
}

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
        `SELECT id, file_url, thumb_url FROM images WHERE ${imageWhere.join(' AND ')}`,
        imageParams
      );
      for (const img of images) imageMap.set(img.id, { url: img.file_url, thumb: img.thumb_url || '' });
    }

    const items = parsedRows.map(({ task, inputImageIds, outputImageIds }) => {
      const inputImageUrls = inputImageIds.map(id => imageMap.get(id)?.url || '');
      const outputImageUrls = outputImageIds.map(id => imageMap.get(id)?.url || '');
      const inputThumbUrls = inputImageIds.map(id => imageMap.get(id)?.thumb || '');
      const outputThumbUrls = outputImageIds.map(id => imageMap.get(id)?.thumb || '');

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
        input_image_ids: inputImageIds,
        output_image_ids: outputImageIds,
        input_image_urls: inputImageUrls,
        output_image_urls: outputImageUrls,
        input_thumb_urls: inputThumbUrls,
        output_thumb_urls: outputThumbUrls,
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

// ==================== 生成代理路由 ====================

app.post('/api/generate', requireAuth, async (req, res) => {
  const startTime = Date.now();
  const taskId = req.body.taskId ? String(req.body.taskId) : null;
  console.log(`[${new Date().toISOString()}] 🎨 Generate request started - User: ${req.session.userId}, Task: ${taskId || 'none'}, Prompt: "${req.body.prompt?.substring(0, 50)}...", Input image IDs: ${req.body.inputImageIds?.length || 0}`);

  // M7: 配额校验
  const dailyCheck = await checkDailyGenerationQuota(req.session.userId);
  if (!dailyCheck.ok) {
    return res.status(429).json({ error: dailyCheck.message, code: dailyCheck.code });
  }
  // 存储配额预检：已超额直接拒绝（增量未知，仅用 0 做"是否已超"判断）
  const storagePrecheck = await checkStorageQuota(req.session.userId, 0);
  if (!storagePrecheck.ok) {
    return res.status(429).json({ error: storagePrecheck.message, code: storagePrecheck.code });
  }

  const callContext = {};
  try {
    const result = await callUpstreamImageApi(req.session.userId, req.body, callContext);

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

    // 存储配额事后兜底：本次生成把用户推过上限就回滚刚落盘的图片
    const storagePostCheck = await checkStorageQuota(req.session.userId, 0);
    if (!storagePostCheck.ok) {
      const justSavedIds = saved.map((s) => s.id).filter(Boolean);
      if (justSavedIds.length > 0) {
        await db.query(
          'UPDATE images SET deleted_at = NOW() WHERE id IN (?) AND user_id = ?',
          [justSavedIds, req.session.userId]
        ).catch(() => {});
      }
      return res.status(429).json({ error: storagePostCheck.message, code: storagePostCheck.code });
    }

    // 服务端直接接管 task 状态更新，避免依赖前端回调（前端断网时 task 仍能落 done）
    if (taskId) {
      try {
        // A-4 / A-5：把 revised_prompt 按 image id 对齐（同一索引）
        const revisedPromptByImage = {};
        if (Array.isArray(result.revisedPrompts)) {
          for (let i = 0; i < result.revisedPrompts.length && i < saved.length; i++) {
            revisedPromptByImage[saved[i].id] = result.revisedPrompts[i];
          }
        }
        // A-2：raw_response_payload 体积可能很大，做大小裁剪避免拖死 DB
        let rawPayloadJson = null;
        if (result.rawPayload) {
          try {
            const str = JSON.stringify(result.rawPayload);
            // 16KB 上限，超过则截掉，保留头部用于排查
            rawPayloadJson = str.length > 16 * 1024 ? str.slice(0, 16 * 1024) + '...[truncated]' : str;
          } catch {
            rawPayloadJson = null;
          }
        }
        const apiSettings = callContext.apiSettings || {};
        await db.query(
          `UPDATE tasks
           SET status = ?, output_image_ids = ?, finished_at = ?,
               actual_params = ?, revised_prompt_by_image = ?,
               raw_response_payload = ?, raw_image_urls = ?,
               api_profile_id = COALESCE(api_profile_id, ?),
               api_profile_name = COALESCE(api_profile_name, ?),
               api_provider = COALESCE(api_provider, ?),
               api_model = COALESCE(api_model, ?)
           WHERE id = ? AND user_id = ?`,
          [
            'done',
            JSON.stringify(saved.map((s) => s.id)),
            Date.now(),
            result.actualParams ? JSON.stringify(result.actualParams) : null,
            Object.keys(revisedPromptByImage).length > 0 ? JSON.stringify(revisedPromptByImage) : null,
            rawPayloadJson,
            result.rawImageUrls ? JSON.stringify(result.rawImageUrls) : null,
            apiSettings.profileId || null,
            apiSettings.profileName || null,
            apiSettings.provider || null,
            apiSettings.model || null,
            taskId,
            req.session.userId,
          ]
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

    // 同步把 task 写入 error 状态，前端断网时也有正确状态。同时落 raw_response_payload + profile 快照
    if (taskId) {
      try {
        const apiSettings = callContext.apiSettings || {};
        const rawPayloadStr = error.response?.data
          ? (() => {
              try {
                const s = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
                return s.length > 16 * 1024 ? s.slice(0, 16 * 1024) + '...[truncated]' : s;
              } catch {
                return null;
              }
            })()
          : null;
        await db.query(
          `UPDATE tasks
           SET status = ?, error_message = ?, finished_at = ?,
               raw_response_payload = COALESCE(?, raw_response_payload),
               api_profile_id = COALESCE(api_profile_id, ?),
               api_profile_name = COALESCE(api_profile_name, ?),
               api_provider = COALESCE(api_provider, ?),
               api_model = COALESCE(api_model, ?)
           WHERE id = ? AND user_id = ?`,
          [
            'error',
            message,
            Date.now(),
            rawPayloadStr,
            apiSettings.profileId || null,
            apiSettings.profileName || null,
            apiSettings.provider || null,
            apiSettings.model || null,
            taskId,
            req.session.userId,
          ]
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
