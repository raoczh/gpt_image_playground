import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  AppSettings,
  TaskParams,
  InputImage,
  TaskRecord,
  ExportData,
  MaskDraft,
  ApiProfile,
  CustomProviderDefinition,
} from './types'
import { DEFAULT_SETTINGS, DEFAULT_PARAMS } from './types'
import {
  getAllTasks,
  putTask,
  getImage,
  getAllImages,
  putImage,
  deleteImage,
  clearImages,
  hashDataUrl,
} from './lib/db'
import { callImageApi } from './lib/api'
import { normalizeImageSize } from './lib/size'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { User } from './lib/backendApi'
import * as backendApi from './lib/backendApi'

// ===== Image cache =====
// 内存缓存，id → dataUrl，避免每次从 IndexedDB 读取。
// LRU：超过上限时淘汰最旧。Map 的迭代顺序就是插入顺序，重写前先 delete 可让命中条目"提到最新"。

const imageCache = new Map<string, string>()
const MAX_IMAGE_CACHE_ENTRIES = 100

export function cacheImage(id: string, dataUrl: string) {
  imageCache.delete(id)
  imageCache.set(id, dataUrl)
  while (imageCache.size > MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = imageCache.keys().next().value
    if (oldestKey === undefined) break
    imageCache.delete(oldestKey)
  }
}

export function getCachedImage(id: string): string | undefined {
  const dataUrl = imageCache.get(id)
  if (dataUrl !== undefined) {
    imageCache.delete(id)
    imageCache.set(id, dataUrl)
  }
  return dataUrl
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  const cached = imageCache.get(id)
  if (cached !== undefined) {
    imageCache.delete(id)
    imageCache.set(id, cached)
    return cached
  }
  const rec = await getImage(id)
  if (rec) {
    cacheImage(id, rec.dataUrl)
    return rec.dataUrl
  }
  return undefined
}

// ===== Store 类型 =====

export type ToastType = 'info' | 'success' | 'error'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

interface AppState {
  // 用户认证
  user: User | null
  authLoading: boolean
  setUser: (u: User | null) => void
  setAuthLoading: (v: boolean) => void

  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[]) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  /** 正在处理（上传/转码）中的图片数量，用于阻止 race 提交 */
  pendingImageCount: number
  incrementPendingImage: () => void
  decrementPendingImage: () => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  /** 下一页 cursor；null 表示没有更多 */
  tasksCursor: string | null
  /** 是否还有下一页 */
  tasksHasMore: boolean
  /** 正在请求列表（首次或追加） */
  tasksLoading: boolean

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (favorite: boolean) => void
  /** admin 筛选用户：'all' = 全部用户（默认），数字 = 指定 user id */
  filterUserId: 'all' | number
  setFilterUserId: (v: AppState['filterUserId']) => void
  /** admin 用户下拉的选项（id + username），仅 admin 加载 */
  adminUsers: Array<{ id: number; username: string }>
  setAdminUsers: (users: AppState['adminUsers']) => void
  /** 主页任务列表显示样式：grid（默认）/ list */
  viewMode: 'grid' | 'list'
  setViewMode: (mode: AppState['viewMode']) => void
  toggleTaskFavorite: (taskId: string) => Promise<void>
  // 批量选择
  selectionMode: boolean
  selectedTaskIds: Set<string>
  setSelectionMode: (mode: boolean) => void
  toggleTaskSelection: (id: string) => void
  selectLoadedTasks: () => void
  clearTaskSelection: () => void
  batchDeleteSelected: () => Promise<void>
  // 蒙版编辑器
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  // API Profile 多配置
  profiles: ApiProfile[]
  activeProfileId: string | null
  setActiveProfileId: (id: string | null) => void
  setProfiles: (profiles: ApiProfile[]) => void
  customProviders: CustomProviderDefinition[]
  setCustomProviders: (providers: CustomProviderDefinition[]) => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void

  // Toast
  toasts: ToastItem[]
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
  dismissToast: (id: string) => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    action: () => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
  // User
  user: null,
  authLoading: true,
  setUser: (user) => set({ user }),
  setAuthLoading: (authLoading) => set({ authLoading }),

  // Settings
  settings: { ...DEFAULT_SETTINGS },
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),

  // Input
  prompt: '',
  setPrompt: (prompt) => set({ prompt }),
  inputImages: [],
  addInputImage: (img) =>
    set((s) => {
      if (s.inputImages.find((i) => i.id === img.id)) return s
      return { inputImages: [...s.inputImages, img] }
    }),
  removeInputImage: (idx) =>
    set((s) => {
      const removed = s.inputImages[idx]
      if (removed) imageCache.delete(removed.id)
      return { inputImages: s.inputImages.filter((_, i) => i !== idx) }
    }),
  clearInputImages: () =>
    set((s) => {
      for (const img of s.inputImages) imageCache.delete(img.id)
      return { inputImages: [] }
    }),
  setInputImages: (imgs) => set({ inputImages: imgs }),
  moveInputImage: (fromIdx, toIdx) =>
    set((s) => {
      if (fromIdx === toIdx) return s
      if (fromIdx < 0 || fromIdx >= s.inputImages.length) return s
      const images = [...s.inputImages]
      const [moved] = images.splice(fromIdx, 1)
      const target = Math.max(0, Math.min(toIdx > fromIdx ? toIdx - 1 : toIdx, images.length))
      images.splice(target, 0, moved)
      return { inputImages: images }
    }),
  pendingImageCount: 0,
  incrementPendingImage: () =>
    set((s) => ({ pendingImageCount: s.pendingImageCount + 1 })),
  decrementPendingImage: () =>
    set((s) => ({ pendingImageCount: Math.max(0, s.pendingImageCount - 1) })),

  // Params
  params: { ...DEFAULT_PARAMS },
  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

  // Tasks
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  tasksCursor: null,
  tasksHasMore: false,
  tasksLoading: false,

  // Search & Filter
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  filterStatus: 'all',
  setFilterStatus: (filterStatus) => set({ filterStatus }),
  filterFavorite: false,
  setFilterFavorite: (filterFavorite) => set({ filterFavorite }),
  filterUserId: 'all',
  setFilterUserId: (filterUserId) => set({ filterUserId }),
  adminUsers: [],
  setAdminUsers: (adminUsers) => set({ adminUsers }),
  viewMode: 'grid',
  setViewMode: (viewMode) => set({ viewMode }),
  toggleTaskFavorite: async (taskId) => {
    const state = useStore.getState()
    const target = state.tasks.find((t) => t.id === taskId)
    if (!target) return
    const next = !target.isFavorite
    // 乐观更新
    set({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, isFavorite: next } : t,
      ),
    })
    try {
      await backendApi.setTaskFavorite(taskId, next)
    } catch (error) {
      // 回滚
      const current = useStore.getState().tasks
      set({
        tasks: current.map((t) =>
          t.id === taskId ? { ...t, isFavorite: !next } : t,
        ),
      })
      useStore.getState().showToast('收藏操作失败', 'error')
      throw error
    }
  },
  selectionMode: false,
  selectedTaskIds: new Set<string>(),
  setSelectionMode: (selectionMode) =>
    set((s) =>
      selectionMode === s.selectionMode
        ? s
        : { selectionMode, selectedTaskIds: selectionMode ? s.selectedTaskIds : new Set<string>() },
    ),
  toggleTaskSelection: (id) =>
    set((s) => {
      const next = new Set(s.selectedTaskIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedTaskIds: next }
    }),
  selectLoadedTasks: () =>
    set((s) => ({ selectedTaskIds: new Set(s.tasks.map((t) => t.id)) })),
  clearTaskSelection: () => set({ selectedTaskIds: new Set<string>() }),
  batchDeleteSelected: async () => {
    const state = useStore.getState()
    const ids = Array.from(state.selectedTaskIds)
    if (!ids.length) return
    const targets = state.tasks.filter((t) => ids.includes(t.id))
    try {
      await backendApi.batchDeleteTasks(ids)
    } catch (error) {
      console.error('Batch delete failed:', error)
      state.showToast('批量删除失败', 'error')
      throw error
    }

    // 清理本地任务引用。图片资源的孤立清理由后端 batch-delete 完成，
    // 前端只需要丢掉被删任务的 imageCache 条目，避免占用内存。
    const remaining = state.tasks.filter((t) => !state.selectedTaskIds.has(t.id))
    const stillUsed = new Set<string>()
    for (const t of remaining) {
      for (const id of t.inputImageIds || []) stillUsed.add(id)
      for (const id of t.outputImages || []) stillUsed.add(id)
    }
    for (const img of state.inputImages) stillUsed.add(img.id)
    for (const t of targets) {
      for (const id of [...(t.inputImageIds || []), ...(t.outputImages || [])]) {
        if (!stillUsed.has(id)) imageCache.delete(id)
      }
    }
    set({ tasks: remaining, selectedTaskIds: new Set<string>(), selectionMode: false })

    state.showToast(`已删除 ${ids.length} 条记录`, 'success')
  },
  maskEditorImageId: null,
  setMaskEditorImageId: (maskEditorImageId) => set({ maskEditorImageId }),
  maskDraft: null,
  setMaskDraft: (maskDraft) => set({ maskDraft }),
  clearMaskDraft: () => set({ maskDraft: null }),
  profiles: [],
  activeProfileId: null,
  setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
  setProfiles: (profiles) => set({ profiles }),
  customProviders: [],
  setCustomProviders: (customProviders) => set({ customProviders }),

  // UI
  detailTaskId: null,
  setDetailTaskId: (detailTaskId) => set({ detailTaskId }),
  lightboxImageId: null,
  lightboxImageList: [],
  setLightboxImageId: (lightboxImageId, list) =>
    set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) }),
  showSettings: false,
  setShowSettings: (showSettings) => set({ showSettings }),

  // Toast
  toasts: [],
  showToast: (message, type = 'info') => {
    const id = genId()
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3000)
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // Confirm
  confirmDialog: null,
  setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
    }),
    {
      name: 'gpt-image-playground-prefs',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // 只缓存非敏感数据；偏好的主数据源是后端 /api/preferences，localStorage 仅作启动前的离线 fallback
      // 不持久化 baseUrl/apiKey/model/timeout/apiFormat（这些来自当前 Profile，启动后从后端拉）
      partialize: (s) => ({
        params: s.params,
        prompt: s.settings.persistInputOnRestart ? s.prompt : '',
        viewMode: s.viewMode,
        settings: {
          ...DEFAULT_SETTINGS,
          enterSubmit: s.settings.enterSubmit,
          clearInputAfterSubmit: s.settings.clearInputAfterSubmit,
          persistInputOnRestart: s.settings.persistInputOnRestart,
          reuseTaskApiProfileTemporarily: s.settings.reuseTaskApiProfileTemporarily,
          alwaysShowRetryButton: s.settings.alwaysShowRetryButton,
        },
      }),
    },
  ),
)

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 初始化：从后端或 IndexedDB 加载任务和图片缓存，清理孤立图片 */
export async function initStore() {
  await loadTasksFirstPage()
  loadProfiles().catch(console.error)
  loadCustomProviders().catch(console.error)
  loadPreferences().catch(console.error)

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  for (const t of useStore.getState().tasks) {
    for (const id of t.inputImageIds || []) referencedIds.add(id)
    for (const id of t.outputImages || []) referencedIds.add(id)
  }

  // 预加载所有图片到缓存，同时清理孤立图片
  const images = await getAllImages()
  for (const img of images) {
    if (referencedIds.has(img.id)) {
      cacheImage(img.id, img.dataUrl)
    } else {
      await deleteImage(img.id)
    }
  }
}

function profileItemToProfile(p: backendApi.ProfileItem): ApiProfile {
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    baseUrl: p.base_url,
    apiKeyMasked: p.api_key_masked,
    model: p.model,
    timeout: p.timeout,
    apiFormat: p.api_format,
    extra: p.extra || {},
    isDefault: Boolean(p.is_default),
  }
}

export async function loadProfiles() {
  const { user } = useStore.getState()
  if (!user) return
  try {
    const res = await backendApi.getProfiles()
    const profiles = res.profiles.map(profileItemToProfile)
    const currentActive = useStore.getState().activeProfileId
    const defaultProfile = profiles.find((p) => p.isDefault) || profiles[0] || null
    useStore.setState({
      profiles,
      activeProfileId: currentActive && profiles.some((p) => p.id === currentActive) ? currentActive : defaultProfile?.id || null,
    })
  } catch (error) {
    console.error('Failed to load profiles:', error)
  }
}

export async function loadCustomProviders() {
  const { user } = useStore.getState()
  if (!user) return
  try {
    const res = await backendApi.getCustomProviders()
    const providers: CustomProviderDefinition[] = res.providers.map((p) => ({
      id: p.id,
      name: p.name,
      template: p.template ?? null,
      submit: p.submit,
      editSubmit: p.editSubmit ?? null,
      poll: p.poll ?? null,
    }))
    useStore.setState({ customProviders: providers })
  } catch (error) {
    console.error('Failed to load custom providers:', error)
  }
}

// ===== A-6 用户偏好（后端持久化，跨设备同步）=====
// 5 个习惯开关：本地 zustand persist 只作离线 fallback，主数据源是后端 user_settings.settings.preferences

const PREFERENCE_KEYS = [
  'enterSubmit',
  'clearInputAfterSubmit',
  'persistInputOnRestart',
  'reuseTaskApiProfileTemporarily',
  'alwaysShowRetryButton',
] as const

type PreferenceKey = (typeof PREFERENCE_KEYS)[number]

/** 启动时从后端拉偏好，覆盖本地缓存。失败时保留本地缓存或 DEFAULT_SETTINGS */
export async function loadPreferences() {
  const { user } = useStore.getState()
  if (!user) return
  try {
    const res = await backendApi.getPreferences()
    const remote = res.preferences || {}
    const patch: Partial<AppSettings> = {}
    for (const key of PREFERENCE_KEYS) {
      if (typeof remote[key] === 'boolean') patch[key] = remote[key] as boolean
    }
    if (Object.keys(patch).length > 0) {
      useStore.setState((s) => ({ settings: { ...s.settings, ...patch } }))
    }
  } catch (error) {
    console.error('Failed to load preferences:', error)
  }
}

let preferenceSaveTimer: ReturnType<typeof setTimeout> | null = null
const pendingPreferenceChanges: Partial<Record<PreferenceKey, boolean>> = {}

function flushPreferences() {
  preferenceSaveTimer = null
  const payload = { ...pendingPreferenceChanges }
  for (const k of Object.keys(pendingPreferenceChanges) as PreferenceKey[]) {
    delete pendingPreferenceChanges[k]
  }
  if (Object.keys(payload).length === 0) return
  backendApi.updatePreferences(payload).catch((error) => {
    console.error('Failed to save preferences:', error)
  })
}

/** 修改单个偏好：立即更新 store + debounce 500ms 同步到后端 */
export function setPreference<K extends PreferenceKey>(key: K, value: boolean) {
  useStore.setState((s) => ({ settings: { ...s.settings, [key]: value } }))
  const { user } = useStore.getState()
  if (!user) return // 未登录态不同步
  pendingPreferenceChanges[key] = value
  if (preferenceSaveTimer != null) clearTimeout(preferenceSaveTimer)
  preferenceSaveTimer = setTimeout(flushPreferences, 500)
}

// 把后端 Task 转成前端 TaskRecord
function toTaskRecord(t: backendApi.Task): TaskRecord {
  return {
    id: t.id,
    prompt: t.prompt,
    params: t.params as TaskParams,
    inputImageIds: t.input_image_ids || [],
    inputImageUrls: t.input_image_urls || [],
    inputThumbnails: t.input_thumb_urls || [],
    outputImages: t.output_image_urls || [],
    outputThumbnails: t.output_thumb_urls || [],
    status: t.status,
    isFavorite: Boolean(t.is_favorite),
    error: t.error_message || null,
    createdAt: t.started_at,
    finishedAt: t.finished_at || null,
    elapsed: t.finished_at ? t.finished_at - t.started_at : null,
    actualParams: (t.actual_params as Partial<TaskParams>) ?? null,
    revisedPromptByImage: t.revised_prompt_by_image ?? null,
    rawResponsePayload: t.raw_response_payload ?? null,
    rawImageUrls: t.raw_image_urls ?? null,
    apiProfileId: t.api_profile_id ?? null,
    apiProfileName: t.api_profile_name ?? null,
    apiProvider: t.api_provider ?? null,
    apiModel: t.api_model ?? null,
    owner: t.owner ?? null,
  }
}

// 防 race：每次发起请求自增；回来后若不是最新请求则丢弃结果
let currentLoadSeq = 0

/** 拉第一页任务（重置 cursor）。搜索 / 过滤变化时调。已运行中的任务会保留在最前面，避免刚提交的 task 被刷掉。 */
export async function loadTasksFirstPage() {
  const { user, searchQuery, filterStatus, filterFavorite, filterUserId } = useStore.getState()
  if (!user) {
    useStore.setState({ tasks: [], tasksCursor: null, tasksHasMore: false })
    return
  }
  const userIdParam = user.role === 'admin' ? filterUserId : undefined
  const mySeq = ++currentLoadSeq
  useStore.setState({ tasksLoading: true })
  try {
    const page = await backendApi.getTasks({ q: searchQuery, status: filterStatus, favorite: filterFavorite, userId: userIdParam })
    if (mySeq !== currentLoadSeq) return // 已被更新请求覆盖
    const items = page.items.map(toTaskRecord)
    const runningTasks = useStore.getState().tasks.filter((t) => t.status === 'running')
    const runningIds = new Set(runningTasks.map((t) => t.id))
    const merged = [...runningTasks, ...items.filter((t) => !runningIds.has(t.id))]
    useStore.setState({
      tasks: merged,
      tasksCursor: page.nextCursor,
      tasksHasMore: !!page.nextCursor,
    })
  } catch (err) {
    if (mySeq === currentLoadSeq) {
      console.error('Failed to load tasks:', err)
    }
  } finally {
    if (mySeq === currentLoadSeq) {
      useStore.setState({ tasksLoading: false })
    }
  }
}

/** 追加下一页。由滚动到底部触发，幂等。 */
export async function loadMoreTasks() {
  const { user, searchQuery, filterStatus, filterFavorite, filterUserId, tasksCursor, tasksLoading, tasksHasMore } = useStore.getState()
  if (!user || tasksLoading || !tasksHasMore || !tasksCursor) return
  const userIdParam = user.role === 'admin' ? filterUserId : undefined
  useStore.setState({ tasksLoading: true })
  try {
    const page = await backendApi.getTasks({ cursor: tasksCursor, q: searchQuery, status: filterStatus, favorite: filterFavorite, userId: userIdParam })
    const items = page.items.map(toTaskRecord)
    useStore.setState((s) => ({
      tasks: [...s.tasks, ...items.filter((t) => !s.tasks.find((x) => x.id === t.id))],
      tasksCursor: page.nextCursor,
      tasksHasMore: !!page.nextCursor,
    }))
  } catch (err) {
    console.error('Failed to load more tasks:', err)
  } finally {
    useStore.setState({ tasksLoading: false })
  }
}

/** 提交新任务 */
export async function submitTask() {
  const { user, prompt, inputImages, params, tasks, setTasks, showToast, setPrompt, clearInputImages, maskDraft, clearMaskDraft, settings } =
    useStore.getState()

  if (!user) {
    backendApi.redirectToGitHubLogin()
    return
  }

  if (!prompt.trim() && !inputImages.length) {
    showToast('请输入提示词或添加参考图', 'error')
    return
  }

  const normalizedParams = {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
  }
  if (normalizedParams.size !== params.size) {
    useStore.getState().setParams({ size: normalizedParams.size })
  }

  // 蒙版逻辑：如果 maskDraft 指向的图在当前 inputImages 中，把它排到第一位，并把 mask data URL 透传到后端
  let orderedInputImages = inputImages
  let maskDataUrl: string | undefined
  let maskTargetImageId: string | undefined
  if (maskDraft) {
    const target = inputImages.find((img) => img.id === maskDraft.targetImageId)
    if (target) {
      orderedInputImages = [target, ...inputImages.filter((img) => img.id !== target.id)]
      maskDataUrl = maskDraft.maskDataUrl
      maskTargetImageId = target.id
    } else {
      // 目标图已经不在 inputImages 中，清理掉这条 draft
      clearMaskDraft()
    }
  }

  // 输入图片的 dataUrl 直接来自 store；InputImage 创建时已固化。
  const inputImageIds = orderedInputImages.map((i) => i.id)

  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: normalizedParams,
    inputImageIds,
    inputImageUrls: orderedInputImages.map((i) => i.dataUrl),
    inputThumbnails: orderedInputImages.map(() => ''),
    outputImages: [],
    outputThumbnails: [],
    status: 'running',
    isFavorite: false,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const newTasks = [task, ...tasks]
  setTasks(newTasks)

  // 清空输入框和图片（受习惯开关控制）
  if (settings.clearInputAfterSubmit) {
    setPrompt('')
    clearInputImages()
  }
  clearMaskDraft()

  // 如果用户已登录，同步到后端
  if (user) {
    try {
      await backendApi.createTask({
        id: taskId,
        prompt: task.prompt,
        params: normalizedParams,
        input_image_ids: task.inputImageIds,
        started_at: task.createdAt,
      })
    } catch (error) {
      console.error('Failed to sync task to backend:', error)
    }
  }

  // 异步调用 API；服务端按 ID 读盘构造上游请求，避免重复传 base64
  executeTask(taskId, inputImageIds, maskDataUrl, maskTargetImageId)
}

async function executeTask(taskId: string, inputImageIds: string[], maskDataUrl?: string, maskTargetImageId?: string) {
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return

  try {
    const result = await callImageApi({
      prompt: task.prompt,
      params: task.params,
      inputImageIds,
      taskId,
      timeoutSec: useStore.getState().settings.timeout,
      maskDataUrl,
      maskTargetImageId,
      profileId: useStore.getState().activeProfileId || undefined,
    })

    // 服务端已落盘并直接 UPDATE tasks 状态，前端只更新本地 store
    const outputImages = result.images.map((r) => r.url)
    const outputThumbnails = result.images.map((r) => r.thumb || '')

    updateTaskInStore(taskId, {
      outputImages,
      outputThumbnails,
      status: 'done',
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })

    useStore.getState().showToast(`生成完成，共 ${outputImages.length} 张图片`, 'success')
  } catch (err) {
    // 服务端 /api/generate catch 块里也会 UPDATE tasks 为 error，这里只更新本地 store
    updateTaskInStore(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })

    useStore.getState().setDetailTaskId(taskId)
  }
}

function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch } : t,
  )
  setTasks(updated)
}

/**
 * 重试：基于一条已存在任务的提示词 / 参数 / 输入图，重新提交一次。
 * 提交后等同于普通新任务，新任务有自己的 id；旧任务保留不动（避免误删）。
 */
export async function retryTask(task: TaskRecord): Promise<void> {
  const { setPrompt, setParams, setInputImages, showToast, settings } = useStore.getState()
  setPrompt(task.prompt)
  setParams(task.params)
  // 临时切换到任务当时的 profile（B-4）
  if (settings.reuseTaskApiProfileTemporarily && task.apiProfileId) {
    const exists = useStore.getState().profiles.some((p) => p.id === task.apiProfileId)
    if (exists) {
      useStore.setState({ activeProfileId: task.apiProfileId })
    } else {
      showToast('原 Profile 已被删除，使用当前默认 Profile', 'info')
    }
  }
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) imgs.push({ id: imgId, dataUrl })
  }
  setInputImages(imgs)
  // 立即提交
  await submitTask()
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { setPrompt, setParams, setInputImages, showToast, settings } = useStore.getState()
  setPrompt(task.prompt)
  setParams(task.params)

  // B-4: 临时切到任务当时的 Profile（如果开关开启 + Profile 还存在）
  if (settings.reuseTaskApiProfileTemporarily && task.apiProfileId) {
    const exists = useStore.getState().profiles.some((p) => p.id === task.apiProfileId)
    if (exists) {
      useStore.setState({ activeProfileId: task.apiProfileId })
      showToast(`已临时切换到原任务的 Profile：${task.apiProfileName || task.apiProfileId}`, 'info')
    } else {
      showToast('原任务的 Profile 已被删除，将使用当前 Profile', 'info')
    }
  }

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }
  setInputImages(imgs)
  showToast('已复用配置到输入框', 'success')
}

/** 将图片标识（URL / data URL）解析为 data URL */
async function resolveImageToDataUrl(img: string): Promise<string | undefined> {
  if (img.startsWith('data:')) return img
  try {
    const response = await fetch(img, { credentials: 'include' })
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const img of task.outputImages) {
    const dataUrl = await resolveImageToDataUrl(img)
    if (!dataUrl) continue
    const id = await hashDataUrl(dataUrl)
    if (inputImages.find((i) => i.id === id)) continue
    cacheImage(id, dataUrl)
    addInputImage({ id, dataUrl })
    added++
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { user, tasks, setTasks, inputImages, showToast } = useStore.getState()

  // 如果用户已登录，从后端删除
  if (user) {
    try {
      await backendApi.deleteTask(task.id)
    } catch (error) {
      console.error('Failed to delete task from backend:', error)
      showToast('删除失败', 'error')
      return
    }
  }

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.outputImages || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
    }
  }

  showToast('记录已删除', 'success')
}

/** 清空所有数据（含配置重置） */
export async function clearAllData() {
  const { user, setTasks, clearInputImages, setSettings, setParams, showToast } = useStore.getState()

  // 如果用户已登录，从后端清空
  if (user) {
    try {
      await backendApi.clearTasks()
    } catch (error) {
      console.error('Failed to clear tasks from backend:', error)
      showToast('清空失败', 'error')
      return
    }
  }

  await clearImages()
  imageCache.clear()
  setTasks([])
  useStore.setState({ tasksCursor: null, tasksHasMore: false })
  clearInputImages()
  setSettings({ ...DEFAULT_SETTINGS })
  setParams({ ...DEFAULT_PARAMS })
  showToast('所有数据已清空', 'success')
}

/** 从 dataUrl 解析出 MIME 扩展名和二进制数据 */
function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

/** 将二进制数据还原为 dataUrl */
function bytesToDataUrl(bytes: Uint8Array, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const mime = mimeMap[ext] ?? 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

/** 导出数据为 ZIP */
export async function exportData() {
  try {
    const tasks = await getAllTasks()
    const images = await getAllImages()
    const { settings } = useStore.getState()
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()

    for (const task of tasks) {
      for (const id of [...(task.inputImageIds || []), ...(task.outputImages || [])]) {
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}

    for (const img of images) {
      const { ext, bytes } = dataUrlToBytes(img.dataUrl)
      const path = `images/${img.id}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
      imageFiles[img.id] = { path, createdAt, source: img.source }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
    }

    const manifest: ExportData = {
      version: 2,
      exportedAt: new Date(exportedAt).toISOString(),
      settings,
      tasks,
      imageFiles,
    }

    zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

    const zipped = zipSync(zipFiles, { level: 6 })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gpt-image-playground-${Date.now()}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 导入 ZIP 数据 */
export async function importData(file: File) {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!data.tasks || !data.imageFiles) throw new Error('无效的数据格式')

    // 还原图片
    for (const [id, info] of Object.entries(data.imageFiles)) {
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const dataUrl = bytesToDataUrl(bytes, info.path)
      await putImage({ id, dataUrl, createdAt: info.createdAt, source: info.source })
      cacheImage(id, dataUrl)
    }

    for (const task of data.tasks) {
      await putTask(task)
    }

    if (data.settings) {
      useStore.getState().setSettings(data.settings)
    }

    const tasks = await getAllTasks()
    useStore.getState().setTasks(tasks)
    useStore
      .getState()
      .showToast(`已导入 ${data.tasks.length} 条记录`, 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 添加图片到输入（文件上传）—— 已登录时使用服务端返回的 ID 保证一致 */
export async function addImageFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return

  const { incrementPendingImage, decrementPendingImage } = useStore.getState()
  incrementPendingImage()
  try {
    const dataUrl = await fileToDataUrl(file)

    let id: string
    const { user } = useStore.getState()
    if (user) {
      try {
        const result = await backendApi.uploadImage(file)
        id = result.id
      } catch (error) {
        useStore.getState().showToast(
          `图片上传失败：${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
        return
      }
    } else {
      // 未登录场景下仅做本地预览（实际无法提交任务）
      id = await hashDataUrl(dataUrl)
    }

    cacheImage(id, dataUrl)
    useStore.getState().addInputImage({ id, dataUrl })
  } finally {
    decrementPendingImage()
  }
}

/**
 * 从图片 URL（远程或 data URL）加入到当前 inputImages。
 * 已登录时走后端落盘以保持 id 一致；未登录走本地 hash。
 * 用于"右键 → 编辑"等"基于已有图二次生成"入口。
 */
export async function addImageFromUrl(url: string): Promise<void> {
  if (!url) return
  const { incrementPendingImage, decrementPendingImage } = useStore.getState()
  incrementPendingImage()
  try {
    let dataUrl = url
    if (!url.startsWith('data:')) {
      const resp = await fetch(url, { credentials: 'include' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    }

    let id: string
    const { user } = useStore.getState()
    if (user) {
      try {
        const saved = await backendApi.saveImage(dataUrl, 'generated')
        id = saved.id
      } catch (error) {
        useStore.getState().showToast(
          `添加到输入失败：${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
        return
      }
    } else {
      id = await hashDataUrl(dataUrl)
    }

    const state = useStore.getState()
    if (state.inputImages.find((i) => i.id === id)) {
      state.showToast('该图已在输入区', 'info')
      return
    }
    cacheImage(id, dataUrl)
    state.addInputImage({ id, dataUrl })
    state.showToast('已添加到输入', 'success')
  } finally {
    decrementPendingImage()
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
