import { useEffect, useRef } from 'react'
import { LayoutGrid, List, Images } from 'lucide-react'
import { useStore, reuseConfig, editOutputs, removeTask, loadMoreTasks } from '../store'
import { cn } from '../lib/cn'
import Button from './ui/Button'
import TaskCard from './TaskCard'
import TaskList from './TaskList'

export default function TaskGrid() {
  const tasks = useStore((s) => s.tasks)
  const user = useStore((s) => s.user)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
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

  // 后端已按 created_at DESC 排序，前端只在显示时按 createdAt 兜底排序
  const sortedTasks = [...tasks].sort((a, b) => b.createdAt - a.createdAt)

  if (!sortedTasks.length) {
    return (
      <div className="py-20 text-center text-subtle">
        {tasksLoading ? (
          <p className="text-sm">加载中...</p>
        ) : searchQuery || filterStatus !== 'all' || filterFavorite ? (
          <p className="text-sm">没有找到匹配的记录</p>
        ) : (
          <>
            <Images className="mx-auto mb-4 h-16 w-16 text-border-strong" strokeWidth={1} />
            <p className="text-sm">输入提示词开始生成图片</p>
          </>
        )}
      </div>
    )
  }

  const segmentBtn = (mode: 'grid' | 'list', label: string, Icon: typeof LayoutGrid, withDivider: boolean) => (
    <button
      type="button"
      onClick={() => setViewMode(mode)}
      title={mode === 'grid' ? '宫格视图' : '列表视图'}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors',
        withDivider && 'border-l border-border',
        viewMode === mode ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surface-2',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )

  return (
    <>
      {/* 多选工具栏 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        {selectionMode ? (
          <>
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="font-medium text-foreground">已选 {selectedTaskIds.size}</span>
              <button
                type="button"
                onClick={() => selectLoadedTasks()}
                className="text-xs text-primary hover:text-primary/80"
                title="选中当前已加载的记录，向下滚动加载更多后可继续选"
              >全选已加载</button>
              <button
                type="button"
                onClick={() => clearTaskSelection()}
                className="text-xs text-muted hover:text-foreground"
              >清空</button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={selectedTaskIds.size === 0}
                onClick={() =>
                  setConfirmDialog({
                    title: '批量删除',
                    message: `确定要删除选中的 ${selectedTaskIds.size} 条记录吗？相关图片资源也会被清理。`,
                    action: () => { batchDeleteSelected().catch(console.error) },
                  })
                }
              >删除选中</Button>
              <Button variant="subtle" size="sm" onClick={() => setSelectionMode(false)}>退出选择</Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-xs text-subtle">{tasks.length > 0 ? `${tasks.length} 条记录` : ''}</span>
            <div className="flex items-center gap-2">
              {/* 视图样式切换 */}
              <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface">
                {segmentBtn('grid', '宫格', LayoutGrid, false)}
                {segmentBtn('list', '列表', List, true)}
              </div>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setSelectionMode(true)}
                disabled={tasks.length === 0}
              >多选</Button>
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
        <div ref={sentinelRef} className="py-6 text-center text-xs text-subtle">
          {tasksLoading ? '加载中...' : '滚动加载更多'}
        </div>
      )}
      {!tasksHasMore && tasks.length > 0 && (
        <div className="py-6 text-center text-xs text-border-strong">没有更多了</div>
      )}
    </>
  )
}
