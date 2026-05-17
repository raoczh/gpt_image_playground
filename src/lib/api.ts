import type { TaskParams } from '../types'
export { normalizeBaseUrl } from './devProxy'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export interface CallApiOptions {
  prompt: string
  params: TaskParams
  inputImageIds: string[]
  /** 关联的 task ID，服务端用它来直接更新 tasks 表状态，避免依赖前端回调 */
  taskId: string
  /** 上游超时（秒），客户端会自动多加 10s 容差再发起 abort */
  timeoutSec?: number
  /** 蒙版编辑产生的 mask data URL；后端 edits 路径把它直接 append 到 FormData */
  maskDataUrl?: string
  /** 蒙版目标图 ID，用于校验 mask 与目标图属于同一张参考图 */
  maskTargetImageId?: string
  /** 使用的 API Profile ID；缺省时后端取默认 profile */
  profileId?: string
}

export interface GeneratedImage {
  id: string
  url: string
  /** 缩略图 URL；缺失时为空字符串，调用方需要 fallback 到 url */
  thumb: string
}

export interface CallApiResult {
  images: GeneratedImage[]
}

const DEFAULT_TIMEOUT_SEC = 600
const CLIENT_TIMEOUT_BUFFER_MS = 10_000

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const upstreamTimeoutSec = opts.timeoutSec && opts.timeoutSec > 0 ? opts.timeoutSec : DEFAULT_TIMEOUT_SEC
  const timeoutMs = upstreamTimeoutSec * 1000 + CLIENT_TIMEOUT_BUFFER_MS
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await fetch(`${API_BASE_URL}/api/generate`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, max-age=0',
      Pragma: 'no-cache',
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      params: opts.params,
      inputImageIds: opts.inputImageIds,
      taskId: opts.taskId,
      maskDataUrl: opts.maskDataUrl,
      maskTargetImageId: opts.maskTargetImageId,
      profileId: opts.profileId,
    }),
    signal,
  })

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`
    try {
      const errJson = await response.json()
      if (errJson.error?.message) errorMsg = errJson.error.message
      else if (errJson.error) errorMsg = errJson.error
      else if (errJson.message) errorMsg = errJson.message
    } catch {
      try {
        errorMsg = await response.text()
      } catch {
        /* ignore */
      }
    }
    throw new Error(errorMsg)
  }

  const payload = await response.json() as CallApiResult
  if (!Array.isArray(payload.images) || !payload.images.length) {
    throw new Error('接口未返回可用图片数据')
  }

  return payload
}
