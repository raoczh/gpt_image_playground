import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useStore } from '../../store'

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/admin/stats', label: '仪表盘' },
  { to: '/admin/users', label: '用户管理' },
  { to: '/admin/allowlist', label: '注册白名单' },
  { to: '/admin/audit', label: '审计日志' },
  { to: '/admin/config', label: '系统配置' },
]

export default function AdminLayout() {
  const user = useStore((s) => s.user)
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="safe-area-top sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08]">
        <div className="safe-area-x max-w-7xl mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
              ← 返回应用
            </button>
            <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              管理后台
            </h1>
          </div>
          {user && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
              <span>{user.username}</span>
              <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                admin
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="safe-area-x max-w-7xl mx-auto flex gap-6 py-6 px-4">
        <aside className="w-44 shrink-0">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
