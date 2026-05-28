import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import * as backendApi from '../../lib/backendApi'
import { getUser, type AdminUser } from '../../lib/adminApi'
import { useStore } from '../../store'

const PAGE_SIZE = 30

function formatDate(s: string | number | null | undefined) {
  if (!s) return '—'
  try {
    const d = new Date(typeof s === 'number' ? s : s)
    if (Number.isNaN(d.getTime())) return String(s)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(s)
  }
}

const statusLabel: Record<string, { text: string; cls: string }> = {
  running: { text: '运行中', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  done: { text: '完成', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  error: { text: '失败', cls: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
}

export default function UserTasksPage() {
  const { id } = useParams<{ id: string }>()
  const userId = Number(id)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const [user, setUser] = useState<AdminUser | null>(null)
  const [tasks, setTasks] = useState<backendApi.Task[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'done' | 'error'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!userId) return
    getUser(userId)
      .then(setUser)
      .catch((err) => showToast(err instanceof Error ? err.message : String(err), 'error'))
  }, [userId, showToast])

  const loadFirst = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const page = await backendApi.getTasks({
        userId,
        q: q.trim() || undefined,
        status: statusFilter,
        favorite: favoriteOnly,
        limit: PAGE_SIZE,
      })
      setTasks(page.items)
      setCursor(page.nextCursor)
      setHasMore(!!page.nextCursor)
      setSelected(new Set())
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [userId, q, statusFilter, favoriteOnly, showToast])

  useEffect(() => {
    loadFirst()
  }, [loadFirst])

  const loadMore = async () => {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const page = await backendApi.getTasks({
        userId,
        cursor,
        q: q.trim() || undefined,
        status: statusFilter,
        favorite: favoriteOnly,
        limit: PAGE_SIZE,
      })
      setTasks((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
      setHasMore(!!page.nextCursor)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleFavorite = async (task: backendApi.Task) => {
    const nextValue = !task.is_favorite
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, is_favorite: nextValue } : t)))
    try {
      await backendApi.setTaskFavorite(task.id, nextValue)
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, is_favorite: !nextValue } : t)))
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const handleDelete = (task: backendApi.Task) => {
    setConfirmDialog({
      title: '删除任务',
      message: `删除该任务？该任务的关联图片若不再被引用也会被软删除。`,
      confirmText: '删除',
      tone: 'danger',
      action: async () => {
        try {
          await backendApi.deleteTask(task.id)
          setTasks((prev) => prev.filter((t) => t.id !== task.id))
          showToast('已删除', 'success')
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  const handleBatchDelete = () => {
    const ids = Array.from(selected)
    if (!ids.length) return
    setConfirmDialog({
      title: '批量删除',
      message: `删除选中的 ${ids.length} 条任务？`,
      confirmText: `全部删除`,
      tone: 'danger',
      action: async () => {
        try {
          await backendApi.batchDeleteTasks(ids)
          setTasks((prev) => prev.filter((t) => !selected.has(t.id)))
          setSelected(new Set())
          showToast(`已删除 ${ids.length} 条`, 'success')
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = tasks.length > 0 && selected.size === tasks.length
  const someSelected = selected.size > 0 && selected.size < tasks.length

  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(tasks.map((t) => t.id)))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/admin/users" className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
          ← 用户列表
        </Link>
        {user && (
          <div className="flex items-center gap-2">
            <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{user.username}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">的任务</span>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">提示词搜索</label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadFirst()}
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">状态</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="form-input"
            >
              <option value="all">全部</option>
              <option value="running">运行中</option>
              <option value="done">完成</option>
              <option value="error">失败</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2">
            <input
              type="checkbox"
              checked={favoriteOnly}
              onChange={(e) => setFavoriteOnly(e.target.checked)}
            />
            仅收藏
          </label>
          <button
            onClick={loadFirst}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            搜索
          </button>
          {selected.size > 0 && (
            <button
              onClick={handleBatchDelete}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
            >
              批量删除 ({selected.size})
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={toggleSelectAll}
                    disabled={tasks.length === 0}
                    aria-label={allSelected ? '取消全选' : '全选当前页'}
                    title={allSelected ? '取消全选' : '全选当前页'}
                  />
                </th>
                <th className="px-3 py-2 text-left">缩略图</th>
                <th className="px-3 py-2 text-left">提示词</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-right">输入/输出</th>
                <th className="px-3 py-2 text-left">Profile</th>
                <th className="px-3 py-2 text-left">创建时间</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
              {loading && tasks.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">加载中...</td></tr>
              )}
              {!loading && tasks.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">暂无任务</td></tr>
              )}
              {tasks.map((t) => {
                const sl = statusLabel[t.status] || { text: t.status, cls: 'bg-gray-100 text-gray-700' }
                const thumb = t.output_thumb_urls?.[0] || t.input_thumb_urls?.[0] || ''
                return (
                  <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-12 h-12 object-cover rounded" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">
                          {t.status === 'running' ? '...' : '—'}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <div className="text-gray-800 dark:text-gray-100 line-clamp-2">{t.prompt}</div>
                      {t.error_message && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-0.5 line-clamp-1">{t.error_message}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${sl.cls}`}>{sl.text}</span>
                      {t.is_favorite ? <span className="ml-1 text-amber-500">★</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {t.input_image_ids?.length || 0} / {t.output_image_ids?.length || 0}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {t.api_profile_name || '—'}
                      <div className="text-[10px]">{t.api_model || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(t.started_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => handleToggleFavorite(t)}
                          className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                        >
                          {t.is_favorite ? '取消收藏' : '收藏'}
                        </button>
                        <button
                          onClick={() => handleDelete(t)}
                          className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="p-3 border-t border-gray-200 dark:border-white/[0.08] text-center">
            <button
              onClick={loadMore}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              {loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
