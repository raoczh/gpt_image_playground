import { useEffect, useRef, useState, useCallback } from 'react'
import { normalizeBaseUrl } from '../lib/api'
import { useStore, exportData, importData, clearAllData, loadProfiles } from '../store'
import { DEFAULT_SETTINGS, type AppSettings, type ApiFormat } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import * as backendApi from '../lib/backendApi'

const PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
]

export default function SettingsModal() {
  const user = useStore((s) => s.user)
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const profiles = useStore((s) => s.profiles)
  const activeProfileId = useStore((s) => s.activeProfileId)
  const setActiveProfileId = useStore((s) => s.setActiveProfileId)
  const customProviders = useStore((s) => s.customProviders)
  const showToast = useStore((s) => s.showToast)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [timeoutInput, setTimeoutInput] = useState(String(settings.timeout))
  const [showApiKey, setShowApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [apiKeyChanged, setApiKeyChanged] = useState(false)
  const [draftProfileName, setDraftProfileName] = useState('')
  const [draftProvider, setDraftProvider] = useState<string>('openai')

  const allProviderOptions = [
    ...PROVIDER_OPTIONS,
    ...customProviders.map((cp) => ({ value: cp.id, label: `自定义: ${cp.name}` })),
  ]

  const switchToProfile = useCallback((profileId: string) => {
    const profile = useStore.getState().profiles.find((p) => p.id === profileId)
    if (!profile) return
    setActiveProfileId(profile.id)
    setDraftProfileName(profile.name)
    setDraftProvider(profile.provider)
    const nextDraft: AppSettings = {
      ...DEFAULT_SETTINGS,
      baseUrl: profile.baseUrl,
      apiKey: '',
      model: profile.model,
      timeout: profile.timeout,
      apiFormat: profile.apiFormat,
    }
    setDraft(nextDraft)
    setTimeoutInput(String(profile.timeout))
    setSettings(nextDraft)
    setApiKeyChanged(false)
  }, [setActiveProfileId, setSettings])

  useEffect(() => {
    if (!showSettings) return
    if (!user) return

    setLoading(true)
    loadProfiles()
      .then(() => {
        const { profiles: list, activeProfileId: activeId } = useStore.getState()
        const target = list.find((p) => p.id === activeId) || list[0]
        if (target) switchToProfile(target.id)
      })
      .catch((error) => {
        console.error('Failed to load profiles:', error)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [showSettings, user, switchToProfile])

  const commitSettings = (nextDraft: AppSettings) => {
    const normalizedDraft = {
      ...nextDraft,
      baseUrl: normalizeBaseUrl(nextDraft.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl),
      apiKey: nextDraft.apiKey,
      model: nextDraft.model.trim() || DEFAULT_SETTINGS.model,
      timeout: Number(nextDraft.timeout) || DEFAULT_SETTINGS.timeout,
    }
    setDraft(normalizedDraft)
    setSettings(normalizedDraft)
  }

  const saveCurrentProfile = async () => {
    if (!user || !activeProfileId) return
    const payload: Parameters<typeof backendApi.updateProfile>[1] = {
      name: draftProfileName.trim() || '未命名',
      provider: draftProvider,
      base_url: draft.baseUrl,
      model: draft.model,
      timeout: draft.timeout,
      api_format: draft.apiFormat,
    }
    if (apiKeyChanged) payload.api_key = draft.apiKey
    try {
      await backendApi.updateProfile(activeProfileId, payload)
      await loadProfiles()
      setApiKeyChanged(false)
    } catch (error) {
      console.error('Failed to save profile:', error)
      showToast('保存配置失败', 'error')
    }
  }

  const createNewProfile = async () => {
    if (!user) return
    try {
      const res = await backendApi.createProfile({
        name: `Profile ${profiles.length + 1}`,
        provider: 'openai',
        base_url: '',
        api_key: '',
        model: 'gpt-image-1',
        timeout: 600,
        api_format: 'responses',
      })
      await loadProfiles()
      switchToProfile(res.id)
      showToast('已创建新 Profile', 'success')
    } catch (error) {
      console.error('Failed to create profile:', error)
      showToast('创建 Profile 失败', 'error')
    }
  }

  const deleteCurrentProfile = async () => {
    if (!user || !activeProfileId) return
    if (profiles.length <= 1) {
      showToast('至少保留一个 Profile', 'error')
      return
    }
    setConfirmDialog({
      title: '删除 Profile',
      message: `确定删除「${draftProfileName}」吗？该配置将被永久移除。`,
      action: async () => {
        try {
          await backendApi.deleteProfile(activeProfileId)
          await loadProfiles()
          const next = useStore.getState().profiles[0]
          if (next) switchToProfile(next.id)
          showToast('Profile 已删除', 'success')
        } catch (error) {
          console.error('Failed to delete profile:', error)
          showToast('删除 Profile 失败', 'error')
        }
      },
    })
  }

  const setAsDefault = async () => {
    if (!user || !activeProfileId) return
    try {
      await backendApi.setDefaultProfile(activeProfileId)
      await loadProfiles()
      showToast('已设为默认', 'success')
    } catch (error) {
      console.error('Failed to set default profile:', error)
      showToast('设为默认失败', 'error')
    }
  }

  const handleClose = async () => {
    const nextTimeout = Number(timeoutInput)
    const finalSettings = {
      ...draft,
      timeout:
        timeoutInput.trim() === '' || Number.isNaN(nextTimeout)
          ? DEFAULT_SETTINGS.timeout
          : nextTimeout,
    }
    commitSettings(finalSettings)
    await saveCurrentProfile()
    setShowSettings(false)
  }

  const commitTimeout = useCallback(() => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' ? DEFAULT_SETTINGS.timeout : Number.isNaN(nextTimeout) ? draft.timeout : nextTimeout
    setTimeoutInput(String(normalizedTimeout))
    commitSettings({ ...draft, timeout: normalizedTimeout })
  }, [draft, timeoutInput])

  useCloseOnEscape(showSettings, handleClose)

  if (!showSettings) return null

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) importData(file)
    e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 overflow-y-auto max-h-[85vh] custom-scrollbar"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <section>
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              API 配置
            </h4>
            <div className="space-y-4">
              {user && (
                <div className="rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Profile</span>
                    <select
                      value={activeProfileId || ''}
                      onChange={(e) => switchToProfile(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-200/70 bg-white/60 px-2 py-1 text-xs text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.isDefault ? ' (默认)' : ''}
                        </option>
                      ))}
                    </select>
                    {loading && (
                      <svg className="animate-spin h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <input
                      type="text"
                      value={draftProfileName}
                      onChange={(e) => setDraftProfileName(e.target.value)}
                      placeholder="Profile 名称"
                      className="flex-1 rounded-lg border border-gray-200/70 bg-white/60 px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
                    />
                    <button type="button" onClick={createNewProfile} className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-300 transition">+ 新建</button>
                    <button type="button" onClick={setAsDefault} className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-300 transition">设默认</button>
                    <button type="button" onClick={deleteCurrentProfile} className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 dark:bg-red-500/10 dark:hover:bg-red-500/20 dark:text-red-400 transition">删除</button>
                  </div>
                  <label className="block">
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Provider</span>
                    <select
                      value={draftProvider}
                      onChange={(e) => setDraftProvider(e.target.value)}
                      className="w-full rounded-lg border border-gray-200/70 bg-white/60 px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
                    >
                      {allProviderOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {draftProvider !== 'openai' && (
                      <div className="mt-1 text-[10px] text-red-500 dark:text-red-400">当前部署仅启用 OpenAI 兼容，选择其他 provider 提交任务会失败</div>
                    )}
                  </label>
                </div>
              )}

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求格式</span>
                <select
                  value={draft.apiFormat ?? 'imagen'}
                  onChange={(e) => {
                    const apiFormat = e.target.value as ApiFormat
                    const nextDraft = { ...draft, apiFormat }
                    setDraft(nextDraft)
                    commitSettings(nextDraft)
                  }}
                  disabled={draftProvider !== 'openai'}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="imagen">Images API (imagen)</option>
                  <option value="responses">Responses API</option>
                </select>
                {(draft.apiFormat ?? 'imagen') === 'responses' && (
                  <div className="mt-1 text-[10px] text-amber-500 dark:text-amber-400">
                    将使用 /v1/responses 端点，模型需填写支持图片生成工具的模型（如 gpt-4.1-mini）
                  </div>
                )}
              </label>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API URL</span>
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  onBlur={(e) => commitSettings({ ...draft, baseUrl: e.target.value })}
                  type="text"
                  placeholder={DEFAULT_SETTINGS.baseUrl}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  留空时使用服务器配置的默认 API URL；支持通过查询参数覆盖：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiUrl=</code>
                </div>
              </label>

              <div className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</span>
                <div className="relative">
                  <input
                    value={apiKeyChanged ? draft.apiKey : (draft.apiKey || '••••••••••••••••')}
                    onChange={(e) => {
                      setDraft((prev) => ({ ...prev, apiKey: e.target.value }))
                      setApiKeyChanged(true)
                    }}
                    onFocus={() => {
                      if (!apiKeyChanged) {
                        setDraft((prev) => ({ ...prev, apiKey: '' }))
                      }
                    }}
                    onBlur={(e) => commitSettings({ ...draft, apiKey: e.target.value })}
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showApiKey ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  留空时使用服务器配置的默认 API Key；保留掩码时不修改原 Key
                </div>
              </div>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">模型 ID</span>
                <input
                  value={draft.model}
                  onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
                  onBlur={(e) => commitSettings({ ...draft, model: e.target.value })}
                  type="text"
                  placeholder="gpt-image-2"
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求超时 (秒)</span>
                <input
                  value={timeoutInput}
                  onChange={(e) => setTimeoutInput(e.target.value)}
                  onBlur={commitTimeout}
                  type="number"
                  min={10}
                  max={600}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>
            </div>
          </section>

          <section className="pt-6 border-t border-gray-100 dark:border-white/[0.08]">
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              数据管理
            </h4>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => exportData()}
                  className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  导出
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  导入
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleImport}
                />
              </div>
              <button
                onClick={() =>
                  setConfirmDialog({
                    title: '清空所有数据',
                    message: '确定要清空所有任务记录和图片数据吗？此操作不可恢复。',
                    action: () => clearAllData(),
                  })
                }
                className="w-full rounded-xl border border-red-200/80 bg-red-50/50 px-4 py-2.5 text-sm text-red-500 transition hover:bg-red-100/80 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
              >
                清空所有数据
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
