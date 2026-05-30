import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type IconButtonVariant = 'ghost' | 'primary' | 'danger' | 'success' | 'favorite'
export type IconButtonSize = 'sm' | 'md'

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost: 'text-muted hover:bg-surface-2 hover:text-foreground',
  primary: 'text-muted hover:bg-primary/10 hover:text-primary',
  danger: 'text-muted hover:bg-danger/10 hover:text-danger',
  success: 'text-muted hover:bg-success/10 hover:text-success',
  favorite: 'text-muted hover:bg-warning/10 hover:text-warning',
}

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'p-1.5',
  md: 'p-2',
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  size?: IconButtonSize
}

/** 仅图标的方形按钮，hover 着色按语义区分（删除偏红、收藏偏琥珀等）。 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'md', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  ),
)
IconButton.displayName = 'IconButton'
export default IconButton
