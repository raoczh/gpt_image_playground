import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useStore } from '../../store'

const NAV_ITEMS: { to: string; label: string; icon: ReactNode }[] = [
  {
    to: '/admin/stats',
    label: '仪表盘',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4.5-4.5 4 4 7-7M21 6h-4M21 6v4" />
      </svg>
    ),
  },
  {
    to: '/admin/users',
    label: '用户管理',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 14a4 4 0 10-8 0M12 11a3 3 0 100-6 3 3 0 000 6zm-9 9a9 9 0 0118 0" />
      </svg>
    ),
  },
  {
    to: '/admin/allowlist',
    label: '注册白名单',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.5l2 2L15.5 10M20 12a8 8 0 11-16 0 8 8 0 0116 0z" />
      </svg>
    ),
  },
  {
    to: '/admin/audit',
    label: '审计日志',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 11h8M8 15h5M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" />
      </svg>
    ),
  },
  {
    to: '/admin/config',
    label: '系统配置',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a1.724 1.724 0 013.35 0c.272 1.099 1.557 1.578 2.45.93 1.04-.76 2.405.611 1.645 1.65-.648.891-.17 2.178.93 2.45a1.724 1.724 0 010 3.35c-1.1.272-1.578 1.559-.93 2.45.76 1.039-.605 2.405-1.645 1.65-.893-.648-2.178-.17-2.45.93a1.724 1.724 0 01-3.35 0c-.272-1.1-1.557-1.578-2.45-.93-1.04.76-2.405-.611-1.645-1.65.648-.892.17-2.179-.93-2.45a1.724 1.724 0 010-3.35c1.099-.272 1.578-1.559.93-2.45-.76-1.04.605-2.41 1.645-1.65.893.648 2.178.17 2.45-.93z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export default function AdminLayout() {
  const user = useStore((s) => s.user)
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="safe-area-top sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08]">
        <div className="safe-area-x max-w-7xl mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              title="返回应用主页"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">返回应用</span>
            </button>
            <span className="w-px h-5 bg-gray-200 dark:bg-white/[0.08]" aria-hidden />
            <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100 truncate">
              管理后台
            </h1>
          </div>
          {user && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
              <span className="hidden sm:inline truncate max-w-[120px]">{user.username}</span>
              <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                admin
              </span>
            </div>
          )}
        </div>
        {/* 移动端横向导航 */}
        <nav className="md:hidden border-t border-gray-200 dark:border-white/[0.08] overflow-x-auto hide-scrollbar">
          <div className="flex gap-1 px-3 py-2 min-w-max">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-900'
                  }`
                }
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <div className="safe-area-x max-w-7xl mx-auto flex flex-col md:flex-row gap-6 py-6 px-4">
        {/* 桌面端侧边栏 */}
        <aside className="hidden md:block w-44 shrink-0">
          <nav className="space-y-1 sticky top-20">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-900'
                  }`
                }
              >
                <span aria-hidden>{item.icon}</span>
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
