import { useEffect, useState } from 'react'
import { getQuota, type QuotaSummary } from '../lib/backendApi'

function formatBytes(n: number) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export default function MyQuotaCard() {
  const [quota, setQuota] = useState<QuotaSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getQuota()
      .then(setQuota)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) return null
  if (!quota) {
    return (
      <div className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
        加载额度中...
      </div>
    )
  }

  const dailyLimitText =
    quota.daily.limit === null ? '不限' : `${quota.daily.used} / ${quota.daily.limit}`
  const dailyPct =
    quota.daily.limit && quota.daily.limit > 0 ? Math.min(100, (quota.daily.used / quota.daily.limit) * 100) : 0

  const storageLimitText =
    quota.storage.limit_bytes === null
      ? `${formatBytes(quota.storage.used_bytes)} / 不限`
      : `${formatBytes(quota.storage.used_bytes)} / ${quota.storage.limit_mb} MB`
  const storagePct =
    quota.storage.limit_bytes && quota.storage.limit_bytes > 0
      ? Math.min(100, (quota.storage.used_bytes / quota.storage.limit_bytes) * 100)
      : 0

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="text-xs font-medium text-foreground">我的额度</div>
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">今日生成</span>
          <span className="text-foreground tabular-nums">{dailyLimitText}</span>
        </div>
        {quota.daily.limit !== null && (
          <div className="h-1.5 mt-1 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={`h-full ${dailyPct >= 90 ? 'bg-danger' : dailyPct >= 70 ? 'bg-warning' : 'bg-success'}`}
              style={{ width: `${dailyPct}%` }}
            />
          </div>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">存储空间</span>
          <span className="text-foreground tabular-nums">{storageLimitText}</span>
        </div>
        {quota.storage.limit_bytes !== null && (
          <div className="h-1.5 mt-1 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={`h-full ${storagePct >= 90 ? 'bg-danger' : storagePct >= 70 ? 'bg-warning' : 'bg-success'}`}
              style={{ width: `${storagePct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
