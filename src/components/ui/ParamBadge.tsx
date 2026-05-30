import { cn } from '../../lib/cn'
import type { ParamBadge as ParamBadgeData } from '../../lib/paramDisplay'

interface ParamBadgeProps {
  badge: ParamBadgeData
  className?: string
}

/** 参数徽章：API 实际值与请求不一致时高亮为 warning。 */
export default function ParamBadge({ badge, className }: ParamBadgeProps) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-xs',
        badge.mismatched ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-muted',
        className,
      )}
      title={badge.mismatched ? `请求：${badge.requested}\nAPI 实际：${badge.actual}` : undefined}
    >
      {badge.mismatched ? `${badge.requested} → ${badge.actual}` : badge.requested}
    </span>
  )
}
