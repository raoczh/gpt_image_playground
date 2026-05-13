import { useEffect, useRef } from 'react'
import { useStore, reuseConfig, editOutputs, removeTask, loadTasksFirstPage, loadMoreTasks } from '../store'
import TaskCard from './TaskCard'

export default function TaskGrid() {
  const tasks = useStore((s) => s.tasks)
  const user = useStore((s) => s.user)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const tasksLoading = useStore((s) => s.tasksLoading)
  const tasksHasMore = useStore((s) => s.tasksHasMore)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  // initStore 已经触发首次加载；这里只在 searchQuery / filterStatus 变化时 debounce reload。
  // 用 ref 跳过首次 effect 避免重复请求。
  const skipFirstRef = useRef(true)
  useEffect(() => {
    if (!user) return
    if (skipFirstRef.current) {
      skipFirstRef.current = false
      return
    }
    const handle = setTimeout(() => {
      loadTasksFirstPage().catch(console.error)
    }, 300)
    return () => clearTimeout(handle)
  }, [user, searchQuery, filterStatus])

  // 滚动到底部时拉下一页
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !tasksHasMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        loadMoreTasks().catch(console.error)
      }
    }, { rootMargin: '300px' })
    io.observe(node)
    return () => io.disconnect()
  }, [tasksHasMore])

  const handleDelete = (task: typeof tasks[0]) => {
    setConfirmDialog({
      title: '删除记录',
      message: '确定要删除这条记录吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  // 后端已按 created_at DESC 排序，前端不再 filter；只在显示时按 createdAt 兜底排序
  // （submitTask unshift 的新任务可能比后端最后一条更新，需要保证它在最前面）
  const sortedTasks = [...tasks].sort((a, b) => b.createdAt - a.createdAt)

  if (!sortedTasks.length) {
    return (
      <div className="text-center py-20 text-gray-400 dark:text-gray-500">
        {tasksLoading ? (
          <p className="text-sm">加载中...</p>
        ) : searchQuery || filterStatus !== 'all' ? (
          <p className="text-sm">没有找到匹配的记录</p>
        ) : (
          <>
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-200 dark:text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm">输入提示词开始生成图片</p>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={() => setDetailTaskId(task.id)}
            onReuse={() => reuseConfig(task)}
            onEditOutputs={() => editOutputs(task)}
            onDelete={() => handleDelete(task)}
          />
        ))}
      </div>
      {/* 底部 sentinel + 加载指示 */}
      {tasksHasMore && (
        <div ref={sentinelRef} className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">
          {tasksLoading ? '加载中...' : '滚动加载更多'}
        </div>
      )}
      {!tasksHasMore && tasks.length > 0 && (
        <div className="py-6 text-center text-xs text-gray-300 dark:text-gray-600">没有更多了</div>
      )}
    </>
  )
}
