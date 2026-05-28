import express from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { checkDailyGenerationQuota, checkStorageQuota } from '../quota.js';
import { callUpstreamImageApi, friendlyUpstreamMessage } from '../services/upstreamImageApi.js';
import { saveGeneratedImageBytes } from '../services/imageStorage.js';
import { formatBytes, logBox, truncateForLog } from '../services/logging.js';

const app = express.Router();

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
        // A-2：构建结构化的 raw_response_payload，包含请求元数据和清理后的响应
        let rawPayloadJson = null;
        try {
          // 构建可读的结构化数据
          const structuredPayload = {
            request: result.requestMeta || null,
            response: {
              imageCount: saved.length,
              images: saved.map((s, i) => ({
                id: s.id,
                url: s.url,
                ...(result.rawImageUrls?.[i] ? { rawUrl: result.rawImageUrls[i] } : {}),
              })),
              actualParams: result.actualParams || null,
              revisedPrompts: result.revisedPrompts || null,
            },
          };
          // 也保留原始上游响应（去掉 base64 数据以节省空间）
          if (result.rawPayload) {
            const cleanPayload = JSON.parse(JSON.stringify(result.rawPayload));
            // 清理 responses 格式中的 base64 数据
            if (Array.isArray(cleanPayload?.output)) {
              for (const item of cleanPayload.output) {
                if (item.result && typeof item.result === 'string' && item.result.length > 200) {
                  item.result = `[base64 ${formatBytes(Math.floor(item.result.length * 0.75))}]`;
                }
              }
            }
            // 清理 imagen 格式中的 base64 数据
            if (Array.isArray(cleanPayload?.data)) {
              for (const item of cleanPayload.data) {
                if (item.b64_json && typeof item.b64_json === 'string' && item.b64_json.length > 200) {
                  item.b64_json = `[base64 ${formatBytes(Math.floor(item.b64_json.length * 0.75))}]`;
                }
              }
            }
            structuredPayload.upstream = cleanPayload;
          }
          const str = JSON.stringify(structuredPayload);
          // 64KB 上限
          rawPayloadJson = str.length > 64 * 1024 ? str.slice(0, 64 * 1024) + '...[truncated]' : str;
        } catch {
          rawPayloadJson = null;
        }
        const apiSettings = callContext.apiSettings || {};
        // 输出图片尺寸
        const outputImageSizes = saved.map((s) => s.dims || null);
        await db.query(
          `UPDATE tasks
           SET status = ?, output_image_ids = ?, output_image_sizes = ?, finished_at = ?,
               actual_params = ?, revised_prompt_by_image = ?,
               raw_response_payload = ?, raw_image_urls = ?, request_meta = ?,
               api_profile_id = COALESCE(api_profile_id, ?),
               api_profile_name = COALESCE(api_profile_name, ?),
               api_provider = COALESCE(api_provider, ?),
               api_model = COALESCE(api_model, ?)
           WHERE id = ? AND user_id = ?`,
          [
            'done',
            JSON.stringify(saved.map((s) => s.id)),
            JSON.stringify(outputImageSizes),
            Date.now(),
            result.actualParams ? JSON.stringify(result.actualParams) : null,
            Object.keys(revisedPromptByImage).length > 0 ? JSON.stringify(revisedPromptByImage) : null,
            rawPayloadJson,
            result.rawImageUrls ? JSON.stringify(result.rawImageUrls) : null,
            result.requestMeta ? JSON.stringify(result.requestMeta) : null,
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
    const dimsSummary = saved.map((s, i) => s.dims ? `#${i + 1} ${s.dims.w}×${s.dims.h}` : `#${i + 1} ?`).join(', ');
    logBox('GENERATE COMPLETE', [
      `User:     ${req.session.userId}`,
      `Task:     ${taskId || 'none'}`,
      `Images:   ${saved.length} [${dimsSummary}]`,
      `Time:     ${elapsed}s`,
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ images: saved });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    logBox('GENERATE FAILED', [
      `User:     ${req.session.userId}`,
      `Task:     ${taskId || 'none'}`,
      `Time:     ${elapsed}s`,
      `Error:    ${error.name}: ${truncateForLog(error.message, 200)}`,
      ...(error.cause ? [`Cause:    ${truncateForLog(String(error.cause), 150)}`] : []),
    ]);
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

export default app;
