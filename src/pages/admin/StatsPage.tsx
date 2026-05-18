import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { Link } from 'react-router-dom'
import {
  getStatsOverview,
  getTasksTrend,
  getStorageTop,
  getRecentFailures,
  getRecentUsers,
  type StatsOverview,
  type TasksTrendItem,
  type StorageTopItem,
  type RecentFailure,
  type RecentUser,
} from '../../lib/adminApi'
import { useStore } from '../../store'

function formatBytes(n: number) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{hint}</div>}
    </div>
  )
}

const PIE_COLORS = ['#10b981', '#3b82f6', '#ef4444', '#f59e0b']

export default function StatsPage() {
  const showToast = useStore((s) => s.showToast)
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [trend, setTrend] = useState<TasksTrendItem[]>([])
  const [storage, setStorage] = useState<StorageTopItem[]>([])
  const [failures, setFailures] = useState<RecentFailure[]>([])
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([])
  const [trendDays, setTrendDays] = useState(7)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getStatsOverview(),
      getTasksTrend(trendDays),
      getStorageTop(10),
      getRecentFailures(10),
      getRecentUsers(10),
    ])
      .then(([ov, tr, st, fl, ru]) => {
        setOverview(ov)
        setTrend(tr.items)
        setStorage(st.items)
        setFailures(fl.items)
        setRecentUsers(ru.items)
      })
      .catch((err) => showToast(err instanceof Error ? err.message : String(err), 'error'))
      .finally(() => setLoading(false))
  }, [trendDays, showToast])

  if (loading || !overview) {
    return (
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-6 text-center text-gray-500 dark:text-gray-400">
        加载中...
      </div>
    )
  }

  const statusData = [
    { name: '完成', value: overview.tasks.done },
    { name: '运行中', value: overview.tasks.running },
    { name: '失败', value: overview.tasks.error },
  ].filter((d) => d.value > 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="总用户数" value={overview.users.total} hint={`近 7 日新增 ${overview.users.new_7d}`} />
        <StatCard label="近 30 日活跃" value={overview.users.active_30d} hint={`待审核 ${overview.users.pending}`} />
        <StatCard label="总任务数" value={overview.tasks.total} hint={`近 7 日 ${overview.tasks.tasks_7d}`} />
        <StatCard
          label="存储占用"
          value={formatBytes(overview.images.total_bytes)}
          hint={`${overview.images.total} 张图片`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">任务趋势</h3>
            <select
              value={trendDays}
              onChange={(e) => setTrendDays(Number(e.target.value))}
              className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-white/[0.1] bg-white dark:bg-gray-950"
            >
              <option value={7}>近 7 天</option>
              <option value={14}>近 14 天</option>
              <option value={30}>近 30 天</option>
              <option value={90}>近 90 天</option>
            </select>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(125,125,125,0.2)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(255,255,255,0.95)',
                    border: '1px solid rgba(125,125,125,0.3)',
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} name="总数" />
                <Line type="monotone" dataKey="done" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} name="完成" />
                <Line type="monotone" dataKey="error" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} name="失败" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4">
          <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-3">任务状态分布</h3>
          <div className="h-64">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(255,255,255,0.95)',
                      border: '1px solid rgba(125,125,125,0.3)',
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                暂无数据
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4">
          <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-3">存储占用 Top 10</h3>
          {storage.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">暂无数据</div>
          ) : (
            <ul className="space-y-2">
              {storage.map((u) => (
                <li key={u.id} className="flex items-center justify-between text-sm">
                  <Link to={`/admin/users/${u.id}/tasks`} className="flex items-center gap-2 hover:underline">
                    <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                    <span className="text-gray-800 dark:text-gray-100">{u.username}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">({u.image_count} 张)</span>
                  </Link>
                  <span className="tabular-nums text-gray-700 dark:text-gray-300">{formatBytes(u.storage_bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4">
          <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-3">最近注册</h3>
          {recentUsers.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">暂无</div>
          ) : (
            <ul className="space-y-2">
              {recentUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                    <span className="text-gray-800 dark:text-gray-100 truncate">{u.username}</span>
                    {u.status === 'pending' && (
                      <span className="px-1 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                        待审核
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{u.created_at}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-4">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-3">最近失败任务</h3>
        {failures.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">暂无失败任务</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-2 py-1.5 text-left">用户</th>
                <th className="px-2 py-1.5 text-left">提示词</th>
                <th className="px-2 py-1.5 text-left">错误</th>
                <th className="px-2 py-1.5 text-left">Provider/Model</th>
                <th className="px-2 py-1.5 text-left">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
              {failures.map((f) => (
                <tr key={f.id}>
                  <td className="px-2 py-1.5">
                    {f.username && (
                      <Link to={`/admin/users/${f.user_id}/tasks`} className="flex items-center gap-1.5 hover:underline">
                        {f.avatar_url && <img src={f.avatar_url} alt="" className="w-5 h-5 rounded-full" />}
                        <span className="text-gray-800 dark:text-gray-100">{f.username}</span>
                      </Link>
                    )}
                  </td>
                  <td className="px-2 py-1.5 max-w-xs">
                    <div className="text-gray-700 dark:text-gray-300 truncate">{f.prompt}</div>
                  </td>
                  <td className="px-2 py-1.5 max-w-xs">
                    <div className="text-red-600 dark:text-red-400 truncate">{f.error_message || '—'}</div>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {f.api_provider || '—'} / {f.api_model || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {f.created_at}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
