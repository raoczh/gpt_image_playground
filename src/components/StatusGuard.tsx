import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import { logout } from '../lib/backendApi'
import { useEffect, useRef } from 'react'

export default function StatusGuard() {
  const user = useStore((s) => s.user)
  const setUser = useStore((s) => s.setUser)
  const location = useLocation()
  const handlingDisabled = useRef(false)

  useEffect(() => {
    if (user?.status === 'disabled' && !handlingDisabled.current) {
      handlingDisabled.current = true
      // 同步先清 user，避免 LoginPage 看到旧 user 触发 navigate('/') 形成闪烁
      setUser(null)
      logout().catch(() => {})
    }
  }, [user, setUser])

  if (!user) return <Outlet />

  if (user.status === 'disabled') {
    return <Navigate to="/login?error=disabled" replace />
  }

  if (user.status === 'pending' && location.pathname !== '/pending') {
    return <Navigate to="/pending" replace />
  }

  if (user.status === 'active' && location.pathname === '/pending') {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
