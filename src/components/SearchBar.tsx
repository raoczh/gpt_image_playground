import { useEffect } from 'react'
import { Search, Star } from 'lucide-react'
import { useStore, loadTasksFirstPage } from '../store'
import Select from './Select'
import Button from './ui/Button'
import { Input } from './ui/Field'
import { cn } from '../lib/cn'
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
  const tasksLoading = useStore((s) => s.tasksLoading)
  const isAdmin = user?.role === 'admin'

  const handleSearch = () => {
    loadTasksFirstPage().catch(console.error)
  }

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

  const selectClass =
    'px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-sm text-foreground transition-colors'

  return (
    <div className="mt-6 mb-4 flex flex-wrap gap-3">
      <div className="relative z-20 w-32 flex-shrink-0">
        <Select
          value={filterStatus}
          onChange={(val) => setFilterStatus(val as any)}
          options={[
            { label: '全部状态', value: 'all' },
            { label: '已完成', value: 'done' },
            { label: '生成中', value: 'running' },
            { label: '失败', value: 'error' },
          ]}
          className={selectClass}
        />
      </div>
      {isAdmin && (
        <div className="relative z-20 w-40 flex-shrink-0">
          <Select
            value={filterUserId}
            onChange={(val) => setFilterUserId(val === 'all' ? 'all' : Number(val))}
            options={userFilterOptions}
            className={selectClass}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => setFilterFavorite(!filterFavorite)}
        title={filterFavorite ? '取消只看收藏' : '只看收藏'}
        className={cn(
          'flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition-colors',
          filterFavorite
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'border-border bg-surface text-muted hover:bg-surface-2',
        )}
      >
        <Star className={cn('h-4 w-4', filterFavorite && 'fill-current')} />
        <span className="hidden sm:inline">收藏</span>
      </button>
      <div className="relative z-10 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch()
          }}
          type="text"
          placeholder="搜索提示词、参数..."
          className="pl-10 py-2.5"
        />
      </div>
      <Button onClick={handleSearch} disabled={tasksLoading} className="flex-shrink-0 px-5 py-2.5">
        查询
      </Button>
    </div>
  )
}
