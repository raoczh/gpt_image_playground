import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'

interface Option {
  label: string
  value: string | number
}

interface SelectProps {
  value: string | number
  onChange: (value: any) => void
  options: Option[]
  disabled?: boolean
  className?: string
}

export default function Select({ value, onChange, options, disabled, className }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    if (disabled) return
    e.stopPropagation()

    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceAbove = rect.top
      const spaceBelow = window.innerHeight - rect.bottom
      setOpenUp(spaceAbove > spaceBelow)
    }

    setIsOpen(!isOpen)
  }, [disabled, isOpen])

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        ref={triggerRef}
        onClick={handleToggle}
        className={cn(
          'flex w-full cursor-pointer select-none items-center justify-between gap-1',
          className,
          disabled && '!cursor-not-allowed !opacity-50',
        )}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 flex-shrink-0 text-subtle transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </div>

      {isOpen && (
        <div
          className={cn(
            'absolute z-50 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-elevated py-1 shadow-lg',
            openUp ? 'bottom-full mb-1.5 animate-dropdown-up' : 'top-full mt-1.5 animate-dropdown-down',
          )}
        >
          {options.map((option) => (
            <div
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              className={cn(
                'cursor-pointer px-3 py-2 text-xs transition-colors',
                option.value === value
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-foreground hover:bg-surface-2',
              )}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
