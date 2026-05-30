import { type ReactNode, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import Overlay from './Overlay'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: ReactNode
  size?: ModalSize
  showClose?: boolean
  closeOnOverlayClick?: boolean
  zClassName?: string
  /** 面板额外类 */
  className?: string
  /** 内容区额外类（默认有内边距） */
  bodyClassName?: string
}

/** 标准居中弹窗：扁平实色面板 + 可选标题/关闭按钮，复用 Overlay 的 ESC/滚动锁。 */
export default function Modal({
  open,
  onClose,
  children,
  title,
  size = 'md',
  showClose = true,
  closeOnOverlayClick = true,
  zClassName,
  className,
  bodyClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const hasHeader = Boolean(title) || showClose

  return (
    <Overlay
      open={open}
      onClose={onClose}
      closeOnOverlayClick={closeOnOverlayClick}
      zClassName={zClassName}
      scrollRef={panelRef}
    >
      <div
        ref={panelRef}
        className={cn(
          'relative z-10 w-full max-h-[90vh] overflow-y-auto',
          'bg-elevated border border-border rounded-2xl shadow-xl animate-modal-in',
          SIZE_CLASSES[size],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {hasHeader && (
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
            {title ? (
              <h3 className="text-base font-semibold text-foreground">{title}</h3>
            ) : (
              <span />
            )}
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="-mr-1 rounded-lg p-1.5 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className={cn(hasHeader ? 'px-5 pb-5' : 'p-5', bodyClassName)}>{children}</div>
      </div>
    </Overlay>
  )
}
