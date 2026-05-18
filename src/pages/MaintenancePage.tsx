import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSiteConfig } from '../lib/adminApi'
import { useStore } from '../store'

export default function MaintenancePage() {
  const user = useStore((s) => s.user)
  const [message, setMessage] = useState('系统维护中，请稍后再试')

  useEffect(() => {
    getSiteConfig()
      .then((cfg) => {
        if (cfg.maintenance_message) setMessage(cfg.maintenance_message)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-sm border border-gray-200 dark:border-white/[0.08] p-8 text-center">
        <div className="text-4xl mb-3">🛠️</div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          系统维护
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
          {message}
        </p>
        {user?.role === 'admin' && (
          <Link
            to="/admin"
            className="inline-block px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            进入管理后台
          </Link>
        )}
      </div>
    </div>
  )
}
