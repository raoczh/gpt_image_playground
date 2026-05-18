import { useEffect } from 'react'
import { useStore } from '../store'
import Select from './Select'
import { listUsers } from '../lib/adminApi'

export default function SearchBar() {
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const filterUserId = useStore((s) => s.filterUserId)
  const setFilterUserId = useStore((s) => s.setFilterUserId)
  const adminUsers = useStore((s) => s.adminUsers)
  const setAdminUsers = useStore((s) => s.setAdminUsers)
  const user = useStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!isAdmin || adminUsers.length > 0) return
    let cancelled = false
    listUsers({ limit: 200 })
      .then((page) => {
        if (cancelled) return
        setAdminUsers(page.items.map((u) => ({ id: u.id, username: u.username })))
      })
      .catch((err) => console.error('Failed to load admin users for filter:', err))
    return () => {
      cancelled = true
    }
  }, [isAdmin, adminUsers.length, setAdminUsers])

  const userFilterOptions = [
    { label: '全部', value: 'all' as const },
    ...adminUsers.map((u) => ({ label: u.username, value: u.id })),
  ]

  return (
    <div className="mt-6 mb-4 flex gap-3 flex-wrap">
      <div className="relative w-32 flex-shrink-0 z-20">
        <Select
          value={filterStatus}
          onChange={(val) => setFilterStatus(val as any)}
          options={[
            { label: '全部状态', value: 'all' },
            { label: '已完成', value: 'done' },
            { label: '生成中', value: 'running' },
            { label: '失败', value: 'error' },
          ]}
          className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-white/[0.06] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
        />
      </div>
      {isAdmin && (
        <div className="relative w-40 flex-shrink-0 z-20">
          <Select
            value={filterUserId}
            onChange={(val) => setFilterUserId(val === 'all' ? 'all' : Number(val))}
            options={userFilterOptions}
            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-white/[0.06] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => setFilterFavorite(!filterFavorite)}
        title={filterFavorite ? '取消只看收藏' : '只看收藏'}
        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm transition ${
          filterFavorite
            ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
            : 'border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06]'
        }`}
      >
        <svg className="w-4 h-4" fill={filterFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.077 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.673z" />
        </svg>
        <span className="hidden sm:inline">收藏</span>
      </button>
      <div className="relative flex-1 z-10">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder="搜索提示词、参数..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
        />
      </div>
    </div>
  )
}
