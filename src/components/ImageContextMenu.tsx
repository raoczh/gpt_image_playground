import React, { useEffect, useState, useRef } from 'react'
import { Copy, Download, Pencil } from 'lucide-react'
import { useStore, addImageFromUrl } from '../store'

export default function ImageContextMenu() {
  const [menuInfo, setMenuInfo] = useState<{ src: string; x: number; y: number; inIframe: boolean } | null>(null)
  const showToast = useStore((s) => s.showToast)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target && target.tagName === 'IMG') {
        const imgTarget = target as HTMLImageElement
        if (!imgTarget.src) return
        if (window.self !== window.top) return

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        const isTouch = window.matchMedia('(pointer: coarse)').matches
        if (isIOS && isTouch) return

        e.preventDefault()
        const originalSrc = imgTarget.dataset.originalSrc
        setMenuInfo({
          src: originalSrc || imgTarget.src,
          x: e.clientX,
          y: e.clientY,
          inIframe: false,
        })
      }
    }

    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  useEffect(() => {
    if (!menuInfo) return
    const close = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return
      }
      if (e.target instanceof Element && e.target.closest('[data-lightbox-root]')) {
        window.dispatchEvent(new Event('image-context-menu-dismiss-lightbox-click'))
      }
      setMenuInfo(null)
    }
    window.addEventListener('mousedown', close, { capture: true })
    window.addEventListener('touchstart', close, { capture: true })
    window.addEventListener('wheel', close, { capture: true })
    window.addEventListener('scroll', close, { capture: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close, { capture: true })
      window.removeEventListener('touchstart', close, { capture: true })
      window.removeEventListener('wheel', close, { capture: true })
      window.removeEventListener('scroll', close, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [menuInfo])

  if (!menuInfo) return null

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    try {
      const res = await fetch(menuInfo.src)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      showToast('图片已复制', 'success')
    } catch (err) {
      console.error(err)
      showToast('复制失败', 'error')
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    try {
      const res = await fetch(menuInfo.src)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = blob.type.split('/')[1] || 'png'
      a.download = `image-${Date.now()}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('开始下载', 'success')
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const src = menuInfo.src
    setMenuInfo(null)
    setDetailTaskId(null)
    setLightboxImageId(null)
    setShowSettings(false)
    setMaskEditorImageId(null)
    try {
      await addImageFromUrl(src)
    } catch (err) {
      console.error(err)
      showToast('添加到输入失败', 'error')
    }
  }

  // 保证菜单在视口内
  let left = menuInfo.x
  let top = menuInfo.y
  const MENU_WIDTH = 120
  const MENU_HEIGHT = 132

  if (left + MENU_WIDTH > window.innerWidth) {
    left -= MENU_WIDTH
  }
  if (top + MENU_HEIGHT > window.innerHeight) {
    top -= MENU_HEIGHT
  }

  const itemClass =
    'flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-2'

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] w-[120px] overflow-hidden rounded-lg border border-border bg-elevated py-1 shadow-xl animate-fade-in"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button onClick={handleCopy} className={itemClass}>
        <Copy className="h-4 w-4 flex-shrink-0" />
        复制
      </button>
      <button onClick={handleDownload} className={itemClass}>
        <Download className="h-4 w-4 flex-shrink-0" />
        下载
      </button>
      <button onClick={handleEdit} className={itemClass}>
        <Pencil className="h-4 w-4 flex-shrink-0" />
        编辑
      </button>
    </div>
  )
}
