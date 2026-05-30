import { Check, X, Info } from 'lucide-react'
import { useStore } from '../store'
import type { ToastItem } from '../store'
import { cn } from '../lib/cn'

const ICON_CONFIG: Record<ToastItem['type'], { bg: string; Icon: typeof Check }> = {
  success: { bg: 'bg-success', Icon: Check },
  error: { bg: 'bg-danger', Icon: X },
  info: { bg: 'bg-primary', Icon: Info },
}

function ToastIcon({ type }: { type: ToastItem['type'] }) {
  const { bg, Icon } = ICON_CONFIG[type] ?? ICON_CONFIG.info
  return (
    <div className={cn('flex h-5 w-5 items-center justify-center rounded-full text-white', bg)}>
      <Icon className="h-3 w-3" strokeWidth={3} />
    </div>
  )
}

export default function Toast() {
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-24 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="toast-enter pointer-events-auto">
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="flex w-max max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-full border border-border bg-elevated px-5 py-3.5 text-sm font-medium text-foreground shadow-lg transition-transform hover:scale-[1.02] sm:max-w-[min(28rem,60vw)]"
            title="点击关闭"
          >
            <span className="flex-shrink-0">
              <ToastIcon type={t.type} />
            </span>
            <span className="text-left leading-5">{t.message}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
