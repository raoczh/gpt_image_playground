import { type ReactNode, type RefObject } from 'react'
import { cn } from '../../lib/cn'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'

interface OverlayProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** z-index 工具类，默认 z-50；更高层（确认框/Toast）可传 z-[70] 等 */
  zClassName?: string
  /** 点击遮罩是否关闭，默认 true */
  closeOnOverlayClick?: boolean
  /** ESC 是否关闭，默认 true */
  closeOnEscape?: boolean
  /** 允许内部滚动的区域（背景锁定时仍可滚），传给 usePreventBackgroundScroll 白名单 */
  scrollRef?: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[]
  /** flex 容器额外类（默认居中，可改 items-end 等） */
  className?: string
}

/**
 * 弹层基座：纯遮罩 + 居中容器 + ESC + 背景滚动锁。不含面板样式。
 * 规整弹窗用上层的 Modal；布局特殊的（详情/Lightbox/遮罩编辑器）直接用 Overlay 自定义面板。
 */
export default function Overlay({
  open,
  onClose,
  children,
  zClassName = 'z-50',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  scrollRef,
  className,
}: OverlayProps) {
  useCloseOnEscape(open && closeOnEscape, onClose)
  usePreventBackgroundScroll(open, scrollRef)

  if (!open) return null

  return (
    <div
      className={cn('fixed inset-0 flex items-center justify-center p-4', zClassName, className)}
      onClick={closeOnOverlayClick ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50 animate-overlay-in" />
      {children}
    </div>
  )
}
