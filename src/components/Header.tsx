import { useStore } from '../store'
import { redirectToGitHubLogin, logout } from '../lib/backendApi'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, HelpCircle, Settings } from 'lucide-react'
import HelpModal from './HelpModal'
import IconButton from './ui/IconButton'
import { GithubIcon } from './icons'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectIosOrWeChat() {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isWeChat = /MicroMessenger/i.test(ua)
  return { isIOS, isWeChat }
}

export default function Header() {
  const user = useStore((s) => s.user)
  const setUser = useStore((s) => s.setUser)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsStandalone(standalone)

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      setInstallEvent(null)
      setIsStandalone(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
      setUser(null)
      setShowUserMenu(false)
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const handleInstall = async () => {
    if (installEvent) {
      try {
        await installEvent.prompt()
        await installEvent.userChoice
      } finally {
        setInstallEvent(null)
      }
      return
    }
    const { isIOS, isWeChat } = detectIosOrWeChat()
    if (isWeChat) {
      showToast('请点击右上角菜单 → 在浏览器中打开后再安装', 'info')
    } else if (isIOS) {
      showToast('请点击 Safari 分享按钮 → "添加到主屏幕"', 'info')
    } else {
      showToast('请在浏览器菜单中选择"安装应用"', 'info')
    }
  }

  const showInstallButton = !isStandalone

  return (
    <header className="safe-area-top sticky top-0 z-40 border-b border-border bg-surface">
      <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight text-foreground">
          GPT Image Playground
        </h1>
        <div className="flex items-center gap-1">
          {showInstallButton && (
            <IconButton onClick={handleInstall} title="安装应用" aria-label="安装应用">
              <Download className="h-5 w-5" />
            </IconButton>
          )}

          <IconButton onClick={() => setShowHelp(true)} title="操作指南" aria-label="操作指南">
            <HelpCircle className="h-5 w-5" />
          </IconButton>

          {/* 用户信息或登录按钮 */}
          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-surface-2"
                title={user.username}
              >
                <img src={user.avatar_url} alt={user.username} className="h-7 w-7 rounded-full" />
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-border bg-elevated shadow-lg">
                    <div className="border-b border-border p-3">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {user.username}
                        {user.role === 'admin' && (
                          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                            admin
                          </span>
                        )}
                      </div>
                      {user.email && (
                        <div className="truncate text-xs text-muted">{user.email}</div>
                      )}
                    </div>
                    {user.role === 'admin' && (
                      <button
                        onClick={() => {
                          setShowUserMenu(false)
                          navigate('/admin')
                        }}
                        className="w-full border-b border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-2"
                      >
                        管理后台
                      </button>
                    )}
                    <button
                      onClick={handleLogout}
                      className="w-full rounded-b-xl px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
                    >
                      退出登录
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={redirectToGitHubLogin}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-surface transition-colors hover:bg-foreground/90"
            >
              <GithubIcon className="h-4 w-4" />
              登录
            </button>
          )}

          <IconButton onClick={() => setShowSettings(true)} title="设置" aria-label="设置">
            <Settings className="h-5 w-5" />
          </IconButton>
        </div>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </header>
  )
}
