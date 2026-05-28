import { loadUserApiSettings } from './apiSettings.js';
import { loadInputImageDataUrls } from './imageStorage.js';

const MIME_MAP = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const PROMPT_REWRITE_GUARD_PREFIX = 'Use the following text as the complete prompt. Do not rewrite it:';

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

export function friendlyUpstreamMessage(raw) {
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

export async function callUpstreamImageApi(userId, payload, ctx) {
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
  const inputImageDataUrls = await loadInputImageDataUrls(inputImageIds);
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

// ─── 日志辅助工具 ───────────────────────────────────────────────────────────

function truncateForLog(str, maxLen = 80) {
  if (typeof str !== 'string') return String(str);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `...[${str.length} chars]`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function logBox(title, lines) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ┌─── ${title} ───`);
  for (const line of lines) {
    console.log(`[${ts}] │ ${line}`);
  }
  console.log(`[${ts}] └${'─'.repeat(title.length + 6)}`);
}

// ─── callOpenAIImageApi ─────────────────────────────────────────────────────

async function callOpenAIImageApi(opts) {
  const { apiSettings, baseUrl, prompt, params, inputImageDataUrls, isEdit, mime, maskDataUrl, maskTargetImageId, signal } = opts;
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

    // ─── 请求日志 ───
    const inputImageSummary = isEdit
      ? inputImageDataUrls.map((u, i) => {
          const m = u.match(/^data:(image\/[^;]+);base64,(.+)$/);
          return m ? `#${i + 1} ${m[1]} ${formatBytes(Buffer.from(m[2], 'base64').length)}` : `#${i + 1} unknown`;
        })
      : [];
    logBox('UPSTREAM REQUEST (responses)', [
      `Endpoint: POST ${endpoint}`,
      `Model:    ${apiSettings.model}`,
      `Prompt:   "${truncateForLog(prompt, 120)}"`,
      `Params:   size=${params.size} quality=${params.quality} format=${params.output_format} compression=${params.output_compression ?? 'N/A'} moderation=${params.moderation} n=${params.n || 1}`,
      `Tool:     ${JSON.stringify(tool)}`,
      `IsEdit:   ${isEdit}${isEdit ? ` (${inputImageDataUrls.length} images)` : ''}`,
      ...(inputImageSummary.length > 0 ? [`Images:   ${inputImageSummary.join(', ')}`] : []),
    ]);

    const requestMeta = {
      endpoint,
      method: 'responses',
      model: apiSettings.model,
      prompt: prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt,
      params: { size: params.size, quality: params.quality, output_format: params.output_format, output_compression: params.output_compression, moderation: params.moderation, n: params.n || 1 },
      isEdit,
      inputImageCount: inputImageDataUrls.length,
    };

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

    if (!response.ok) {
      logBox('UPSTREAM ERROR', [
        `Status:   ${response.status} ${response.statusText}`,
        `Time:     ${fetchElapsed}s`,
      ]);
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

    // ─── 响应日志 ───
    const imageSizesEstimate = images.map((img, i) => {
      const b64 = img.replace(/^data:[^;]+;base64,/, '');
      return `#${i + 1} ~${formatBytes(Math.floor(b64.length * 0.75))}`;
    });
    logBox('UPSTREAM RESPONSE (responses)', [
      `Status:   ${response.status}`,
      `Time:     ${fetchElapsed}s`,
      `Images:   ${images.length} [${imageSizesEstimate.join(', ')}]`,
      ...(Object.keys(actualParamsCollected).length > 0 ? [`Actual:   ${JSON.stringify(actualParamsCollected)}`] : []),
      ...(revisedPrompts.length > 0 ? revisedPrompts.map((rp, i) => `Revised#${i + 1}: "${truncateForLog(rp, 100)}"`) : []),
    ]);

    return {
      images,
      actualParams: Object.keys(actualParamsCollected).length > 0 ? actualParamsCollected : null,
      revisedPrompts: revisedPrompts.length > 0 ? revisedPrompts : null,
      rawPayload: payloadJson,
      rawImageUrls: null,
      requestMeta,
    };
  }

  // ─── imagen format (images/generations or images/edits) ───

  let response;
  let endpoint;
  let requestMeta;
  const fetchStartTime = Date.now();

  if (isEdit) {
    endpoint = `${baseUrl}/v1/images/edits`;

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

    // 解析输入图片元数据用于日志
    const inputImageMetas = [];
    for (let i = 0; i < inputImageDataUrls.length; i++) {
      const dataUrl = inputImageDataUrls[i];
      const matches = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!matches) continue;
      const blob = new Blob([Buffer.from(matches[2], 'base64')], { type: matches[1] });
      const ext = matches[1].split('/')[1] || 'png';
      formData.append('image[]', blob, `input-${i + 1}.${ext}`);
      inputImageMetas.push({ mime: matches[1], size: blob.size });
    }

    // 蒙版编辑：把 maskDataUrl append 到 FormData。要求 mask 与第一张参考图（target）对齐
    let maskInfo = null;
    if (maskDataUrl && typeof maskDataUrl === 'string') {
      const maskMatches = maskDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (maskMatches) {
        const maskBlob = new Blob([Buffer.from(maskMatches[2], 'base64')], { type: maskMatches[1] });
        formData.append('mask', maskBlob, 'mask.png');
        maskInfo = { mime: maskMatches[1], size: maskBlob.size, targetId: maskTargetImageId || null };
      } else {
        console.warn(`[${new Date().toISOString()}] ⚠️  Invalid maskDataUrl format, mask skipped`);
      }
    }

    // ─── 请求日志 ───
    logBox('UPSTREAM REQUEST (edits)', [
      `Endpoint: POST ${endpoint}`,
      `Model:    ${apiSettings.model}`,
      `Prompt:   "${truncateForLog(prompt, 120)}"`,
      `Params:   size=${params.size} quality=${params.quality} format=${params.output_format} compression=${params.output_compression ?? 'N/A'} moderation=${params.moderation} n=${params.n || 1}`,
      `Images:   ${inputImageMetas.map((m, i) => `#${i + 1} ${m.mime} ${formatBytes(m.size)}`).join(', ')}`,
      ...(maskInfo ? [`Mask:     ${maskInfo.mime} ${formatBytes(maskInfo.size)} target=${maskInfo.targetId || 'N/A'}`] : []),
    ]);

    requestMeta = {
      endpoint,
      method: 'edits',
      model: apiSettings.model,
      prompt: prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt,
      params: { size: params.size, quality: params.quality, output_format: params.output_format, output_compression: params.output_compression, moderation: params.moderation, n: params.n || 1 },
      isEdit: true,
      inputImageCount: inputImageMetas.length,
      hasMask: !!maskInfo,
    };

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
    endpoint = `${baseUrl}/v1/images/generations`;
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

    // ─── 请求日志 ───
    logBox('UPSTREAM REQUEST (generations)', [
      `Endpoint: POST ${endpoint}`,
      `Model:    ${apiSettings.model}`,
      `Prompt:   "${truncateForLog(prompt, 120)}"`,
      `Params:   size=${params.size} quality=${params.quality} format=${params.output_format} compression=${params.output_compression ?? 'N/A'} moderation=${params.moderation} n=${params.n || 1}`,
    ]);

    requestMeta = {
      endpoint,
      method: 'generations',
      model: apiSettings.model,
      prompt: prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt,
      params: { size: params.size, quality: params.quality, output_format: params.output_format, output_compression: params.output_compression, moderation: params.moderation, n: params.n || 1 },
      isEdit: false,
      inputImageCount: 0,
    };

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

  if (!response.ok) {
    logBox('UPSTREAM ERROR', [
      `Status:   ${response.status} ${response.statusText}`,
      `Time:     ${fetchElapsed}s`,
      `Endpoint: ${endpoint}`,
    ]);
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

  // ─── 响应日志 ───
  const imageSizesEstimate = images.map((img, i) => {
    const b64 = img.replace(/^data:[^;]+;base64,/, '');
    return `#${i + 1} ~${formatBytes(Math.floor(b64.length * 0.75))}`;
  });
  logBox(`UPSTREAM RESPONSE (${isEdit ? 'edits' : 'generations'})`, [
    `Status:   ${response.status}`,
    `Time:     ${fetchElapsed}s`,
    `Images:   ${images.length} [${imageSizesEstimate.join(', ')}]`,
    ...(rawImageUrls.length > 0 ? [`URLs:     ${rawImageUrls.map(u => truncateForLog(u, 100)).join(', ')}`] : []),
    ...(Object.keys(actualParams).length > 0 ? [`Actual:   ${JSON.stringify(actualParams)}`] : []),
    ...(revisedPrompts.length > 0 ? revisedPrompts.map((rp, i) => `Revised#${i + 1}: "${truncateForLog(rp, 100)}"`) : []),
  ]);

  return {
    images,
    actualParams: Object.keys(actualParams).length > 0 ? actualParams : null,
    revisedPrompts: revisedPrompts.length > 0 ? revisedPrompts : null,
    rawPayload: payloadJson,
    rawImageUrls: rawImageUrls.length > 0 ? rawImageUrls : null,
    requestMeta,
  };
}
