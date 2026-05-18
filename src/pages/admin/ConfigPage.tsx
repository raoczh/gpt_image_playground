import { useEffect, useState } from 'react'
import { getSystemConfig, updateSystemConfig } from '../../lib/adminApi'
import { useStore } from '../../store'

interface ConfigState {
  registration_mode: string
  daily_generation_limit: number | null
  user_storage_limit_mb: number | null
  maintenance_mode: boolean
  maintenance_message: string
  announcement: { id?: string; enabled?: boolean; level?: string; content?: string; expires_at?: string | null } | null
  default_api_profile: Record<string, unknown> | null
  review_message: string
}

const DEFAULT_STATE: ConfigState = {
  registration_mode: 'open',
  daily_generation_limit: null,
  user_storage_limit_mb: null,
  maintenance_mode: false,
  maintenance_message: '系统维护中，请稍后再试',
  announcement: null,
  default_api_profile: null,
  review_message: '',
}

export default function ConfigPage() {
  const showToast = useStore((s) => s.showToast)
  const [config, setConfig] = useState<ConfigState>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [announcementJson, setAnnouncementJson] = useState('null')
  const [defaultProfileJson, setDefaultProfileJson] = useState('null')

  useEffect(() => {
    setLoading(true)
    getSystemConfig()
      .then((res) => {
        const raw = res.config as Record<string, { value: unknown } | undefined>
        const c: ConfigState = {
          registration_mode: (raw.registration_mode?.value as string) ?? DEFAULT_STATE.registration_mode,
          daily_generation_limit: (raw.daily_generation_limit?.value as number | null) ?? null,
          user_storage_limit_mb: (raw.user_storage_limit_mb?.value as number | null) ?? null,
          maintenance_mode: (raw.maintenance_mode?.value as boolean) ?? false,
          maintenance_message: (raw.maintenance_message?.value as string) ?? DEFAULT_STATE.maintenance_message,
          announcement: (raw.announcement?.value as ConfigState['announcement']) ?? null,
          default_api_profile: (raw.default_api_profile?.value as Record<string, unknown> | null) ?? null,
          review_message: (raw.review_message?.value as string) ?? DEFAULT_STATE.review_message,
        }
        setConfig(c)
        setAnnouncementJson(JSON.stringify(c.announcement, null, 2))
        setDefaultProfileJson(JSON.stringify(c.default_api_profile, null, 2))
      })
      .catch((err) => showToast(err instanceof Error ? err.message : String(err), 'error'))
      .finally(() => setLoading(false))
  }, [showToast])

  const handleSave = async () => {
    let announcement: unknown = null
    let defaultProfile: unknown = null
    try {
      announcement = JSON.parse(announcementJson)
    } catch {
      showToast('announcement JSON 格式无效', 'error')
      return
    }
    try {
      defaultProfile = JSON.parse(defaultProfileJson)
    } catch {
      showToast('default_api_profile JSON 格式无效', 'error')
      return
    }

    setSaving(true)
    try {
      await updateSystemConfig({
        registration_mode: config.registration_mode,
        daily_generation_limit: config.daily_generation_limit,
        user_storage_limit_mb: config.user_storage_limit_mb,
        maintenance_mode: config.maintenance_mode,
        maintenance_message: config.maintenance_message,
        announcement,
        default_api_profile: defaultProfile,
        review_message: config.review_message,
      })
      showToast('配置已保存', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-6 text-center text-gray-500 dark:text-gray-400">
        加载中...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">注册控制</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">注册模式</span>
            <select
              value={config.registration_mode}
              onChange={(e) => setConfig({ ...config, registration_mode: e.target.value })}
              className="form-input"
            >
              <option value="open">开放注册</option>
              <option value="allowlist">白名单</option>
              <option value="review">审核制</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">审核提示语</span>
            <input
              value={config.review_message}
              onChange={(e) => setConfig({ ...config, review_message: e.target.value })}
              className="form-input"
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">维护模式</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={config.maintenance_mode}
              onChange={(e) => setConfig({ ...config, maintenance_mode: e.target.checked })}
            />
            开启维护模式
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            开启后非 admin 用户的所有业务接口返回 503
          </span>
        </div>
        <label className="block">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">维护提示语</span>
          <input
            value={config.maintenance_message}
            onChange={(e) => setConfig({ ...config, maintenance_message: e.target.value })}
            className="form-input"
          />
        </label>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">配额</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">每日生成次数限制（留空不限）</span>
            <input
              type="number"
              value={config.daily_generation_limit ?? ''}
              onChange={(e) =>
                setConfig({ ...config, daily_generation_limit: e.target.value === '' ? null : Number(e.target.value) })
              }
              className="form-input"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">用户存储限制 MB（留空不限）</span>
            <input
              type="number"
              value={config.user_storage_limit_mb ?? ''}
              onChange={(e) =>
                setConfig({ ...config, user_storage_limit_mb: e.target.value === '' ? null : Number(e.target.value) })
              }
              className="form-input"
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">公告横幅</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          JSON 格式：{`{ "enabled": true, "level": "info|warning|error", "content": "...", "id": "唯一标识", "expires_at": null }`}
          <br />设为 null 关闭公告。
        </p>
        <textarea
          value={announcementJson}
          onChange={(e) => setAnnouncementJson(e.target.value)}
          rows={5}
          className="form-input font-mono"
        />
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">新用户默认 Profile</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          新用户注册成功后自动创建的 API Profile（JSON 对象或 null）。
        </p>
        <textarea
          value={defaultProfileJson}
          onChange={(e) => setDefaultProfileJson(e.target.value)}
          rows={6}
          className="form-input font-mono"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 disabled:opacity-40"
      >
        {saving ? '保存中...' : '保存全部配置'}
      </button>
    </div>
  )
}
