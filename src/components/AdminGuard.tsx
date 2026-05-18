import { Navigate, Outlet } from 'react-router-dom'
import { useStore } from '../store'

export default function AdminGuard() {
  const user = useStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}
