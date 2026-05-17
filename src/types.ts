// ===== 设置 =====

export type ApiFormat = 'imagen' | 'responses'
export type BuiltInApiProvider = 'openai'
export type ApiProvider = BuiltInApiProvider | string

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  /** 后端仅返回掩码 */
  apiKeyMasked: string
  model: string
  timeout: number
  apiFormat: ApiFormat
  extra: Record<string, unknown>
  isDefault: boolean
}

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: string | null
  submit: Record<string, unknown> | null
  editSubmit?: Record<string, unknown> | null
  poll?: Record<string, unknown> | null
}

export interface AppSettings {
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiFormat: ApiFormat
}

const DEFAULT_BASE_URL = ''

export const MASKED_KEY = '******'

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  model: 'gpt-5.3-codex',
  timeout: 600,
  apiFormat: 'responses',
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  /** 输入图片的 URL 列表（用于详情展示和放大预览） */
  inputImageUrls: string[]
  /** 输入图片的缩略图 URL 列表（与 inputImageUrls 一一对应；缺失时为空串） */
  inputThumbnails: string[]
  /** 输出图片的 URL 列表 */
  outputImages: string[]
  /** 输出图片的缩略图 URL 列表（与 outputImages 一一对应；缺失时为空串） */
  outputThumbnails: string[]
  status: TaskStatus
  /** 是否收藏 */
  isFavorite: boolean
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 */
  source?: 'upload' | 'generated'
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
}

// ===== Responses API 响应 =====

export interface ResponsesApiOutput {
  type: string
  result?: string
}

export interface ResponsesApiResponse {
  output: ResponsesApiOutput[]
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  settings: AppSettings
  tasks: TaskRecord[]
  /** imageId → 图片信息 */
  imageFiles: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated'
  }>
}
