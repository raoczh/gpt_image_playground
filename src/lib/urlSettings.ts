/**
 * Query string settings 编解码（A-7 / B-1）。
 *
 * 支持的格式：
 *   ?apiUrl=&apiKey=          —— 老格式，仅覆盖 baseUrl + apiKey（已在 App.tsx 处理）
 *   ?settings=<base64-json>   —— 新格式，包含完整 Profile 字段。可用于分享 / 跨设备携带配置
 *
 * 编码后会自动 base64-url（避免 URL 特殊字符），结构示例：
 * {
 *   name: 'Azure',
 *   provider: 'openai',
 *   base_url: 'https://...',
 *   api_key: 'sk-...',
 *   model: 'gpt-image-1',
 *   timeout: 600,
 *   api_format: 'responses',
 * }
 */

export interface ShareableProfile {
  name?: string
  provider?: string
  base_url?: string
  api_key?: string
  model?: string
  timeout?: number
  api_format?: 'imagen' | 'responses'
  extra?: Record<string, unknown>
}

function base64UrlEncode(str: string): string {
  // Unicode 安全的 base64：先 encodeURIComponent → escape bytes → btoa
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeShareableProfile(profile: ShareableProfile): string {
  return base64UrlEncode(JSON.stringify(profile))
}

export function decodeShareableProfile(encoded: string): ShareableProfile | null {
  try {
    const json = base64UrlDecode(encoded)
    const obj = JSON.parse(json)
    if (!obj || typeof obj !== 'object') return null
    return obj as ShareableProfile
  } catch {
    return null
  }
}

/** 把当前完整的 url（含 base 和 path）拼上 ?settings= 后返回 */
export function buildShareUrl(profile: ShareableProfile, baseUrl: string = window.location.origin + window.location.pathname): string {
  const encoded = encodeShareableProfile(profile)
  const url = new URL(baseUrl)
  url.searchParams.set('settings', encoded)
  return url.toString()
}

/** 尝试从原始 JSON 字符串构造 ShareableProfile（允许 base64-url 或纯 JSON） */
export function parseImportInput(input: string): ShareableProfile | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // 先按 JSON 试
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      return obj && typeof obj === 'object' ? (obj as ShareableProfile) : null
    } catch {
      return null
    }
  }
  // 再按 base64 试
  return decodeShareableProfile(trimmed)
}
