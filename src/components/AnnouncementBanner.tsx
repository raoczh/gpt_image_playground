import { useEffect, useState } from 'react'
import { getSiteConfig, type SiteConfig } from '../lib/adminApi'

const levelStyles: Record<string, string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  error: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30',
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<SiteConfig['announcement']>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    getSiteConfig()
      .then((cfg) => {
        const a = cfg.announcement
        if (!a || !a.enabled || !a.content) {
          setAnnouncement(null)
          return
        }
        if (a.expires_at && new Date(a.expires_at) < new Date()) {
          setAnnouncement(null)
          return
        }
        const dismissKey = `announcement-dismissed-${a.id || 'default'}`
        if (localStorage.getItem(dismissKey) === '1') {
          setDismissed(true)
          return
        }
        setAnnouncement(a)
      })
      .catch(() => {})
  }, [])

  if (!announcement || dismissed) return null

  const level = announcement.level || 'info'
  const cls = levelStyles[level] || levelStyles.info

  const handleDismiss = () => {
    const dismissKey = `announcement-dismissed-${announcement.id || 'default'}`
    localStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  return (
    <div className={`border-b px-4 py-2 text-sm flex items-center justify-between ${cls}`}>
      <span>{announcement.content}</span>
      <button
        onClick={handleDismiss}
        className="ml-3 shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="关闭公告"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>
    </div>
  )
}
