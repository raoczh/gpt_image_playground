import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  listUsers,
  approveUser,
  updateUser,
  deleteUser,
  forceLogoutUser,
  type AdminUser,
} from '../../lib/adminApi'
import { useStore } from '../../store'
import UserDetailDrawer from './UserDetailDrawer'

const PAGE_SIZE = 50

function formatBytes(n: number) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(s: string | null) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return s
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return s
  }
}

const statusLabel: Record<AdminUser['status'], { text: string; cls: string }> = {
  active: { text: '正常', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  pending: { text: '待审核', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  disabled: { text: '已禁用', cls: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
}

export default function UsersPage() {
  const me = useStore((s) => s.user)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | AdminUser['status']>('')
  const [roleFilter, setRoleFilter] = useState<'' | 'user' | 'admin'>('')
  const [drawerUserId, setDrawerUserId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await listUsers({
        q: q.trim() || undefined,
        status: statusFilter || undefined,
        role: roleFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setUsers(page.items)
      setTotal(page.total)
    } catch (err) {
      showToast(`加载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [q, statusFilter, roleFilter, offset, showToast])

  useEffect(() => {
    load()
  }, [load])

  const reload = () => load()

  const handleToggleStatus = async (u: AdminUser) => {
    if (u.id === me?.id) {
      showToast('不能修改自己的状态', 'error')
      return
    }
    const next = u.status === 'active' ? 'disabled' : 'active'
    try {
      await updateUser(u.id, { status: next })
      showToast(next === 'active' ? '已启用' : '已禁用', 'success')
      reload()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const handleApprove = async (u: AdminUser) => {
    try {
      await approveUser(u.id)
      showToast('审核通过', 'success')
      reload()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const handleToggleRole = async (u: AdminUser) => {
    if (u.id === me?.id) {
      showToast('不能修改自己的角色', 'error')
      return
    }
    const next = u.role === 'admin' ? 'user' : 'admin'
    try {
      await updateUser(u.id, { role: next })
      showToast(next === 'admin' ? '已提升为管理员' : '已降级为普通用户', 'success')
      reload()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const handleDelete = (u: AdminUser) => {
    if (u.id === me?.id) {
      showToast('不能删除自己', 'error')
      return
    }
    setConfirmDialog({
      title: '删除用户',
      message: `确定删除用户 ${u.username}？该用户的全部任务和图片将被软删除。`,
      confirmText: '删除用户',
      tone: 'danger',
      action: async () => {
        try {
          await deleteUser(u.id)
          showToast('已删除', 'success')
          reload()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  const handleForceLogout = (u: AdminUser) => {
    setConfirmDialog({
      title: '强制下线',
      message: `强制下线 ${u.username} 的所有会话？`,
      confirmText: '强制下线',
      tone: 'warning',
      action: async () => {
        try {
          await forceLogoutUser(u.id)
          showToast('已强制下线', 'success')
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">搜索</label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setOffset(0)
                  load()
                }
              }}
              placeholder="用户名 / 邮箱 / GitHub ID"
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">状态</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as typeof statusFilter)
                setOffset(0)
              }}
              className="form-input min-w-[120px]"
            >
              <option value="">全部</option>
              <option value="active">正常</option>
              <option value="pending">待审核</option>
              <option value="disabled">已禁用</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">角色</label>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as typeof roleFilter)
                setOffset(0)
              }}
              className="form-input min-w-[120px]"
            >
              <option value="">全部</option>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <button
            onClick={() => {
              setOffset(0)
              load()
            }}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
          >
            {loading && (
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            搜索
          </button>
          {(q || statusFilter || roleFilter) && (
            <button
              onClick={() => {
                setQ('')
                setStatusFilter('')
                setRoleFilter('')
                setOffset(0)
              }}
              className="px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              重置
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">用户</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">角色</th>
                <th className="px-3 py-2 text-right">任务</th>
                <th className="px-3 py-2 text-right">图片</th>
                <th className="px-3 py-2 text-right">占用</th>
                <th className="px-3 py-2 text-left">最近登录</th>
                <th className="px-3 py-2 text-left">注册</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">加载中...</td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">没有符合条件的用户</td>
                </tr>
              )}
              {!loading && users.map((u) => {
                const sl = statusLabel[u.status]
                const isSelf = u.id === me?.id
                return (
                  <tr
                    key={u.id}
                    className={`transition-colors ${
                      isSelf
                        ? 'bg-amber-50/50 dark:bg-amber-500/[0.06] hover:bg-amber-50 dark:hover:bg-amber-500/10'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-900/50'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setDrawerUserId(u.id)}
                        className="flex items-center gap-2 text-left group"
                      >
                        <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                        <div>
                          <div className="font-medium text-gray-800 dark:text-gray-100 group-hover:underline flex items-center gap-1.5">
                            {u.username}
                            {isSelf && (
                              <span className="px-1 py-px text-[10px] rounded bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                                你
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{u.email || `id:${u.github_id}`}</div>
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${sl.cls}`}>{sl.text}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${u.role === 'admin' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{u.role === 'admin' ? '管理员' : '用户'}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Link
                        to={`/admin/users/${u.id}/tasks`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {u.task_count}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{u.image_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatBytes(u.storage_bytes)}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(u.last_login_at)}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(u.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1 flex-wrap items-center">
                        {u.status === 'pending' && (
                          <button
                            onClick={() => handleApprove(u)}
                            className="px-2 py-0.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                          >
                            通过
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleStatus(u)}
                          disabled={isSelf}
                          title={isSelf ? '不能修改自己的状态' : ''}
                          className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {u.status === 'active' ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => handleToggleRole(u)}
                          disabled={isSelf}
                          title={isSelf ? '不能修改自己的角色' : ''}
                          className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {u.role === 'admin' ? '降级' : '提升'}
                        </button>
                        <button
                          onClick={() => handleForceLogout(u)}
                          className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                        >
                          下线
                        </button>
                        <span className="w-px h-4 bg-gray-200 dark:bg-white/[0.08] mx-0.5" aria-hidden />
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={isSelf}
                          title={isSelf ? '不能删除自己' : ''}
                          className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 dark:border-white/[0.08] text-sm">
          <div className="text-gray-500 dark:text-gray-400">
            共 {total} 条 · 第 {currentPage} / {totalPages} 页
          </div>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {drawerUserId !== null && (
        <UserDetailDrawer
          userId={drawerUserId}
          onClose={() => setDrawerUserId(null)}
          onUpdated={reload}
        />
      )}
    </div>
  )
}
