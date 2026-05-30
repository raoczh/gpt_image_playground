import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'warning' | 'subtle'
export type ButtonSize = 'sm' | 'md'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-sm',
  success: 'bg-success text-white hover:bg-success/90 shadow-sm',
  warning: 'bg-warning text-white hover:bg-warning/90 shadow-sm',
  ghost: 'text-muted hover:bg-surface-2 hover:text-foreground',
  subtle: 'bg-surface-2 text-foreground border border-border hover:border-border-strong',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** 统一按钮：变体走语义 token，深浅自动跟随系统。 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
export default Button
