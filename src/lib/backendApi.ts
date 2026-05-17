// 后端 API 客户端
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function withNoCacheQuery(url: string, method: string) {
  if (method !== 'GET') return url;

  const requestUrl = new URL(url, window.location.origin);
  requestUrl.searchParams.set('_ts', `${Date.now()}`);
  return requestUrl.toString();
}

// API 请求封装
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();

  const defaultOptions: RequestInit = {
    cache: 'no-store',
    credentials: 'include', // 发送 cookies
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const response = await fetch(withNoCacheQuery(url, method), { ...defaultOptions, ...options, method });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ==================== 认证 API ====================

export interface User {
  id: number;
  github_id: string;
  username: string;
  avatar_url: string;
  email: string;
  created_at: string;
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiRequest('/api/auth/me');
  } catch (error) {
    return null;
  }
}

export async function logout(): Promise<void> {
  await apiRequest('/api/auth/logout', { method: 'POST' });
}

export function redirectToGitHubLogin() {
  window.location.href = `${API_BASE_URL}/api/auth/github`;
}

// ==================== 设置 API ====================

export interface UserSettings {
  api_url: string;
  api_key: string;
  use_default: boolean;
  settings: Record<string, any>;
}

export async function getSettings(): Promise<UserSettings> {
  return apiRequest('/api/settings');
}

export async function updateSettings(settings: {
  api_url?: string;
  api_key?: string;
  use_default?: boolean;
  settings?: Record<string, any>;
}): Promise<void> {
  await apiRequest('/api/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

// ==================== 任务 API ====================

export interface Task {
  id: string;
  user_id: number;
  prompt: string;
  status: 'running' | 'done' | 'error';
  is_favorite?: number | boolean;
  error_message?: string;
  params: Record<string, any>;
  input_image_ids: string[];
  output_image_ids: string[];
  input_image_urls: string[];
  output_image_urls: string[];
  input_thumb_urls: string[];
  output_thumb_urls: string[];
  started_at: number;
  finished_at?: number;
  created_at: string;
  updated_at: string;
}

export interface TasksPage {
  items: Task[];
  nextCursor: string | null;
}

export interface GetTasksOpts {
  cursor?: string | null;
  limit?: number;
  q?: string;
  status?: 'all' | 'running' | 'done' | 'error';
  favorite?: boolean;
}

export async function getTasks(opts: GetTasksOpts = {}): Promise<TasksPage> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.q) params.set('q', opts.q);
  if (opts.status && opts.status !== 'all') params.set('status', opts.status);
  if (opts.favorite) params.set('favorite', '1');
  const query = params.toString();
  return apiRequest(query ? `/api/tasks?${query}` : '/api/tasks');
}

export async function createTask(task: {
  id: string;
  prompt: string;
  params: Record<string, any>;
  input_image_ids: string[];
  started_at: number;
}): Promise<void> {
  await apiRequest('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

export async function updateTask(
  id: string,
  updates: {
    status?: 'running' | 'done' | 'error';
    error_message?: string;
    output_image_ids?: string[];
    finished_at?: number;
  }
): Promise<void> {
  await apiRequest(`/api/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function setTaskFavorite(id: string, isFavorite: boolean): Promise<void> {
  await apiRequest(`/api/tasks/${id}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ isFavorite }),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await apiRequest(`/api/tasks/${id}`, { method: 'DELETE' });
}

export async function clearTasks(): Promise<void> {
  await apiRequest('/api/tasks', { method: 'DELETE' });
}

// ==================== 图片 API ====================

export interface Image {
  id: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  source: 'upload' | 'generated';
  created_at: string;
}

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE_URL}/api/images/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  return response.json();
}

export async function saveImage(
  dataUrl: string,
  source: 'upload' | 'generated' = 'generated'
): Promise<{ id: string; url: string }> {
  return apiRequest('/api/images/save', {
    method: 'POST',
    body: JSON.stringify({ dataUrl, source }),
  });
}

export async function getImage(id: string): Promise<Image> {
  return apiRequest(`/api/images/${id}`);
}
