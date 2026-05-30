import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind 类名：clsx 负责条件拼接，tailwind-merge 解决同属性冲突
 * （后写的覆盖先写的，例如 cn('px-2', condition && 'px-4') → 'px-4'）。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
