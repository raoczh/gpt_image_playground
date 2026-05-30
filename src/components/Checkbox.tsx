import React from 'react'
import { cn } from '../lib/cn'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  tone?: 'primary' | 'danger'
}

export function Checkbox({ checked, onChange, label, tone = 'primary', className, ...props }: CheckboxProps) {
  const toneClasses = tone === 'danger'
    ? 'border-danger/50 checked:bg-danger checked:border-danger focus:ring-danger/20'
    : 'border-border-strong checked:bg-primary checked:border-primary focus:ring-primary/20'

  return (
    <label className={cn('flex items-center gap-2 cursor-pointer group', className)}>
      <div className="relative flex items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={cn(
            'peer appearance-none w-4 h-4 rounded-[4px] border bg-surface transition-all cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface',
            toneClasses,
          )}
          {...props}
        />
        {/* 勾选标记落在已勾选的实色填充（primary/danger）上，白色在深浅模式下都成立 */}
        <svg className="absolute w-2.5 h-2.5 pointer-events-none opacity-0 peer-checked:opacity-100 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      {label && <span className="text-[13px] font-medium text-muted group-hover:text-foreground transition-colors">{label}</span>}
    </label>
  )
}
