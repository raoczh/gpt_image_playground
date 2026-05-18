import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store'
import { redirectToGitHubLogin } from '../lib/backendApi'

export default function LoginPage() {
  const user = useStore((s) => s.user)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user && user.status === 'active') {
      navigate('/', { replace: true })
    }
  }, [user, navigate])

  useEffect(() => {
    const err = searchParams.get('error')
    if (err === 'no_code') {
      setError('GitHub 授权失败：未获取到授权码')
    } else if (err === 'invalid_state') {
      setError('登录状态已失效，请重新发起 GitHub 登录')
    } else if (err === 'auth_failed') {
      setError('GitHub 登录失败，请重试')
    } else if (err === 'disabled') {
      setError('该账号已被禁用，请联系管理员')
    } else if (err === 'not_allowed') {
      setError('该 GitHub 账号不在注册白名单内')
    } else if (err === 'account_deleted') {
      setError('该账号已被删除')
    } else if (err) {
      setError('登录出错，请重试')
    }
  }, [searchParams])

  if (user && user.status === 'active') return null

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 tracking-tight">
            GPT Image Playground
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            登录后即可使用 AI 图片生成功能
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200/70 bg-white/80 p-6 shadow-lg backdrop-blur dark:border-white/[0.08] dark:bg-gray-900/80">
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200/80 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={redirectToGitHubLogin}
            className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-gray-800 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-700 active:scale-[0.98] dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            使用 GitHub 登录
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
          使用 GitHub 账号授权登录，我们仅获取您的基本信息
        </p>
      </div>
    </div>
  )
}
