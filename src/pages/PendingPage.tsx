import { useStore } from '../store'
import { logout } from '../lib/backendApi'

export default function PendingPage() {
  const user = useStore((s) => s.user)
  const setUser = useStore((s) => s.setUser)

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      setUser(null)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-sm border border-gray-200 dark:border-white/[0.08] p-8 text-center">
        {user?.avatar_url && (
          <img
            src={user.avatar_url}
            alt={user.username}
            className="w-16 h-16 rounded-full mx-auto mb-4"
          />
        )}
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          账号待审核
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
          您的账号 <span className="font-medium text-gray-800 dark:text-gray-200">{user?.username}</span> 已提交，
          正在等待管理员审核。审核通过后即可使用全部功能。
        </p>
        <button
          onClick={handleLogout}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors"
        >
          退出登录
        </button>
      </div>
    </div>
  )
}
