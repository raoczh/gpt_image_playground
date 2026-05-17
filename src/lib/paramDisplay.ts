import type { TaskParams } from '../types'

/**
 * 把请求参数和 API 实际响应参数对比，返回需要显示的徽章列表。
 * 顺序固定：quality / size / output_format
 */
export interface ParamBadge {
  key: keyof TaskParams
  requested: string
  actual: string | null
  /** API 实际值与请求不一致 */
  mismatched: boolean
}

const PARAM_KEYS: (keyof TaskParams)[] = ['quality', 'size', 'output_format']

function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

export function getParamBadges(
  params: TaskParams,
  actualParams: Partial<TaskParams> | null | undefined,
): ParamBadge[] {
  return PARAM_KEYS.map((key) => {
    const requested = toDisplay(params[key])
    const actualRaw = actualParams ? actualParams[key] : undefined
    const actual = actualRaw === undefined || actualRaw === null ? null : toDisplay(actualRaw)
    const mismatched = actual !== null && actual !== '' && requested !== actual
    return { key, requested, actual, mismatched }
  })
}
