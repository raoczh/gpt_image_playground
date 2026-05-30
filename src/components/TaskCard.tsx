import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Image as ImageIcon, Clock, Check } from 'lucide-react'
import type { TaskRecord } from '../types'
import { useStore } from '../store'
import { formatImageRatio } from '../lib/size'
import { getParamBadges } from '../lib/paramDisplay'
import { cn } from '../lib/cn'
import ParamBadge from './ui/ParamBadge'
import TaskActions from './ui/TaskActions'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onClick: () => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  showOwner?: boolean
}

export default function TaskCard({
  task,
  onReuse,
  onEditOutputs,
  onDelete,
  onClick,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  showOwner = false,
}: Props) {
  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [coverRatio, setCoverRatio] = useState<string>('')
  const [coverSize, setCoverSize] = useState<string>('')
  const [now, setNow] = useState(Date.now())
  const toggleTaskFavorite = useStore((s) => s.toggleTaskFavorite)

  // 定时更新运行中任务的计时
  useEffect(() => {
    if (task.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [task.status])

  // 加载缩略图
  useEffect(() => {
    setThumbSrc('')
    setCoverRatio('')
    setCoverSize('')

    const src = task.outputThumbnails?.[0] || task.outputImages?.[0]
    if (src) {
      setThumbSrc(src)
    }

    // 后端返回的实际尺寸（保存时用 sharp 写入 images.width/height）
    const dim = task.outputImageDims?.[0]
    if (dim && dim.w > 0 && dim.h > 0) {
      setCoverRatio(formatImageRatio(dim.w, dim.h))
      setCoverSize(`${dim.w}×${dim.h}`)
    }
  }, [task.outputThumbnails, task.outputImages, task.outputImageDims])

  useEffect(() => {
    if (!thumbSrc) return
    // 后端已经给了真实尺寸就不必再加载图片测量；旧数据 fallback 到测量缩略图
    if (task.outputImageDims?.[0]) return

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setCoverRatio(formatImageRatio(image.naturalWidth, image.naturalHeight))
        setCoverSize(`${image.naturalWidth}×${image.naturalHeight}`)
      }
    }
    image.src = thumbSrc
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      setCoverRatio(formatImageRatio(image.naturalWidth, image.naturalHeight))
      setCoverSize(`${image.naturalWidth}×${image.naturalHeight}`)
    }

    return () => {
      cancelled = true
    }
  }, [thumbSrc, task.outputImageDims])

  const duration = (() => {
    let seconds: number
    if (task.status === 'running') {
      seconds = Math.floor((now - task.createdAt) / 1000)
    } else if (task.elapsed != null) {
      seconds = Math.floor(task.elapsed / 1000)
    } else {
      return '00:00'
    }
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  })()

  return (
    <div
      className={cn(
        'bg-surface rounded-xl border overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg relative',
        selectionMode && selected
          ? 'border-primary ring-2 ring-primary/40'
          : task.status === 'running'
            ? 'border-primary'
            : 'border-border',
      )}
      onClick={selectionMode ? onToggleSelect : onClick}
    >
      {selectionMode && (
        <div className="absolute top-2 left-2 z-20 pointer-events-none">
          <div
            className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center transition-colors',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface/90 border border-border-strong',
            )}
          >
            {selected && <Check className="w-3 h-3" strokeWidth={3} />}
          </div>
        </div>
      )}
      <div className="flex h-40">
        {/* 左侧图片区域 */}
        <div className="w-40 min-w-[10rem] h-full bg-surface-2 relative flex items-center justify-center overflow-hidden flex-shrink-0">
          {task.status === 'running' && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <span className="text-xs text-subtle">生成中...</span>
            </div>
          )}
          {task.status === 'error' && (
            <div className="flex flex-col items-center gap-1 px-2">
              <AlertCircle className="w-7 h-7 text-danger" />
              <span className="text-xs text-danger text-center leading-tight">
                失败
              </span>
            </div>
          )}
          {task.status === 'done' && thumbSrc && (
            <>
              <img
                src={thumbSrc}
                data-original-src={task.outputImages?.[0] || ''}
                className="saveable-image w-full h-full object-cover"
                loading="lazy"
                alt=""
              />
              {task.outputImages.length > 1 && (
                <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                  {task.outputImages.length}
                </span>
              )}
            </>
          )}
          {task.status === 'done' && !thumbSrc && (
            <ImageIcon className="w-8 h-8 text-subtle" strokeWidth={1.5} />
          )}
          {showOwner && task.owner && (
            <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/55 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm max-w-[110px]" title={`操作人：${task.owner.username}`}>
              {task.owner.avatar_url ? (
                <img src={task.owner.avatar_url} alt="" className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
              ) : null}
              <span className="truncate">{task.owner.username}</span>
            </div>
          )}
          {/* 运行中显示耗时，完成后显示封面图比例与分辨率标签 */}
          <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
            {task.status !== 'done' || !coverRatio || !coverSize ? (
              <span className="flex items-center gap-1 bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                <Clock className="w-3 h-3" />
                {duration}
              </span>
            ) : (
              <>
                <span className="bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                  {coverRatio}
                </span>
                <span className="bg-black/50 text-white/90 text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-medium">
                  {coverSize}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 右侧信息区域 */}
        <div className="flex-1 p-3 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 mb-2">
            <p className="text-sm text-foreground leading-relaxed line-clamp-3">
              {task.prompt || '(无提示词)'}
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-1.5">
            {/* 参数：横向滚动；API 实际值与请求不一致时高亮 */}
            <div className="flex overflow-x-auto hide-scrollbar gap-1.5 whitespace-nowrap mask-edge-r min-w-0 pr-2">
              {getParamBadges(task.params, task.actualParams).map((badge) => (
                <ParamBadge key={badge.key} badge={badge} className="flex-shrink-0" />
              ))}
            </div>
            {/* 操作按钮 */}
            <div
              className="flex justify-end flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <TaskActions
                isFavorite={task.isFavorite}
                onToggleFavorite={() => toggleTaskFavorite(task.id).catch(() => {})}
                onReuse={onReuse}
                onEditOutputs={onEditOutputs}
                onDelete={onDelete}
                canEdit={!!task.outputImages?.length}
                size="sm"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
