import { useEffect, useState } from 'react'
import type { TaskRecord } from '../types'
import { useStore } from '../store'
import { getParamBadges } from '../lib/paramDisplay'

interface Props {
  tasks: TaskRecord[]
  showOwner: boolean
  selectionMode: boolean
  selectedIds: Set<string>
  onClickTask: (task: TaskRecord) => void
  onReuse: (task: TaskRecord) => void
  onEditOutputs: (task: TaskRecord) => void
  onDelete: (task: TaskRecord) => void
  onToggleSelect: (task: TaskRecord) => void
}

const statusLabel: Record<string, { text: string; cls: string }> = {
  running: { text: '运行中', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  done: { text: '完成', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  error: { text: '失败', cls: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
}

function formatDate(ts: number | null | undefined) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null) return '—'
  const sec = Math.floor(ms / 1000)
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function TaskList({
  tasks,
  showOwner,
  selectionMode,
  selectedIds,
  onClickTask,
  onReuse,
  onEditOutputs,
  onDelete,
  onToggleSelect,
}: Props) {
  const toggleTaskFavorite = useStore((s) => s.toggleTaskFavorite)
  const [now, setNow] = useState(Date.now())

  const hasRunning = tasks.some((t) => t.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasRunning])

  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400">
            <tr>
              {selectionMode && <th className="px-3 py-2 w-8"></th>}
              <th className="px-3 py-2 text-left w-20">缩略图</th>
              <th className="px-3 py-2 text-left">提示词</th>
              {showOwner && <th className="px-3 py-2 text-left whitespace-nowrap">操作人</th>}
              <th className="px-3 py-2 text-left whitespace-nowrap">状态</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">参数</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">输入/输出</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">耗时</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">创建时间</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
            {tasks.map((task) => {
              const sl = statusLabel[task.status] || { text: task.status, cls: 'bg-gray-100 text-gray-700' }
              const thumb = task.outputThumbnails?.[0] || task.outputImages?.[0] || task.inputThumbnails?.[0] || task.inputImageUrls?.[0] || ''
              const elapsed = task.status === 'running' ? now - task.createdAt : task.elapsed
              const badges = getParamBadges(task.params, task.actualParams).slice(0, 4)
              const selected = selectedIds.has(task.id)
              return (
                <tr
                  key={task.id}
                  onClick={() => (selectionMode ? onToggleSelect(task) : onClickTask(task))}
                  className={`cursor-pointer transition ${
                    selected
                      ? 'bg-blue-50/60 dark:bg-blue-500/10'
                      : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                  } ${task.status === 'running' ? 'border-l-2 border-blue-400' : ''}`}
                >
                  {selectionMode && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div
                        onClick={() => onToggleSelect(task)}
                        className={`w-4 h-4 rounded flex items-center justify-center cursor-pointer transition-colors ${
                          selected
                            ? 'bg-blue-500 text-white'
                            : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-white/20'
                        }`}
                      >
                        {selected && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-12 h-12 object-cover rounded" loading="lazy" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">
                        {task.status === 'running' ? '...' : '—'}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-md">
                    <div className="text-gray-800 dark:text-gray-100 line-clamp-2">{task.prompt || '(无提示词)'}</div>
                    {task.error && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5 line-clamp-1">{task.error}</div>
                    )}
                  </td>
                  {showOwner && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      {task.owner ? (
                        <div className="flex items-center gap-1.5">
                          {task.owner.avatar_url && (
                            <img src={task.owner.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                          )}
                          <span className="text-xs text-gray-700 dark:text-gray-300">{task.owner.username}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${sl.cls}`}>{sl.text}</span>
                    {task.isFavorite ? <span className="ml-1 text-amber-500">★</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {badges.map((badge) => (
                        <span
                          key={badge.key}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            badge.mismatched
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                              : 'bg-gray-100 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {badge.mismatched ? `${badge.requested} → ${badge.actual}` : badge.requested}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    {task.inputImageIds?.length || 0} / {task.outputImages?.length || 0}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap font-mono">
                    {formatDuration(elapsed)}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatDate(task.createdAt)}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => toggleTaskFavorite(task.id).catch(() => {})}
                        className={`p-1.5 rounded-md transition ${
                          task.isFavorite
                            ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                            : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                        }`}
                        title={task.isFavorite ? '取消收藏' : '收藏'}
                      >
                        <svg className="w-4 h-4" fill={task.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.077 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.673z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => onReuse(task)}
                        className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-400 hover:text-blue-500 transition"
                        title="复用配置"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      </button>
                      <button
                        onClick={() => onEditOutputs(task)}
                        className="p-1.5 rounded-md hover:bg-green-50 dark:hover:bg-green-950/30 text-gray-400 hover:text-green-500 transition disabled:opacity-30"
                        title="编辑输出"
                        disabled={!task.outputImages?.length}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => onDelete(task)}
                        className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500 transition"
                        title="删除记录"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
