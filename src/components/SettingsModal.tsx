import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { normalizeBaseUrl } from '../lib/api'
import { useStore, exportData, importData, clearAllData, loadProfiles, setPreference } from '../store'
import { DEFAULT_SETTINGS, type AppSettings, type ApiFormat } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import * as backendApi from '../lib/backendApi'
import { buildShareUrl, parseImportInput } from '../lib/urlSettings'
import MyQuotaCard from './MyQuotaCard'

type TabKey = 'api' | 'preferences' | 'quota' | 'data'

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

  const [activeTab, setActiveTab] = useState<TabKey>('api')
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [timeoutInput, setTimeoutInput] = useState(String(settings.timeout))
  const [showApiKey, setShowApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiKeyChanged, setApiKeyChanged] = useState(false)
  const [draftProfileName, setDraftProfileName] = useState('')
  const [draftProvider, setDraftProvider] = useState<string>('openai')
  /** dirty 状态下被拦截的目标操作；null 时无拦截 */
  const [pendingNav, setPendingNav] = useState<null | { kind: 'close' } | { kind: 'switch'; profileId: string } | { kind: 'tab'; tab: TabKey }>(null)

  const allProviderOptions = useMemo(
    () => [
      ...PROVIDER_OPTIONS,
      ...customProviders.map((cp) => ({ value: cp.id, label: `自定义: ${cp.name}` })),
    ],
    [customProviders],
  )

  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || null,
    [profiles, activeProfileId],
  )

  /** API 配置区是否有未保存修改 */
  const isApiDirty = useMemo(() => {
    if (!currentProfile) return false
    if (apiKeyChanged) return true
    if (draftProfileName !== currentProfile.name) return true
    if (draftProvider !== currentProfile.provider) return true
    if (draft.baseUrl !== currentProfile.baseUrl) return true
    if (draft.model !== currentProfile.model) return true
    if (draft.apiFormat !== currentProfile.apiFormat) return true
    const t = Number(timeoutInput)
    if (timeoutInput.trim() === '' || Number.isNaN(t)) return true
    if (t !== currentProfile.timeout) return true
    return false
  }, [currentProfile, apiKeyChanged, draftProfileName, draftProvider, draft, timeoutInput])

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

  /** 把 draft 同步到 store.settings（用于 task 提交时的 timeout 等） */
  const commitDraftToSettings = useCallback(() => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' || Number.isNaN(nextTimeout) ? DEFAULT_SETTINGS.timeout : nextTimeout
    const finalSettings: AppSettings = {
      ...draft,
      baseUrl: normalizeBaseUrl(draft.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl),
      apiKey: draft.apiKey,
      model: draft.model.trim() || DEFAULT_SETTINGS.model,
      timeout: normalizedTimeout,
    }
    setDraft(finalSettings)
    setTimeoutInput(String(normalizedTimeout))
    setSettings(finalSettings)
    return finalSettings
  }, [draft, timeoutInput, setSettings])

  /** 保存当前 Profile：先同步本地 store，再写入后端 */
  const saveCurrentProfile = async () => {
    if (!user || !activeProfileId) return
    const finalSettings = commitDraftToSettings()
    setSaving(true)
    try {
      const payload: Parameters<typeof backendApi.updateProfile>[1] = {
        name: draftProfileName.trim() || '未命名',
        provider: draftProvider,
        base_url: finalSettings.baseUrl,
        model: finalSettings.model,
        timeout: finalSettings.timeout,
        api_format: finalSettings.apiFormat,
      }
      if (apiKeyChanged) payload.api_key = finalSettings.apiKey
      await backendApi.updateProfile(activeProfileId, payload)
      await loadProfiles()
      setApiKeyChanged(false)
      showToast('已保存', 'success')
    } catch (error) {
      console.error('Failed to save profile:', error)
      showToast('保存配置失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  /** 放弃 draft，恢复到 currentProfile */
  const discardDraft = () => {
    if (!currentProfile) return
    switchToProfile(currentProfile.id)
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

  const handleShareProfile = async () => {
    if (!user || !activeProfileId) {
      showToast('请先选择 Profile', 'error')
      return
    }
    const profile = profiles.find((p) => p.id === activeProfileId)
    if (!profile) return
    const url = buildShareUrl({
      name: draftProfileName || profile.name,
      provider: draftProvider,
      base_url: draft.baseUrl,
      model: draft.model,
      timeout: draft.timeout,
      api_format: draft.apiFormat,
    })
    try {
      await navigator.clipboard.writeText(url)
      showToast('分享链接已复制（不含 API Key）', 'success')
    } catch {
      window.prompt('复制此链接以分享 Profile 配置（不含 API Key）', url)
    }
  }

  const handleImportProfile = async () => {
    if (!user) {
      showToast('请先登录', 'error')
      return
    }
    const input = window.prompt('粘贴分享链接、settings 编码或 JSON：')
    if (!input) return
    let payload = parseImportInput(input)
    if (!payload) {
      try {
        const u = new URL(input)
        const s = u.searchParams.get('settings')
        if (s) payload = parseImportInput(s)
      } catch {
        // ignore
      }
    }
    if (!payload) {
      showToast('未能解析输入内容', 'error')
      return
    }
    try {
      const res = await backendApi.createProfile({
        name: payload.name?.slice(0, 100) || 'Imported',
        provider: payload.provider || 'openai',
        base_url: payload.base_url || '',
        api_key: payload.api_key || '',
        model: payload.model || '',
        timeout: typeof payload.timeout === 'number' ? payload.timeout : 600,
        api_format: payload.api_format === 'imagen' ? 'imagen' : 'responses',
        extra: payload.extra,
      })
      await loadProfiles()
      switchToProfile(res.id)
      showToast('已导入 Profile', 'success')
    } catch (error) {
      console.error('Failed to import profile:', error)
      showToast('导入失败', 'error')
    }
  }

  /** 在执行某个会丢弃 draft 的操作前，如果 dirty 则先弹拦截条 */
  const guard = (action: () => void, intent: Exclude<typeof pendingNav, null>): void => {
    if (isApiDirty) {
      setPendingNav(intent)
      return
    }
    action()
  }

  const handleRequestClose = () => guard(() => setShowSettings(false), { kind: 'close' })
  const handleRequestSwitchProfile = (profileId: string) =>
    guard(() => switchToProfile(profileId), { kind: 'switch', profileId })
  const handleRequestSwitchTab = (tab: TabKey) => {
    if (tab === activeTab) return
    if (tab !== 'api' && isApiDirty) {
      setPendingNav({ kind: 'tab', tab })
      return
    }
    setActiveTab(tab)
  }

  /** 处理拦截条上的"保存并继续" */
  const resumePendingAfterSave = async () => {
    await saveCurrentProfile()
    const nav = pendingNav
    setPendingNav(null)
    if (!nav) return
    if (nav.kind === 'close') setShowSettings(false)
    else if (nav.kind === 'switch') switchToProfile(nav.profileId)
    else if (nav.kind === 'tab') setActiveTab(nav.tab)
  }

  /** 处理拦截条上的"放弃修改" */
  const resumePendingAfterDiscard = () => {
    const nav = pendingNav
    setPendingNav(null)
    discardDraft()
    if (!nav) return
    if (nav.kind === 'close') setShowSettings(false)
    else if (nav.kind === 'switch') switchToProfile(nav.profileId)
    else if (nav.kind === 'tab') setActiveTab(nav.tab)
  }

  useCloseOnEscape(showSettings, handleRequestClose)

  if (!showSettings) return null

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) importData(file)
    e.target.value = ''
  }

  const navItems: { key: TabKey; label: string; icon: React.ReactNode; visible: boolean }[] = [
    {
      key: 'api',
      label: 'API 配置',
      visible: true,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      ),
    },
    {
      key: 'preferences',
      label: '习惯偏好',
      visible: true,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    {
      key: 'quota',
      label: '我的额度',
      visible: !!user,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
        </svg>
      ),
    },
    {
      key: 'data',
      label: '数据管理',
      visible: true,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
        </svg>
      ),
    },
  ]

  const visibleNav = navItems.filter((n) => n.visible)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleRequestClose}
      />
      <div className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-4 border-b border-gray-100 dark:border-white/[0.06]">
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
              onClick={handleRequestClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body：左侧菜单 + 右侧内容 */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* 顶部 chips（移动端） */}
          <nav className="md:hidden flex gap-1.5 overflow-x-auto px-4 py-2 border-b border-gray-100 dark:border-white/[0.06] hide-scrollbar">
            {visibleNav.map((item) => (
              <button
                key={item.key}
                onClick={() => handleRequestSwitchTab(item.key)}
                className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition ${
                  activeTab === item.key
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* 左侧菜单（桌面端） */}
          <nav className="hidden md:flex md:w-44 shrink-0 flex-col gap-1 border-r border-gray-100 dark:border-white/[0.06] p-3">
            {visibleNav.map((item) => (
              <button
                key={item.key}
                onClick={() => handleRequestSwitchTab(item.key)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition text-left ${
                  activeTab === item.key
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
              >
                <span className={activeTab === item.key ? 'text-blue-500 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          {/* 右侧内容 */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar">
              {activeTab === 'api' && (
                <ApiTab
                  user={user}
                  profiles={profiles}
                  activeProfileId={activeProfileId}
                  loading={loading}
                  draft={draft}
                  setDraft={setDraft}
                  draftProfileName={draftProfileName}
                  setDraftProfileName={setDraftProfileName}
                  draftProvider={draftProvider}
                  setDraftProvider={setDraftProvider}
                  timeoutInput={timeoutInput}
                  setTimeoutInput={setTimeoutInput}
                  apiKeyChanged={apiKeyChanged}
                  setApiKeyChanged={setApiKeyChanged}
                  showApiKey={showApiKey}
                  setShowApiKey={setShowApiKey}
                  allProviderOptions={allProviderOptions}
                  onSwitchProfile={handleRequestSwitchProfile}
                  onCreateNewProfile={createNewProfile}
                  onDeleteCurrentProfile={deleteCurrentProfile}
                  onSetAsDefault={setAsDefault}
                  onShareProfile={handleShareProfile}
                  onImportProfile={handleImportProfile}
                />
              )}

              {activeTab === 'preferences' && <PreferencesTab settings={settings} />}

              {activeTab === 'quota' && user && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">我的额度</h4>
                  <MyQuotaCard />
                </div>
              )}

              {activeTab === 'data' && (
                <DataTab
                  importInputRef={importInputRef}
                  onImport={handleImport}
                  onConfirmClear={() =>
                    setConfirmDialog({
                      title: '清空所有数据',
                      message: '确定要清空所有任务记录和图片数据吗？此操作不可恢复。',
                      action: () => clearAllData(),
                    })
                  }
                />
              )}
            </div>

            {/* 底部保存栏：仅 API tab 显示 */}
            {activeTab === 'api' && user && currentProfile && (
              <div className="border-t border-gray-100 dark:border-white/[0.06] px-5 py-3 flex items-center justify-between gap-3 bg-gray-50/40 dark:bg-white/[0.02]">
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 min-w-0">
                  {isApiDirty ? (
                    <>
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="truncate">有未保存的修改</span>
                    </>
                  ) : (
                    <>
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="truncate">已与服务器同步</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={discardDraft}
                    disabled={!isApiDirty || saving}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    放弃修改
                  </button>
                  <button
                    type="button"
                    onClick={saveCurrentProfile}
                    disabled={!isApiDirty || saving}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {saving && (
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    )}
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* dirty 拦截条 */}
        {pendingNav && (
          <div className="absolute left-0 right-0 bottom-0 mx-auto p-3 z-20">
            <div className="mx-auto max-w-md rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/95 dark:bg-amber-500/10 backdrop-blur p-3 shadow-lg ring-1 ring-amber-200/50 flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-amber-800 dark:text-amber-200">有未保存的修改</div>
                <div className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">是否保存当前 Profile 的修改？</div>
                <div className="flex items-center gap-2 mt-2.5">
                  <button
                    type="button"
                    onClick={resumePendingAfterSave}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition disabled:opacity-50"
                  >
                    保存并继续
                  </button>
                  <button
                    type="button"
                    onClick={resumePendingAfterDiscard}
                    className="px-3 py-1.5 rounded-lg text-xs text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/10 transition"
                  >
                    放弃修改
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingNav(null)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition ml-auto"
                  >
                    继续编辑
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =====================
// API Tab
// =====================

interface ApiTabProps {
  user: ReturnType<typeof useStore.getState>['user']
  profiles: ReturnType<typeof useStore.getState>['profiles']
  activeProfileId: string | null
  loading: boolean
  draft: AppSettings
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>
  draftProfileName: string
  setDraftProfileName: (v: string) => void
  draftProvider: string
  setDraftProvider: (v: string) => void
  timeoutInput: string
  setTimeoutInput: (v: string) => void
  apiKeyChanged: boolean
  setApiKeyChanged: (v: boolean) => void
  showApiKey: boolean
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>
  allProviderOptions: { value: string; label: string }[]
  onSwitchProfile: (profileId: string) => void
  onCreateNewProfile: () => void
  onDeleteCurrentProfile: () => void
  onSetAsDefault: () => void
  onShareProfile: () => void
  onImportProfile: () => void
}

function ApiTab({
  user,
  profiles,
  activeProfileId,
  loading,
  draft,
  setDraft,
  draftProfileName,
  setDraftProfileName,
  draftProvider,
  setDraftProvider,
  timeoutInput,
  setTimeoutInput,
  apiKeyChanged,
  setApiKeyChanged,
  showApiKey,
  setShowApiKey,
  allProviderOptions,
  onSwitchProfile,
  onCreateNewProfile,
  onDeleteCurrentProfile,
  onSetAsDefault,
  onShareProfile,
  onImportProfile,
}: ApiTabProps) {
  const fieldLabel = 'block text-xs text-gray-500 dark:text-gray-400 mb-1.5'
  const fieldInput =
    'w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50'

  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">API 配置</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          管理调用图片生成接口所用的服务地址、密钥与模型。修改后点击右下角「保存」生效。
        </p>
      </div>

      {!user && (
        <div className="rounded-xl border border-blue-200/70 dark:border-blue-500/20 bg-blue-50/60 dark:bg-blue-500/[0.08] px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>登录后才能管理 API Profile 并保存配置到云端。</span>
        </div>
      )}

      {/* Profile 选择 + 操作 */}
      {user && (
        <section className="rounded-2xl border border-gray-200/70 dark:border-white/[0.06] bg-white/40 dark:bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 w-16">Profile</span>
            <select
              value={activeProfileId || ''}
              onChange={(e) => onSwitchProfile(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200/70 bg-white/70 px-2.5 py-1.5 text-xs text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? ' (默认)' : ''}
                </option>
              ))}
            </select>
            {loading && (
              <svg className="animate-spin h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 w-16">名称</span>
            <input
              type="text"
              value={draftProfileName}
              onChange={(e) => setDraftProfileName(e.target.value)}
              placeholder="Profile 名称"
              className="flex-1 rounded-lg border border-gray-200/70 bg-white/70 px-2.5 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
            <button type="button" onClick={onCreateNewProfile} className="px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-300 transition flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              新建
            </button>
            <button type="button" onClick={onSetAsDefault} className="px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-300 transition flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              设默认
            </button>
            <button type="button" onClick={onShareProfile} className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 dark:text-blue-300 transition flex items-center gap-1" title="复制分享链接（不含 API Key）">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.032 4.026a3 3 0 10-2.684-4.684M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              分享链接
            </button>
            <button type="button" onClick={onImportProfile} className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 dark:text-blue-300 transition flex items-center gap-1" title="粘贴分享链接 / JSON 导入 Profile">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              导入
            </button>
            <button type="button" onClick={onDeleteCurrentProfile} className="ml-auto px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 dark:bg-red-500/10 dark:hover:bg-red-500/20 dark:text-red-400 transition flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              删除
            </button>
          </div>
        </section>
      )}

      {/* 详细字段 */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {user && (
            <label className="block">
              <span className={fieldLabel}>Provider</span>
              <select
                value={draftProvider}
                onChange={(e) => setDraftProvider(e.target.value)}
                className={fieldInput}
              >
                {allProviderOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {draftProvider !== 'openai' && (
                <div className="mt-1 text-[10px] text-red-500 dark:text-red-400">
                  当前部署仅启用 OpenAI 兼容，选其他 provider 提交任务会失败
                </div>
              )}
            </label>
          )}

          <label className="block">
            <span className={fieldLabel}>请求格式</span>
            <select
              value={draft.apiFormat ?? 'imagen'}
              onChange={(e) => {
                const apiFormat = e.target.value as ApiFormat
                setDraft((prev) => ({ ...prev, apiFormat }))
              }}
              disabled={user ? draftProvider !== 'openai' : false}
              className={`${fieldInput} disabled:opacity-50 disabled:cursor-not-allowed`}
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
        </div>

        <label className="block">
          <span className={fieldLabel}>API URL</span>
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
            type="text"
            placeholder={DEFAULT_SETTINGS.baseUrl || 'https://api.openai.com'}
            className={fieldInput}
          />
          <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
            留空时使用服务器配置的默认 API URL；也可通过查询参数覆盖：
            <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiUrl=</code>
          </div>
        </label>

        <div className="block">
          <span className={fieldLabel}>API Key</span>
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
              type={showApiKey ? 'text' : 'password'}
              placeholder="sk-..."
              className={`${fieldInput} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
              tabIndex={-1}
              aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
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
            留空时使用服务器配置的默认 API Key；保留掩码不会修改原 Key
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={fieldLabel}>模型 ID</span>
            <input
              value={draft.model}
              onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
              type="text"
              placeholder="gpt-image-2"
              className={fieldInput}
            />
          </label>

          <label className="block">
            <span className={fieldLabel}>请求超时 (秒)</span>
            <input
              value={timeoutInput}
              onChange={(e) => setTimeoutInput(e.target.value)}
              type="number"
              min={10}
              max={600}
              className={fieldInput}
            />
          </label>
        </div>
      </section>
    </div>
  )
}

// =====================
// Preferences Tab
// =====================

function PreferencesTab({ settings }: { settings: AppSettings }) {
  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">习惯偏好</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          这些开关会即时生效并同步到云端，无需手动保存。
        </p>
      </div>
      <div className="space-y-1.5">
        <ToggleRow
          label="Enter 直接提交"
          desc="关闭时仅 Ctrl/⌘+Enter 提交，Enter 用于换行"
          checked={settings.enterSubmit}
          onChange={(v) => setPreference('enterSubmit', v)}
        />
        <ToggleRow
          label="提交后清空输入框"
          desc="关闭时提示词与参考图在提交后保留，方便微调再发"
          checked={settings.clearInputAfterSubmit}
          onChange={(v) => setPreference('clearInputAfterSubmit', v)}
        />
        <ToggleRow
          label="重启后恢复上次输入"
          desc="开启时刷新或重新打开页面后保留最后一次的提示词"
          checked={settings.persistInputOnRestart}
          onChange={(v) => setPreference('persistInputOnRestart', v)}
        />
      </div>
    </div>
  )
}

// =====================
// Data Tab
// =====================

function DataTab({
  importInputRef,
  onImport,
  onConfirmClear,
}: {
  importInputRef: React.RefObject<HTMLInputElement | null>
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void
  onConfirmClear: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">数据管理</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          导出本地任务为 ZIP，或从备份恢复。清空操作不可恢复，请谨慎操作。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => exportData()}
          className="rounded-xl bg-gray-100/80 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          导出全部数据
        </button>
        <button
          onClick={() => importInputRef.current?.click()}
          className="rounded-xl bg-gray-100/80 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          导入 ZIP
        </button>
        <input ref={importInputRef} type="file" accept=".zip" className="hidden" onChange={onImport} />
      </div>

      <div className="rounded-xl border border-red-200/80 dark:border-red-500/20 bg-red-50/40 dark:bg-red-500/[0.06] p-4">
        <div className="text-sm font-medium text-red-600 dark:text-red-400">危险区</div>
        <p className="text-xs text-red-500/80 dark:text-red-300/70 mt-1">
          清空所有任务记录和图片数据。该操作不可恢复，请先导出备份。
        </p>
        <button
          onClick={onConfirmClear}
          className="mt-3 px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition"
        >
          清空所有数据
        </button>
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.03] transition cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative shrink-0 w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-white/[0.1]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-700 dark:text-gray-200">{label}</div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug mt-0.5">{desc}</div>
      </div>
    </label>
  )
}
