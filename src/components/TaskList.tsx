import { useEffect, useState } from 'react'
import { Check, Star } from 'lucide-react'
import type { TaskRecord } from '../types'
import { useStore } from '../store'
import { getParamBadges } from '../lib/paramDisplay'
import { cn } from '../lib/cn'
import ParamBadge from './ui/ParamBadge'
import StatusBadge from './ui/StatusBadge'
import TaskActions from './ui/TaskActions'

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
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              {selectionMode && <th className="w-8 px-3 py-2"></th>}
              <th className="w-20 px-3 py-2 text-left">缩略图</th>
              <th className="px-3 py-2 text-left">提示词</th>
              {showOwner && <th className="whitespace-nowrap px-3 py-2 text-left">操作人</th>}
              <th className="whitespace-nowrap px-3 py-2 text-left">状态</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">参数</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">输入/输出</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">耗时</th>
              <th className="whitespace-nowrap px-3 py-2 text-left">创建时间</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tasks.map((task) => {
              const thumb =
                task.outputThumbnails?.[0] ||
                task.outputImages?.[0] ||
                task.inputThumbnails?.[0] ||
                task.inputImageUrls?.[0] ||
                ''
              const elapsed = task.status === 'running' ? now - task.createdAt : task.elapsed
              const badges = getParamBadges(task.params, task.actualParams).slice(0, 4)
              const selected = selectedIds.has(task.id)
              return (
                <tr
                  key={task.id}
                  onClick={() => (selectionMode ? onToggleSelect(task) : onClickTask(task))}
                  className={cn(
                    'cursor-pointer transition-colors',
                    selected ? 'bg-primary/10' : 'hover:bg-surface-2',
                    task.status === 'running' && 'border-l-2 border-primary',
                  )}
                >
                  {selectionMode && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div
                        onClick={() => onToggleSelect(task)}
                        className={cn(
                          'flex h-4 w-4 cursor-pointer items-center justify-center rounded transition-colors',
                          selected
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border-strong bg-surface',
                        )}
                      >
                        {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-12 w-12 rounded object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded bg-surface-2 text-xs text-subtle">
                        {task.status === 'running' ? '...' : '—'}
                      </div>
                    )}
                  </td>
                  <td className="max-w-md px-3 py-2">
                    <div className="line-clamp-2 text-foreground">{task.prompt || '(无提示词)'}</div>
                    {task.error && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-danger">{task.error}</div>
                    )}
                  </td>
                  {showOwner && (
                    <td className="whitespace-nowrap px-3 py-2">
                      {task.owner ? (
                        <div className="flex items-center gap-1.5">
                          {task.owner.avatar_url && (
                            <img src={task.owner.avatar_url} alt="" className="h-5 w-5 rounded-full" />
                          )}
                          <span className="text-xs text-muted">{task.owner.username}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-subtle">—</span>
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={task.status} />
                      {task.isFavorite && <Star className="h-3 w-3 fill-warning text-warning" />}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {badges.map((badge) => (
                        <ParamBadge key={badge.key} badge={badge} className="text-[10px]" />
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">
                    {task.inputImageIds?.length || 0} / {task.outputImages?.length || 0}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-muted">
                    {formatDuration(elapsed)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDate(task.createdAt)}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end">
                      <TaskActions
                        isFavorite={task.isFavorite}
                        onToggleFavorite={() => toggleTaskFavorite(task.id).catch(() => {})}
                        onReuse={() => onReuse(task)}
                        onEditOutputs={() => onEditOutputs(task)}
                        onDelete={() => onDelete(task)}
                        canEdit={!!task.outputImages?.length}
                        size="sm"
                      />
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
