import { useCallback, useEffect, useState } from 'react'
import {
  getUser,
  getUserSettings,
  updateUserSettings,
  listUserProfiles,
  createUserProfile,
  updateUserProfile,
  deleteUserProfile,
  listUserCustomProviders,
  createUserCustomProvider,
  updateUserCustomProvider,
  deleteUserCustomProvider,
  updateUserQuota,
  approveUser,
  updateUser,
  deleteUser,
  forceLogoutUser,
  type AdminUser,
  type AdminProfile,
  type AdminCustomProvider,
  type AdminUserSettings,
} from '../../lib/adminApi'
import { useStore } from '../../store'

type Tab = 'overview' | 'settings' | 'profiles' | 'providers' | 'quota'

interface Props {
  userId: number
  onClose: () => void
  onUpdated?: () => void
}

export default function UserDetailDrawer({ userId, onClose, onUpdated }: Props) {
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const [user, setUser] = useState<AdminUser | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)

  const reloadUser = useCallback(async () => {
    try {
      const u = await getUser(userId)
      setUser(u)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }, [userId, showToast])

  useEffect(() => {
    setLoading(true)
    reloadUser().finally(() => setLoading(false))
  }, [reloadUser])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto h-full w-full max-w-3xl bg-white dark:bg-gray-950 shadow-xl flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-white/[0.08]">
          <div className="flex items-center gap-3">
            {user?.avatar_url && <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />}
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-100">{user?.username || '加载中...'}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{user?.email || (user ? `id:${user.github_id}` : '')}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </header>

        <nav className="flex gap-1 px-3 pt-2 border-b border-gray-200 dark:border-white/[0.08]">
          {(
            [
              { key: 'overview', label: '概览' },
              { key: 'settings', label: '基础设置' },
              { key: 'profiles', label: 'API Profiles' },
              { key: 'providers', label: 'Custom Providers' },
              { key: 'quota', label: '配额' },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded-t-lg transition-colors ${
                tab === t.key
                  ? 'bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-medium'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="text-center text-gray-500 dark:text-gray-400 py-12">加载中...</div>}
          {!loading && user && tab === 'overview' && (
            <OverviewTab
              user={user}
              onChanged={() => {
                reloadUser()
                onUpdated?.()
              }}
              setConfirm={setConfirmDialog}
            />
          )}
          {!loading && user && tab === 'settings' && <SettingsTab userId={user.id} />}
          {!loading && user && tab === 'profiles' && <ProfilesTab userId={user.id} />}
          {!loading && user && tab === 'providers' && <ProvidersTab userId={user.id} />}
          {!loading && user && tab === 'quota' && (
            <QuotaTab
              user={user}
              onChanged={() => {
                reloadUser()
                onUpdated?.()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function OverviewTab({
  user,
  onChanged,
  setConfirm,
}: {
  user: AdminUser
  onChanged: () => void
  setConfirm: (d: { title: string; message: string; action: () => void } | null) => void
}) {
  const me = useStore((s) => s.user)
  const showToast = useStore((s) => s.showToast)

  const fields: { label: string; value: string }[] = [
    { label: 'GitHub ID', value: user.github_id },
    { label: '邮箱', value: user.email || '—' },
    { label: '注册时间', value: user.created_at },
    { label: '最后登录', value: user.last_login_at || '—' },
    { label: '任务数', value: String(user.task_count) },
    { label: '图片数', value: String(user.image_count) },
    { label: '占用空间', value: `${(user.storage_bytes / 1024 / 1024).toFixed(2)} MB` },
  ]

  const isSelf = me?.id === user.id

  const handleAction = async (
    title: string,
    message: string,
    action: () => Promise<void>,
  ) => {
    setConfirm({
      title,
      message,
      action: async () => {
        try {
          await action()
          showToast('操作成功', 'success')
          onChanged()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 text-sm">
        {fields.map((f) => (
          <div key={f.label} className="rounded-lg bg-gray-50 dark:bg-gray-900 px-3 py-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">{f.label}</div>
            <div className="text-gray-800 dark:text-gray-100 break-all">{f.value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">状态与角色</h3>
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-gray-500 dark:text-gray-400">当前状态：</span>
          <span className="font-medium">{user.status}</span>
          <span className="text-gray-500 dark:text-gray-400">·</span>
          <span className="text-gray-500 dark:text-gray-400">当前角色：</span>
          <span className="font-medium">{user.role}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {user.status === 'pending' && (
          <button
            onClick={() => handleAction('审核通过', `通过 ${user.username} 的注册申请？`, () => approveUser(user.id))}
            className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            审核通过
          </button>
        )}
        <button
          disabled={isSelf}
          onClick={() => handleAction(
            user.status === 'active' ? '禁用用户' : '启用用户',
            user.status === 'active' ? `禁用 ${user.username}？已有 session 会被强制下线。` : `启用 ${user.username}？`,
            () => updateUser(user.id, { status: user.status === 'active' ? 'disabled' : 'active' }),
          )}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
        >
          {user.status === 'active' ? '禁用' : '启用'}
        </button>
        <button
          disabled={isSelf}
          onClick={() => handleAction(
            user.role === 'admin' ? '降级管理员' : '提升为管理员',
            user.role === 'admin' ? `降级 ${user.username} 为普通用户？` : `提升 ${user.username} 为管理员？`,
            () => updateUser(user.id, { role: user.role === 'admin' ? 'user' : 'admin' }),
          )}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
        >
          {user.role === 'admin' ? '降级为普通用户' : '提升为管理员'}
        </button>
        <button
          onClick={() => handleAction('强制下线', `强制下线 ${user.username} 的所有会话？`, () => forceLogoutUser(user.id))}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          强制下线
        </button>
        <button
          disabled={isSelf}
          onClick={() => handleAction('删除用户', `删除 ${user.username}？该用户的全部任务和图片将被软删除。`, () => deleteUser(user.id))}
          className="px-3 py-1.5 text-sm rounded-lg bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 disabled:opacity-40"
        >
          删除
        </button>
      </div>
    </div>
  )
}

function SettingsTab({ userId }: { userId: number }) {
  const showToast = useStore((s) => s.showToast)
  const [data, setData] = useState<AdminUserSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [settingsJson, setSettingsJson] = useState('{}')

  useEffect(() => {
    setLoading(true)
    getUserSettings(userId)
      .then((d) => {
        setData(d)
        setApiUrl(d.api_url)
        setApiKey(d.api_key)
        setSettingsJson(JSON.stringify(d.settings || {}, null, 2))
      })
      .catch((err) => showToast(err instanceof Error ? err.message : String(err), 'error'))
      .finally(() => setLoading(false))
  }, [userId, showToast])

  const handleSave = async () => {
    let parsedSettings: Record<string, unknown> = {}
    try {
      parsedSettings = JSON.parse(settingsJson || '{}')
    } catch {
      showToast('settings JSON 格式无效', 'error')
      return
    }
    setSaving(true)
    try {
      await updateUserSettings(userId, {
        api_url: apiUrl,
        api_key: apiKey,
        settings: parsedSettings,
      })
      showToast('已保存', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !data) return <div className="text-center text-gray-500 dark:text-gray-400 py-6">加载中...</div>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        旧版 user_settings 表的 api_url / api_key / settings JSON。新用户应使用 API Profiles。
      </p>
      <FormField label="API URL">
        <input
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.1] bg-white dark:bg-gray-950 text-sm font-mono"
        />
      </FormField>
      <FormField label="API Key">
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.1] bg-white dark:bg-gray-950 text-sm font-mono"
        />
      </FormField>
      <FormField label="settings JSON">
        <textarea
          value={settingsJson}
          onChange={(e) => setSettingsJson(e.target.value)}
          rows={8}
          className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.1] bg-white dark:bg-gray-950 text-sm font-mono"
        />
      </FormField>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 disabled:opacity-40"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  )
}

function ProfilesTab({ userId }: { userId: number }) {
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [profiles, setProfiles] = useState<AdminProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AdminProfile | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await listUserProfiles(userId)
      setProfiles(res.profiles)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const handleDelete = (p: AdminProfile) => {
    setConfirmDialog({
      title: '删除 Profile',
      message: `删除 Profile "${p.name}"？`,
      action: async () => {
        try {
          await deleteUserProfile(userId, p.id)
          showToast('已删除', 'success')
          reload()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  if (loading) return <div className="text-center text-gray-500 dark:text-gray-400 py-6">加载中...</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">该用户的 API Profiles。所有字段以明文显示。</p>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1 text-sm rounded-lg bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          新增
        </button>
      </div>

      {profiles.length === 0 && (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-8 border border-dashed border-gray-300 dark:border-white/[0.1] rounded-lg">
          该用户暂无 Profile
        </div>
      )}

      <div className="space-y-2">
        {profiles.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-800 dark:text-gray-100">{p.name}</span>
                  {p.is_default && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      默认
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    {p.provider}
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    {p.api_format}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5 font-mono break-all">
                  <div>URL: {p.base_url || '—'}</div>
                  <div>Model: {p.model || '—'}</div>
                  <div>Key: {p.api_key || '—'}</div>
                  <div>Timeout: {p.timeout}s</div>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => setEditing(p)}
                  className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(p)}
                  className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <ProfileEditor
          userId={userId}
          profile={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function ProfileEditor({
  userId,
  profile,
  onClose,
  onSaved,
}: {
  userId: number
  profile: AdminProfile | null
  onClose: () => void
  onSaved: () => void
}) {
  const showToast = useStore((s) => s.showToast)
  const [name, setName] = useState(profile?.name || '')
  const [provider, setProvider] = useState(profile?.provider || 'openai')
  const [baseUrl, setBaseUrl] = useState(profile?.base_url || '')
  const [apiKey, setApiKey] = useState(profile?.api_key || '')
  const [model, setModel] = useState(profile?.model || '')
  const [timeout, setTimeoutVal] = useState(profile?.timeout || 600)
  const [apiFormat, setApiFormat] = useState<'imagen' | 'responses'>(profile?.api_format || 'responses')
  const [extra, setExtra] = useState(JSON.stringify(profile?.extra || {}, null, 2))
  const [isDefault, setIsDefault] = useState(profile?.is_default || false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    let parsedExtra: Record<string, unknown> | undefined
    if (extra.trim()) {
      try {
        parsedExtra = JSON.parse(extra)
      } catch {
        showToast('extra JSON 格式无效', 'error')
        return
      }
    }
    setSaving(true)
    try {
      const payload = {
        name,
        provider,
        base_url: baseUrl,
        api_key: apiKey,
        model,
        timeout,
        api_format: apiFormat,
        extra: parsedExtra,
        is_default: isDefault,
      }
      if (profile) {
        await updateUserProfile(userId, profile.id, payload)
      } else {
        await createUserProfile(userId, payload)
      }
      showToast('已保存', 'success')
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-xl bg-white dark:bg-gray-950 rounded-xl shadow-xl p-5 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">
          {profile ? '编辑 Profile' : '新增 Profile'}
        </h3>
        <div className="space-y-3">
          <FormField label="名称">
            <input value={name} onChange={(e) => setName(e.target.value)} className="form-input" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Provider">
              <input value={provider} onChange={(e) => setProvider(e.target.value)} className="form-input" />
            </FormField>
            <FormField label="API Format">
              <select
                value={apiFormat}
                onChange={(e) => setApiFormat(e.target.value as 'imagen' | 'responses')}
                className="form-input"
              >
                <option value="responses">responses</option>
                <option value="imagen">imagen</option>
              </select>
            </FormField>
          </div>
          <FormField label="Base URL">
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="form-input font-mono" />
          </FormField>
          <FormField label="API Key">
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="form-input font-mono" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Model">
              <input value={model} onChange={(e) => setModel(e.target.value)} className="form-input font-mono" />
            </FormField>
            <FormField label="Timeout (秒)">
              <input
                type="number"
                value={timeout}
                onChange={(e) => setTimeoutVal(Number(e.target.value))}
                className="form-input"
              />
            </FormField>
          </div>
          <FormField label="Extra JSON">
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              rows={4}
              className="form-input font-mono"
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            设为默认 Profile
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 disabled:opacity-40"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProvidersTab({ userId }: { userId: number }) {
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [providers, setProviders] = useState<AdminCustomProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AdminCustomProvider | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await listUserCustomProviders(userId)
      setProviders(res.providers)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const handleDelete = (p: AdminCustomProvider) => {
    setConfirmDialog({
      title: '删除 Custom Provider',
      message: `删除 "${p.name}"？`,
      action: async () => {
        try {
          await deleteUserCustomProvider(userId, p.id)
          showToast('已删除', 'success')
          reload()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  if (loading) return <div className="text-center text-gray-500 dark:text-gray-400 py-6">加载中...</div>

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">该用户的自定义 HTTP Provider 配置。</p>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1 text-sm rounded-lg bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          新增
        </button>
      </div>

      {providers.length === 0 && (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-8 border border-dashed border-gray-300 dark:border-white/[0.1] rounded-lg">
          该用户暂无自定义 Provider
        </div>
      )}

      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.id} className="rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-800 dark:text-gray-100">{p.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  template: {p.template || '—'} · 创建于 {p.created_at}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => setEditing(p)}
                  className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(p)}
                  className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <CustomProviderEditor
          userId={userId}
          provider={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function CustomProviderEditor({
  userId,
  provider,
  onClose,
  onSaved,
}: {
  userId: number
  provider: AdminCustomProvider | null
  onClose: () => void
  onSaved: () => void
}) {
  const showToast = useStore((s) => s.showToast)
  const [name, setName] = useState(provider?.name || '')
  const [template, setTemplate] = useState(provider?.template || 'http-image')
  const [submitJson, setSubmitJson] = useState(JSON.stringify(provider?.submit || {}, null, 2))
  const [editSubmitJson, setEditSubmitJson] = useState(JSON.stringify(provider?.editSubmit || null, null, 2))
  const [pollJson, setPollJson] = useState(JSON.stringify(provider?.poll || null, null, 2))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('名称不能为空', 'error')
      return
    }
    let submit: Record<string, unknown>
    try {
      submit = JSON.parse(submitJson)
    } catch {
      showToast('submit JSON 格式无效', 'error')
      return
    }
    let editSubmit: Record<string, unknown> | null = null
    let poll: Record<string, unknown> | null = null
    if (editSubmitJson.trim() && editSubmitJson.trim() !== 'null') {
      try {
        editSubmit = JSON.parse(editSubmitJson)
      } catch {
        showToast('editSubmit JSON 格式无效', 'error')
        return
      }
    }
    if (pollJson.trim() && pollJson.trim() !== 'null') {
      try {
        poll = JSON.parse(pollJson)
      } catch {
        showToast('poll JSON 格式无效', 'error')
        return
      }
    }

    setSaving(true)
    try {
      if (provider) {
        await updateUserCustomProvider(userId, provider.id, {
          name,
          template,
          submit,
          editSubmit: editSubmit ?? undefined,
          poll: poll ?? undefined,
        })
      } else {
        await createUserCustomProvider(userId, {
          name,
          template,
          submit,
          editSubmit: editSubmit ?? undefined,
          poll: poll ?? undefined,
        })
      }
      showToast('已保存', 'success')
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-xl bg-white dark:bg-gray-950 rounded-xl shadow-xl p-5 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">
          {provider ? '编辑 Custom Provider' : '新增 Custom Provider'}
        </h3>
        <div className="space-y-3">
          <FormField label="名称">
            <input value={name} onChange={(e) => setName(e.target.value)} className="form-input" />
          </FormField>
          <FormField label="Template">
            <input value={template} onChange={(e) => setTemplate(e.target.value)} className="form-input font-mono" />
          </FormField>
          <FormField label="submit_config (JSON)">
            <textarea
              value={submitJson}
              onChange={(e) => setSubmitJson(e.target.value)}
              rows={6}
              className="form-input font-mono"
            />
          </FormField>
          <FormField label="edit_submit_config (JSON / null)">
            <textarea
              value={editSubmitJson}
              onChange={(e) => setEditSubmitJson(e.target.value)}
              rows={4}
              className="form-input font-mono"
            />
          </FormField>
          <FormField label="poll_config (JSON / null)">
            <textarea
              value={pollJson}
              onChange={(e) => setPollJson(e.target.value)}
              rows={4}
              className="form-input font-mono"
            />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 disabled:opacity-40"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function QuotaTab({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const showToast = useStore((s) => s.showToast)
  const [json, setJson] = useState(JSON.stringify(user.quota_overrides || {}, null, 2))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    let parsed: Record<string, unknown> | null
    const trimmed = json.trim()
    if (!trimmed || trimmed === 'null' || trimmed === '{}') {
      parsed = null
    } else {
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        showToast('JSON 格式无效', 'error')
        return
      }
    }
    setSaving(true)
    try {
      await updateUserQuota(user.id, parsed)
      showToast('已保存', 'success')
      onChanged()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        覆写该用户的配额（M7 模块依赖）。支持的字段：daily_generation_limit (number | null)、user_storage_limit_mb (number | null)。<br />
        留空 / 设为 null / 设为 {'{}'} 则使用全局默认。
      </p>
      <FormField label="quota_overrides JSON">
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={8}
          className="form-input font-mono"
        />
      </FormField>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 disabled:opacity-40"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}
