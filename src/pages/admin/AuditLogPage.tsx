import { useEffect, useState, useCallback } from 'react'
import { listAuditLog, type AuditLogEntry } from '../../lib/adminApi'
import { useStore } from '../../store'

const PAGE_SIZE = 50

const ACTION_LABELS: Record<string, string> = {
  'user.update_role': '修改角色',
  'user.update_status': '修改状态',
  'user.approve': '审核通过',
  'user.delete': '删除用户',
  'user.force_logout': '强制下线',
  'quota.override': '覆写配额',
  'user_settings.update': '修改用户设置',
  'profile.create': '创建 Profile',
  'profile.update': '更新 Profile',
  'profile.delete': '删除 Profile',
  'custom_provider.create': '创建 Custom Provider',
  'custom_provider.update': '更新 Custom Provider',
  'custom_provider.delete': '删除 Custom Provider',
  'task.delete_other_user': '删除他人任务',
  'task.update_other_user': '修改他人任务',
  'task.batch_delete_other_user': '批量删除他人任务',
  'image.delete_other_user': '删除他人图片',
  'allowlist.add': '添加白名单',
  'allowlist.remove': '移除白名单',
  'config.update': '修改系统配置',
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

export default function AuditLogPage() {
  const showToast = useStore((s) => s.showToast)
  const [items, setItems] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [actionFilter, setActionFilter] = useState('')
  const [actorIdFilter, setActorIdFilter] = useState('')
  const [targetTypeFilter, setTargetTypeFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await listAuditLog({
        action: actionFilter || undefined,
        actor_id: actorIdFilter ? Number(actorIdFilter) : undefined,
        target_type: targetTypeFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(page.items)
      setTotal(page.total)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [actionFilter, actorIdFilter, targetTypeFilter, offset, showToast])

  useEffect(() => {
    load()
  }, [load])

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">动作</label>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value)
                setOffset(0)
              }}
              className="form-input min-w-[180px]"
            >
              <option value="">全部</option>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">操作者 ID</label>
            <input
              type="number"
              value={actorIdFilter}
              onChange={(e) => setActorIdFilter(e.target.value)}
              className="form-input w-24"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">目标类型</label>
            <select
              value={targetTypeFilter}
              onChange={(e) => {
                setTargetTypeFilter(e.target.value)
                setOffset(0)
              }}
              className="form-input min-w-[140px]"
            >
              <option value="">全部</option>
              <option value="user">user</option>
              <option value="user_settings">user_settings</option>
              <option value="api_profile">api_profile</option>
              <option value="custom_provider">custom_provider</option>
              <option value="task">task</option>
              <option value="image">image</option>
              <option value="allowlist">allowlist</option>
              <option value="config">config</option>
            </select>
          </div>
          <button
            onClick={() => {
              setOffset(0)
              load()
            }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            搜索
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">操作者</th>
              <th className="px-3 py-2 text-left">动作</th>
              <th className="px-3 py-2 text-left">目标</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-right">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
            {loading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">加载中...</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">暂无审计记录</td></tr>
            )}
            {items.map((it) => {
              const isOpen = expanded.has(it.id)
              return (
                <>
                  <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(it.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {it.actor_avatar && <img src={it.actor_avatar} alt="" className="w-5 h-5 rounded-full" />}
                        <span className="text-gray-800 dark:text-gray-100">{it.actor_username || `#${it.actor_id}`}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-gray-700 dark:text-gray-300">{ACTION_LABELS[it.action] || it.action}</span>
                      <div className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{it.action}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                      {it.target_type ? `${it.target_type} #${it.target_id || '—'}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500 dark:text-gray-400">{it.ip || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {(it.before_value || it.after_value) ? (
                        <button
                          onClick={() => toggleExpand(it.id)}
                          className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                        >
                          {isOpen ? '收起' : '展开'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${it.id}-detail`} className="bg-gray-50 dark:bg-gray-900/30">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <div className="text-gray-500 dark:text-gray-400 mb-1">变更前</div>
                            <pre className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-white/[0.08] rounded p-2 overflow-x-auto font-mono text-gray-700 dark:text-gray-300 max-h-60">
{it.before_value ? JSON.stringify(it.before_value, null, 2) : '(无)'}
                            </pre>
                          </div>
                          <div>
                            <div className="text-gray-500 dark:text-gray-400 mb-1">变更后</div>
                            <pre className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-white/[0.08] rounded p-2 overflow-x-auto font-mono text-gray-700 dark:text-gray-300 max-h-60">
{it.after_value ? JSON.stringify(it.after_value, null, 2) : '(无)'}
                            </pre>
                          </div>
                        </div>
                        {it.ua && (
                          <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500 font-mono break-all">
                            UA: {it.ua}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>

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
    </div>
  )
}
