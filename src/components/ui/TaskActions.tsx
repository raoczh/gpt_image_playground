import { Star, Repeat2, Pencil, Trash2 } from 'lucide-react'
import IconButton, { type IconButtonSize } from './IconButton'
import { cn } from '../../lib/cn'

interface TaskActionsProps {
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onReuse?: () => void
  onEditOutputs?: () => void
  onDelete?: () => void
  /** 是否允许编辑输出（无输出图时禁用） */
  canEdit?: boolean
  size?: IconButtonSize
  className?: string
}

/**
 * 任务操作组（收藏 / 复用配置 / 编辑输出 / 删除）。
 * 收敛 TaskCard、TaskList、DetailModal 三处此前各自内联的重复实现。
 * 注意：在可点击的卡片/行内使用时，调用方需在外层包 onClick stopPropagation。
 */
export default function TaskActions({
  isFavorite,
  onToggleFavorite,
  onReuse,
  onEditOutputs,
  onDelete,
  canEdit = true,
  size = 'sm',
  className,
}: TaskActionsProps) {
  const iconCls = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {onToggleFavorite && (
        <IconButton
          variant="favorite"
          size={size}
          onClick={onToggleFavorite}
          title={isFavorite ? '取消收藏' : '收藏'}
          aria-label={isFavorite ? '取消收藏' : '收藏'}
          className={cn(isFavorite && 'text-warning')}
        >
          <Star className={cn(iconCls, isFavorite && 'fill-current')} />
        </IconButton>
      )}
      {onReuse && (
        <IconButton variant="primary" size={size} onClick={onReuse} title="复用配置" aria-label="复用配置">
          <Repeat2 className={iconCls} />
        </IconButton>
      )}
      {onEditOutputs && (
        <IconButton
          variant="success"
          size={size}
          onClick={onEditOutputs}
          disabled={!canEdit}
          title="编辑输出"
          aria-label="编辑输出"
        >
          <Pencil className={iconCls} />
        </IconButton>
      )}
      {onDelete && (
        <IconButton variant="danger" size={size} onClick={onDelete} title="删除记录" aria-label="删除记录">
          <Trash2 className={iconCls} />
        </IconButton>
      )}
    </div>
  )
}
