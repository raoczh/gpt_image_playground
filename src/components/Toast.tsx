import { useStore } from '../store'
import type { ToastItem } from '../store'

function ToastIcon({ type }: { type: ToastItem['type'] }) {
  if (type === 'success') {
    return (
      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )
  }
  if (type === 'error') {
    return (
      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  )
}

export default function Toast() {
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="toast-enter pointer-events-auto">
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="flex items-center gap-2.5 w-max max-w-[calc(100vw-32px)] sm:max-w-[min(28rem,60vw)] px-5 py-3.5 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-white/[0.08] rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] ring-1 ring-black/5 dark:ring-white/10 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer transition-transform hover:scale-[1.02]"
            title="点击关闭"
          >
            <span className="flex-shrink-0">
              <ToastIcon type={t.type} />
            </span>
            <span className="leading-5 text-left">{t.message}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
