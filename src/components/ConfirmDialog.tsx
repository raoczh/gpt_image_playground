import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useStore } from '../store'
import Overlay from './ui/Overlay'
import Button, { type ButtonVariant } from './ui/Button'

type Tone = 'danger' | 'primary' | 'warning'

const TONE_VARIANT: Record<Tone, ButtonVariant> = {
  danger: 'danger',
  primary: 'primary',
  warning: 'warning',
}

export default function ConfirmDialog() {
  const confirmDialog = useStore((s) => s.confirmDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [busy, setBusy] = useState(false)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  // 弹层打开时，焦点放到确认按钮上，便于回车直接确认
  useEffect(() => {
    if (confirmDialog) {
      const id = requestAnimationFrame(() => confirmBtnRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
    setBusy(false)
  }, [confirmDialog])

  const tone = (confirmDialog?.tone ?? 'danger') as Tone
  const confirmText = confirmDialog?.confirmText ?? '确认'
  const cancelText = confirmDialog?.cancelText ?? '取消'

  const handleClose = () => {
    if (!busy) setConfirmDialog(null)
  }

  const handleConfirm = async () => {
    if (busy || !confirmDialog) return
    setBusy(true)
    try {
      await confirmDialog.action()
    } finally {
      setBusy(false)
      setConfirmDialog(null)
    }
  }

  return (
    <Overlay
      open={Boolean(confirmDialog)}
      onClose={handleClose}
      closeOnEscape={!busy}
      closeOnOverlayClick={!busy}
      zClassName="z-[70]"
    >
      <div
        className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-elevated p-6 shadow-xl animate-confirm-in"
        onClick={(e) => e.stopPropagation()}
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title" className="mb-2 text-base font-bold text-foreground">
          {confirmDialog?.title}
        </h3>
        <p className="mb-5 whitespace-pre-wrap break-words text-sm text-muted">
          {confirmDialog?.message}
        </p>
        <div className="flex gap-2">
          <Button variant="subtle" className="flex-1" onClick={handleClose} disabled={busy}>
            {cancelText}
          </Button>
          <Button
            ref={confirmBtnRef}
            variant={TONE_VARIANT[tone]}
            className="flex-1 disabled:cursor-progress"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                处理中…
              </>
            ) : (
              confirmText
            )}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
