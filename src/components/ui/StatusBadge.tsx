import { cn } from '../../lib/cn'

/** 状态 → 圆点色 + 文案。扁平风格：醒目实色圆点 + 中性文字，对比稳定、不依赖浅底。 */
const STATUS: Record<string, { text: string; dot: string }> = {
  running: { text: '运行中', dot: 'bg-primary' },
  done: { text: '完成', dot: 'bg-success' },
  error: { text: '失败', dot: 'bg-danger' },
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const s = STATUS[status] ?? { text: status, dot: 'bg-muted' }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted', className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot, status === 'running' && 'animate-pulse')} />
      {s.text}
    </span>
  )
}
