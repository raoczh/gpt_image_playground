import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { getSiteConfig, type SiteConfig } from '../lib/adminApi'

const levelStyles: Record<string, string> = {
  info: 'bg-primary/10 text-primary border-primary/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  error: 'bg-danger/10 text-danger border-danger/20',
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
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
