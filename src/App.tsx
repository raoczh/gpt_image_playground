import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { initStore, loadProfiles } from './store'
import { useStore } from './store'
import { normalizeBaseUrl } from './lib/api'
import { getCurrentUser } from './lib/backendApi'
import * as backendApi from './lib/backendApi'
import { decodeShareableProfile } from './lib/urlSettings'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import MaskEditorModal from './components/MaskEditorModal'
import LoginPage from './pages/LoginPage'
import PendingPage from './pages/PendingPage'
import MaintenancePage from './pages/MaintenancePage'
import StatusGuard from './components/StatusGuard'
import AnnouncementBanner from './components/AnnouncementBanner'
import AdminGuard from './components/AdminGuard'

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const StatsPage = lazy(() => import('./pages/admin/StatsPage'))
const UsersPage = lazy(() => import('./pages/admin/UsersPage'))
const UserTasksPage = lazy(() => import('./pages/admin/UserTasksPage'))
const AllowlistPage = lazy(() => import('./pages/admin/AllowlistPage'))
const AuditLogPage = lazy(() => import('./pages/admin/AuditLogPage'))
const ConfigPage = lazy(() => import('./pages/admin/ConfigPage'))

function AuthLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <svg className="animate-spin h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
  )
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = useStore((s) => s.user)
  const authLoading = useStore((s) => s.authLoading)

  if (authLoading) return <AuthLoadingFallback />
  if (!user) return <Navigate to="/login" replace />

  return <>{children}</>
}

function MainApp() {
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings: { baseUrl?: string; apiKey?: string } = {}

    const apiUrlParam = searchParams.get('apiUrl')
    if (apiUrlParam !== null) {
      nextSettings.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
    }

    const apiKeyParam = searchParams.get('apiKey')
    if (apiKeyParam !== null) {
      nextSettings.apiKey = apiKeyParam.trim()
    }

    // B-1 ?settings=base64-json：导入分享的 Profile 配置
    const settingsParam = searchParams.get('settings')
    let pendingShareProfile: ReturnType<typeof decodeShareableProfile> | null = null
    if (settingsParam) {
      pendingShareProfile = decodeShareableProfile(settingsParam)
      if (!pendingShareProfile) {
        showToast('?settings= 参数无效，已忽略', 'error')
      }
    }

    if (Object.keys(nextSettings).length > 0) {
      setSettings(nextSettings)
    }

    if (nextSettings.baseUrl !== undefined || nextSettings.apiKey !== undefined || settingsParam) {
      searchParams.delete('apiUrl')
      searchParams.delete('apiKey')
      searchParams.delete('settings')

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    initStore().then(async () => {
      if (!pendingShareProfile) return
      try {
        await backendApi.createProfile({
          name: pendingShareProfile.name?.slice(0, 100) || '导入',
          provider: pendingShareProfile.provider || 'openai',
          base_url: pendingShareProfile.base_url || '',
          api_key: pendingShareProfile.api_key || '',
          model: pendingShareProfile.model || '',
          timeout: typeof pendingShareProfile.timeout === 'number' ? pendingShareProfile.timeout : 600,
          api_format: pendingShareProfile.api_format === 'imagen' ? 'imagen' : 'responses',
          extra: pendingShareProfile.extra,
        })
        await loadProfiles()
        showToast('已从 URL 导入 Profile', 'success')
      } catch (err) {
        console.error('Failed to import shared profile:', err)
        showToast('导入分享的 Profile 失败', 'error')
      }
    })
  }, [setSettings, showToast])

  return (
    <>
      <AnnouncementBanner />
      <Header />
      <main data-home-main className="safe-area-x max-w-7xl mx-auto pb-48">
        <SearchBar />
        <TaskGrid />
      </main>
      <InputBar />
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <Toast />
      <ImageContextMenu />
      <MaskEditorModal />
    </>
  )
}

export default function App() {
  const setUser = useStore((s) => s.setUser)
  const setAuthLoading = useStore((s) => s.setAuthLoading)

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setUser(user)
        // 用户登录成功后清空浏览器存储（保留应用持久化偏好）
        if (user) {
          const PRESERVE_KEYS = new Set(['gpt-image-playground-prefs'])
          for (const key of Object.keys(localStorage)) {
            if (!PRESERVE_KEYS.has(key)) localStorage.removeItem(key)
          }
          sessionStorage.clear()
        }
      })
      .catch((error) => {
        console.error('Failed to get current user:', error)
        setUser(null)
      })
      .finally(() => {
        setAuthLoading(false)
      })
  }, [setUser, setAuthLoading])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/maintenance" element={<MaintenancePage />} />
      <Route element={<StatusGuard />}>
        <Route
          path="/pending"
          element={
            <AuthGuard>
              <PendingPage />
            </AuthGuard>
          }
        />
        <Route
          path="/admin"
          element={
            <AuthGuard>
              <AdminGuard />
            </AuthGuard>
          }
        >
          <Route
            element={
              <Suspense fallback={<AuthLoadingFallback />}>
                <AdminLayout />
              </Suspense>
            }
          >
            <Route index element={<Navigate to="stats" replace />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/:id/tasks" element={<UserTasksPage />} />
            <Route path="allowlist" element={<AllowlistPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="config" element={<ConfigPage />} />
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <AuthGuard>
              <MainApp />
            </AuthGuard>
          }
        />
      </Route>
    </Routes>
  )
}
