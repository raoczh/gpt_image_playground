import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground',
        'placeholder:text-subtle transition-colors',
        'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground',
        'placeholder:text-subtle transition-colors resize-none',
        'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
TextArea.displayName = 'TextArea'

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}

/** label + 控件 + 提示 的竖排包装。 */
export function Field({ label, hint, children, className }: FieldProps) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      {label && <span className="ml-0.5 text-xs text-muted">{label}</span>}
      {children}
      {hint && <span className="ml-0.5 text-xs text-subtle">{hint}</span>}
    </label>
  )
}
