const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

async function adminRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${endpoint}`
  const method = (options.method || 'GET').toUpperCase()
  const requestUrl =
    method === 'GET' ? `${url}${url.includes('?') ? '&' : '?'}_ts=${Date.now()}` : url

  const response = await fetch(requestUrl, {
    cache: 'no-store',
    credentials: 'include',
    ...options,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  if (response.status === 204) return null
  return response.json()
}

export interface AdminHealth {
  ok: boolean
  admin: { id: number; role: string }
}

export async function getAdminHealth(): Promise<AdminHealth> {
  return adminRequest('/api/admin/health')
}

// ==================== 用户管理（M2） ====================

export interface AdminUser {
  id: number
  github_id: string
  username: string
  avatar_url: string
  email: string | null
  role: 'user' | 'admin'
  status: 'active' | 'pending' | 'disabled'
  last_login_at: string | null
  created_at: string
  updated_at: string
  quota_overrides: Record<string, unknown> | null
  task_count: number
  image_count: number
  storage_bytes: number
}

export interface AdminUsersPage {
  items: AdminUser[]
  total: number
  limit: number
  offset: number
}

export interface ListUsersParams {
  q?: string
  status?: 'active' | 'pending' | 'disabled' | ''
  role?: 'user' | 'admin' | ''
  limit?: number
  offset?: number
}

export async function listUsers(params: ListUsersParams = {}): Promise<AdminUsersPage> {
  const sp = new URLSearchParams()
  if (params.q) sp.set('q', params.q)
  if (params.status) sp.set('status', params.status)
  if (params.role) sp.set('role', params.role)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  const query = sp.toString()
  return adminRequest(`/api/admin/users${query ? `?${query}` : ''}`)
}

export async function getUser(id: number): Promise<AdminUser> {
  return adminRequest(`/api/admin/users/${id}`)
}

export async function updateUser(
  id: number,
  patch: { role?: 'user' | 'admin'; status?: 'active' | 'pending' | 'disabled'; quota_overrides?: Record<string, unknown> | null },
): Promise<void> {
  await adminRequest(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteUser(id: number): Promise<void> {
  await adminRequest(`/api/admin/users/${id}`, { method: 'DELETE' })
}

export async function forceLogoutUser(id: number): Promise<void> {
  await adminRequest(`/api/admin/users/${id}/logout`, { method: 'POST' })
}

export async function approveUser(id: number): Promise<void> {
  await adminRequest(`/api/admin/users/${id}/approve`, { method: 'POST' })
}

export async function updateUserQuota(
  id: number,
  quota_overrides: Record<string, unknown> | null,
): Promise<void> {
  await adminRequest(`/api/admin/users/${id}/quota`, {
    method: 'PATCH',
    body: JSON.stringify({ quota_overrides }),
  })
}

// 用户的 settings / profiles / custom-providers（admin 直接管控）

export interface AdminUserSettings {
  api_url: string
  api_key: string
  settings: Record<string, unknown>
}

export async function getUserSettings(userId: number): Promise<AdminUserSettings> {
  return adminRequest(`/api/admin/users/${userId}/settings`)
}

export async function updateUserSettings(
  userId: number,
  payload: { api_url?: string; api_key?: string; settings?: Record<string, unknown> },
): Promise<void> {
  await adminRequest(`/api/admin/users/${userId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export interface AdminProfile {
  id: string
  name: string
  provider: string
  base_url: string
  api_key: string
  model: string
  timeout: number
  api_format: 'imagen' | 'responses'
  extra: Record<string, unknown>
  is_default: boolean
  created_at: string
  updated_at: string
}

export async function listUserProfiles(userId: number): Promise<{ profiles: AdminProfile[] }> {
  return adminRequest(`/api/admin/users/${userId}/profiles`)
}

export async function createUserProfile(
  userId: number,
  payload: Partial<AdminProfile> & { name: string },
): Promise<{ id: string }> {
  return adminRequest(`/api/admin/users/${userId}/profiles`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateUserProfile(
  userId: number,
  profileId: string,
  payload: Partial<AdminProfile>,
): Promise<void> {
  await adminRequest(`/api/admin/users/${userId}/profiles/${profileId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteUserProfile(userId: number, profileId: string): Promise<void> {
  await adminRequest(`/api/admin/users/${userId}/profiles/${profileId}`, { method: 'DELETE' })
}

export interface AdminCustomProvider {
  id: string
  name: string
  template: string | null
  submit: Record<string, unknown> | null
  editSubmit: Record<string, unknown> | null
  poll: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export async function listUserCustomProviders(
  userId: number,
): Promise<{ providers: AdminCustomProvider[] }> {
  return adminRequest(`/api/admin/users/${userId}/custom-providers`)
}

export async function createUserCustomProvider(
  userId: number,
  payload: { name: string; template?: string; submit: Record<string, unknown>; editSubmit?: Record<string, unknown>; poll?: Record<string, unknown> },
): Promise<{ id: string }> {
  return adminRequest(`/api/admin/users/${userId}/custom-providers`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateUserCustomProvider(
  userId: number,
  cpid: string,
  payload: Partial<AdminCustomProvider>,
): Promise<void> {
  await adminRequest(`/api/admin/users/${userId}/custom-providers/${cpid}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteUserCustomProvider(userId: number, cpid: string): Promise<void> {
  await adminRequest(`/api/admin/users/${userId}/custom-providers/${cpid}`, { method: 'DELETE' })
}

// ==================== 系统配置（M4） ====================

export interface SystemConfigEntry {
  value: unknown
  updated_at: string
}

export interface SystemConfigBundle {
  config: Record<string, SystemConfigEntry>
}

export async function getSystemConfig(): Promise<SystemConfigBundle> {
  return adminRequest('/api/admin/config')
}

export async function updateSystemConfig(updates: Record<string, unknown>): Promise<void> {
  await adminRequest('/api/admin/config', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

// ==================== 公共站点配置（无需 admin） ====================

export interface SiteConfig {
  maintenance_mode: boolean
  maintenance_message: string
  announcement: {
    id?: string
    enabled?: boolean
    level?: 'info' | 'warning' | 'error'
    content?: string
    expires_at?: string | null
  } | null
  registration_mode: 'open' | 'allowlist' | 'review'
  review_message: string
}

export async function getSiteConfig(): Promise<SiteConfig> {
  const res = await fetch(`${API_BASE_URL}/api/public/site-config?_ts=${Date.now()}`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ==================== 注册白名单（M5） ====================

export interface AllowlistItem {
  id: number
  github_username: string
  note: string | null
  added_by: number | null
  added_by_username: string | null
  created_at: string
}

export async function listAllowlist(): Promise<{ items: AllowlistItem[] }> {
  return adminRequest('/api/admin/allowlist')
}

export async function addAllowlist(github_username: string, note?: string): Promise<{ id: number }> {
  return adminRequest('/api/admin/allowlist', {
    method: 'POST',
    body: JSON.stringify({ github_username, note }),
  })
}

export async function removeAllowlist(id: number): Promise<void> {
  await adminRequest(`/api/admin/allowlist/${id}`, { method: 'DELETE' })
}

// ==================== 仪表盘（M6） ====================

export interface StatsOverview {
  users: { total: number; new_7d: number; active_30d: number; pending: number }
  tasks: { total: number; running: number; done: number; error: number; tasks_7d: number; error_tasks_7d: number }
  images: { total: number; total_bytes: number }
}

export async function getStatsOverview(): Promise<StatsOverview> {
  return adminRequest('/api/admin/stats/overview')
}

export interface TasksTrendItem {
  day: string
  total: number
  done: number
  error: number
}

export async function getTasksTrend(days = 7): Promise<{ items: TasksTrendItem[] }> {
  return adminRequest(`/api/admin/stats/tasks-trend?days=${days}`)
}

export interface StorageTopItem {
  id: number
  username: string
  avatar_url: string
  image_count: number
  storage_bytes: number
}

export async function getStorageTop(limit = 10): Promise<{ items: StorageTopItem[] }> {
  return adminRequest(`/api/admin/stats/storage-top?limit=${limit}`)
}

export interface RecentFailure {
  id: string
  user_id: number
  prompt: string
  error_message: string | null
  created_at: string
  api_provider: string | null
  api_model: string | null
  username: string | null
  avatar_url: string | null
}

export async function getRecentFailures(limit = 10): Promise<{ items: RecentFailure[] }> {
  return adminRequest(`/api/admin/stats/recent-failures?limit=${limit}`)
}

export interface RecentUser {
  id: number
  username: string
  avatar_url: string
  email: string | null
  status: string
  role: string
  created_at: string
  last_login_at: string | null
}

export async function getRecentUsers(limit = 10): Promise<{ items: RecentUser[] }> {
  return adminRequest(`/api/admin/stats/recent-users?limit=${limit}`)
}

// ==================== 审计日志（M8） ====================

export interface AuditLogEntry {
  id: number
  actor_id: number
  action: string
  target_type: string | null
  target_id: string | null
  before_value: unknown
  after_value: unknown
  ip: string | null
  ua: string | null
  created_at: string
  actor_username: string | null
  actor_avatar: string | null
}

export interface AuditLogPage {
  items: AuditLogEntry[]
  total: number
  limit: number
  offset: number
}

export interface ListAuditLogParams {
  actor_id?: number
  action?: string
  target_type?: string
  target_id?: string
  limit?: number
  offset?: number
}

export async function listAuditLog(params: ListAuditLogParams = {}): Promise<AuditLogPage> {
  const sp = new URLSearchParams()
  if (params.actor_id) sp.set('actor_id', String(params.actor_id))
  if (params.action) sp.set('action', params.action)
  if (params.target_type) sp.set('target_type', params.target_type)
  if (params.target_id) sp.set('target_id', params.target_id)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  const query = sp.toString()
  return adminRequest(`/api/admin/audit-log${query ? `?${query}` : ''}`)
}
