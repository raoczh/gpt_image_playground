import { useEffect, useRef } from 'react'
import { useStore, reuseConfig, editOutputs, removeTask, loadTasksFirstPage, loadMoreTasks } from '../store'
import TaskCard from './TaskCard'
import TaskList from './TaskList'

export default function TaskGrid() {
  const tasks = useStore((s) => s.tasks)
  const user = useStore((s) => s.user)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterUserId = useStore((s) => s.filterUserId)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const tasksLoading = useStore((s) => s.tasksLoading)
  const tasksHasMore = useStore((s) => s.tasksHasMore)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectionMode = useStore((s) => s.selectionMode)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectionMode = useStore((s) => s.setSelectionMode)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const selectLoadedTasks = useStore((s) => s.selectLoadedTasks)
  const clearTaskSelection = useStore((s) => s.clearTaskSelection)
  const batchDeleteSelected = useStore((s) => s.batchDeleteSelected)

  const isAdmin = user?.role === 'admin'
  const showOwner = isAdmin

  // initStore 已经触发首次加载；这里只在 searchQuery / filterStatus / filterFavorite / filterUserId 变化时 debounce reload。
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
  }, [user, searchQuery, filterStatus, filterFavorite, filterUserId])

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
        ) : searchQuery || filterStatus !== 'all' || filterFavorite ? (
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
      {/* 多选工具栏 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        {selectionMode ? (
          <>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">已选 {selectedTaskIds.size}</span>
              <button
                type="button"
                onClick={() => selectLoadedTasks()}
                className="text-xs text-blue-500 hover:text-blue-600"
                title="选中当前已加载的记录，向下滚动加载更多后可继续选"
              >全选已加载</button>
              <button
                type="button"
                onClick={() => clearTaskSelection()}
                className="text-xs text-gray-500 hover:text-gray-700"
              >清空</button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedTaskIds.size === 0}
                onClick={() =>
                  setConfirmDialog({
                    title: '批量删除',
                    message: `确定要删除选中的 ${selectedTaskIds.size} 条记录吗？相关图片资源也会被清理。`,
                    action: () => { batchDeleteSelected().catch(console.error) },
                  })
                }
                className="px-3 py-1.5 rounded-lg text-xs bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >删除选中</button>
              <button
                type="button"
                onClick={() => setSelectionMode(false)}
                className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition"
              >退出选择</button>
            </div>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-400 dark:text-gray-500">{tasks.length > 0 ? `${tasks.length} 条记录` : ''}</span>
            <div className="flex items-center gap-2">
              {/* 视图样式切换 */}
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="宫格视图"
                  className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition ${
                    viewMode === 'grid'
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  <span className="hidden sm:inline">宫格</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  title="列表视图"
                  className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition border-l border-gray-200 dark:border-white/[0.08] ${
                    viewMode === 'list'
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                  <span className="hidden sm:inline">列表</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectionMode(true)}
                disabled={tasks.length === 0}
                className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] disabled:opacity-40 transition"
              >多选</button>
            </div>
          </>
        )}
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              showOwner={showOwner}
              onClick={() => setDetailTaskId(task.id)}
              onReuse={() => reuseConfig(task)}
              onEditOutputs={() => editOutputs(task)}
              onDelete={() => handleDelete(task)}
              selectionMode={selectionMode}
              selected={selectedTaskIds.has(task.id)}
              onToggleSelect={() => toggleTaskSelection(task.id)}
            />
          ))}
        </div>
      ) : (
        <TaskList
          tasks={sortedTasks}
          showOwner={showOwner}
          selectionMode={selectionMode}
          selectedIds={selectedTaskIds}
          onClickTask={(t) => setDetailTaskId(t.id)}
          onReuse={(t) => reuseConfig(t)}
          onEditOutputs={(t) => editOutputs(t)}
          onDelete={(t) => handleDelete(t)}
          onToggleSelect={(t) => toggleTaskSelection(t.id)}
        />
      )}
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
