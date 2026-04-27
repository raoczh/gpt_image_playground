import type { AppSettings, TaskParams } from '../types'
export { normalizeBaseUrl } from './devProxy'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
}

export interface CallApiResult {
  images: string[]
}

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const timeoutMs = Math.max(Number(opts.settings.timeout) || 600, 10) * 1000
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
    body: JSON.stringify(opts),
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
