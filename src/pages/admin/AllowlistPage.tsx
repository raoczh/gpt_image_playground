import { useEffect, useState } from 'react'
import { listAllowlist, addAllowlist, removeAllowlist, type AllowlistItem } from '../../lib/adminApi'
import { useStore } from '../../store'

export default function AllowlistPage() {
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [items, setItems] = useState<AllowlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newUsername, setNewUsername] = useState('')
  const [newNote, setNewNote] = useState('')
  const [adding, setAdding] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await listAllowlist()
      setItems(res.items)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim()) return
    setAdding(true)
    try {
      await addAllowlist(newUsername.trim(), newNote.trim() || undefined)
      setNewUsername('')
      setNewNote('')
      showToast('已添加', 'success')
      reload()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = (item: AllowlistItem) => {
    setConfirmDialog({
      title: '移除白名单',
      message: `从注册白名单中移除 ${item.github_username}？`,
      action: async () => {
        try {
          await removeAllowlist(item.id)
          showToast('已移除', 'success')
          reload()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
        }
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">添加白名单</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          仅当系统配置中"注册模式"为 <span className="font-mono">allowlist</span> 时生效。GitHub 用户名大小写不敏感。
        </p>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">GitHub 用户名</label>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="octocat"
              className="form-input"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">备注（可选）</label>
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="form-input"
            />
          </div>
          <button
            type="submit"
            disabled={adding || !newUsername.trim()}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 disabled:opacity-40"
          >
            {adding ? '添加中...' : '添加'}
          </button>
        </form>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/[0.08] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">GitHub 用户名</th>
              <th className="px-3 py-2 text-left">备注</th>
              <th className="px-3 py-2 text-left">添加者</th>
              <th className="px-3 py-2 text-left">添加时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
            {loading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">加载中...</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">白名单为空</td></tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <td className="px-3 py-2 font-mono text-gray-800 dark:text-gray-100">{it.github_username}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{it.note || '—'}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{it.added_by_username || '—'}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{it.created_at}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => handleRemove(it)}
                    className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
