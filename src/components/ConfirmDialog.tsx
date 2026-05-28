import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

type Tone = 'danger' | 'primary' | 'warning'

const TONE_CLASSES: Record<Tone, string> = {
  danger: 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-500/40',
  primary:
    'bg-gray-800 hover:bg-gray-700 focus-visible:ring-gray-500/40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100',
  warning: 'bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-500/40',
}

export default function ConfirmDialog() {
  const confirmDialog = useStore((s) => s.confirmDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [busy, setBusy] = useState(false)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  useCloseOnEscape(Boolean(confirmDialog) && !busy, () => setConfirmDialog(null))

  // 弹层打开时，焦点放到确认按钮上，便于回车直接确认
  useEffect(() => {
    if (confirmDialog) {
      // 等待动画进入完成后再 focus，避免动画期间被 scroll 干扰
      const id = requestAnimationFrame(() => {
        confirmBtnRef.current?.focus()
      })
      return () => cancelAnimationFrame(id)
    }
    setBusy(false)
  }, [confirmDialog])

  if (!confirmDialog) return null

  const tone = confirmDialog.tone ?? 'danger'
  const confirmText = confirmDialog.confirmText ?? '确认'
  const cancelText = confirmDialog.cancelText ?? '取消'
  const toneCls = TONE_CLASSES[tone as Tone]

  const handleClose = () => {
    if (busy) return
    setConfirmDialog(null)
  }

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await confirmDialog.action()
    } finally {
      setBusy(false)
      setConfirmDialog(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-sm w-full p-6 z-10 ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title" className="text-base font-bold text-gray-800 dark:text-gray-100 mb-2">
          {confirmDialog.title}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 whitespace-pre-wrap break-words">
          {confirmDialog.message}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-white/[0.08] text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={`flex-1 py-2 rounded-lg text-white text-sm font-medium transition outline-none focus-visible:ring-2 disabled:opacity-60 disabled:cursor-progress inline-flex items-center justify-center gap-2 ${toneCls}`}
          >
            {busy && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
