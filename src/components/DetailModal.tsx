import { useEffect, useState, useMemo, useRef, type ReactNode } from 'react'
import {
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Copy,
  Terminal,
  Link,
  Repeat2,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useStore, reuseConfig, editOutputs, removeTask } from '../store'
import { formatImageRatio } from '../lib/size'
import { cn } from '../lib/cn'
import Overlay from './ui/Overlay'
import Modal from './ui/Modal'
import Button from './ui/Button'

// 错误态下的红色描边图标按钮（复制报错 / 看原始响应 / 复制图片 URL）
const errorActionBtnCls =
  'inline-flex items-center justify-center rounded-lg border border-danger/30 bg-surface p-2 text-danger transition-colors hover:bg-danger/10'
// 标题旁的迷你复制按钮
const inlineCopyBtnCls =
  'rounded p-1 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground'
// 底部三枚操作按钮的共用基座（颜色由调用处用 cn 叠加）
const bottomBtnCls =
  'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed sm:px-3 sm:text-sm'

/** 参数配置网格里的单个小卡片 */
function ParamCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <span className="text-subtle">{label}</span>
      <br />
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

export default function DetailModal() {
  const tasks = useStore((s) => s.tasks)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const [showRawPayload, setShowRawPayload] = useState(false)

  const [imageIndex, setImageIndex] = useState(0)
  const [imageRatios, setImageRatios] = useState<Record<string, string>>({})
  const [imageSizes, setImageSizes] = useState<Record<string, string>>({})
  /** 已完成原图预加载的 image id，命中后主图切换为原图（双阶段加载：缩略图占位 → 原图替换） */
  const [highResLoaded, setHighResLoaded] = useState<Set<string>>(new Set())
  const imagePanelRef = useRef<HTMLDivElement>(null)
  const mainImageRef = useRef<HTMLImageElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [imageLabelLeft, setImageLabelLeft] = useState(8)

  const task = useMemo(
    () => tasks.find((t) => t.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  )

  // Reset index when task changes
  useEffect(() => {
    setImageIndex(0)
  }, [detailTaskId])

  const currentOutputImageId = task?.outputImages?.[imageIndex] || ''
  const currentOutputImageSrc = currentOutputImageId
  const currentOutputThumbSrc = task?.outputThumbnails?.[imageIndex] || ''
  // 双阶段加载：原图预加载完成前显示缩略图，完成后切到原图（避免大图阻塞首次渲染）
  const currentOutputPreviewSrc =
    currentOutputImageId && highResLoaded.has(currentOutputImageId)
      ? currentOutputImageSrc
      : currentOutputThumbSrc || currentOutputImageSrc

  useEffect(() => {
    if (!currentOutputImageId || !currentOutputImageSrc) return

    let cancelled = false
    const image = new Image()
    const markLoaded = () => {
      if (cancelled || !image.naturalWidth || !image.naturalHeight) return
      setImageRatios((prev) => ({
        ...prev,
        [currentOutputImageId]: formatImageRatio(image.naturalWidth, image.naturalHeight),
      }))
      setImageSizes((prev) => ({
        ...prev,
        [currentOutputImageId]: `${image.naturalWidth}×${image.naturalHeight}`,
      }))
      setHighResLoaded((prev) => {
        if (prev.has(currentOutputImageId)) return prev
        const next = new Set(prev)
        next.add(currentOutputImageId)
        return next
      })
    }
    image.onload = markLoaded
    image.src = currentOutputImageSrc
    if (image.complete) markLoaded()

    return () => {
      cancelled = true
    }
  }, [currentOutputImageId, currentOutputImageSrc])

  useEffect(() => {
    const updateImageLabelLeft = () => {
      const panel = imagePanelRef.current
      const image = mainImageRef.current
      if (!panel || !image) return

      const panelRect = panel.getBoundingClientRect()
      const imageRect = image.getBoundingClientRect()
      setImageLabelLeft(Math.max(8, imageRect.left - panelRect.left))
    }

    updateImageLabelLeft()
    window.addEventListener('resize', updateImageLabelLeft)
    return () => window.removeEventListener('resize', updateImageLabelLeft)
  }, [currentOutputPreviewSrc])

  // 多张输出图时支持键盘左右切换；Lightbox 或原始响应弹窗打开时让位，避免方向键冲突
  useEffect(() => {
    if (!task || task.status !== 'done') return
    const len = task.outputImages?.length || 0
    if (len <= 1) return
    const onKey = (e: KeyboardEvent) => {
      if (lightboxImageId || showRawPayload) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setImageIndex((i) => (i - 1 + len) % len)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setImageIndex((i) => (i + 1) % len)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [task, lightboxImageId, showRawPayload])

  if (!task) return null

  const outputLen = task.outputImages?.length || 0
  const currentImageRatio = currentOutputImageId ? imageRatios[currentOutputImageId] : ''
  const currentImageSize = currentOutputImageId ? imageSizes[currentOutputImageId] : ''

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('zh-CN')
  }

  const formatDuration = () => {
    if (task.elapsed == null) return null
    const seconds = Math.floor(task.elapsed / 1000)
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const handleReuse = () => {
    reuseConfig(task)
    setDetailTaskId(null)
  }

  const handleEdit = () => {
    editOutputs(task)
    setDetailTaskId(null)
  }

  const handleDelete = () => {
    setDetailTaskId(null)
    setConfirmDialog({
      title: '删除记录',
      message: '确定要删除这条记录吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const handleCopyError = async () => {
    const errorText = task.error || '生成失败'
    try {
      await navigator.clipboard.writeText(errorText)
      showToast('完整报错已复制', 'success')
    } catch {
      showToast('复制报错失败', 'error')
    }
  }

  const handleCopyRawImageUrls = async () => {
    const urls = task.rawImageUrls
    if (!urls || urls.length === 0) {
      showToast('没有原始图片 URL', 'info')
      return
    }
    try {
      await navigator.clipboard.writeText(urls.join('\n'))
      showToast(`已复制 ${urls.length} 个图片 URL`, 'success')
    } catch {
      showToast('复制失败', 'error')
    }
  }

  const handleCopyPrompt = async () => {
    if (!task.prompt) return
    try {
      await navigator.clipboard.writeText(task.prompt)
      showToast('提示词已复制', 'success')
    } catch {
      showToast('复制提示词失败', 'error')
    }
  }

  const currentRevisedPrompt = currentOutputImageId
    ? task.revisedPromptByImage?.[currentOutputImageId] || null
    : null
  const showRevisedPrompt = Boolean(
    currentRevisedPrompt && task.prompt && currentRevisedPrompt.trim() !== task.prompt.trim(),
  )

  const handleCopyRevisedPrompt = async () => {
    if (!currentRevisedPrompt) return
    try {
      await navigator.clipboard.writeText(currentRevisedPrompt)
      showToast('改写后的提示词已复制', 'success')
    } catch {
      showToast('复制失败', 'error')
    }
  }

  const handleCopyInputImage = async () => {
    const src = task.inputImageUrls?.[0]
    if (!src) return
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      showToast('参考图已复制', 'success')
    } catch (err) {
      console.error(err)
      showToast('复制参考图失败', 'error')
    }
  }

  return (
    <>
      <Overlay open onClose={() => setDetailTaskId(null)} scrollRef={panelRef}>
        <div
          ref={panelRef}
          className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-elevated shadow-xl animate-modal-in md:flex-row"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 移动端顶部关闭栏 */}
          <div className="flex h-14 items-center justify-end px-4 md:hidden">
            <button
              onClick={() => setDetailTaskId(null)}
              className="rounded-full p-1 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* 左侧：图片 */}
          <div
            ref={imagePanelRef}
            className="relative flex h-64 min-h-[16rem] w-full flex-shrink-0 items-center justify-center bg-surface-2 md:h-auto md:w-1/2"
          >
            {task.status === 'done' && outputLen > 0 && (
              <>
                <img
                  ref={mainImageRef}
                  src={currentOutputPreviewSrc}
                  data-original-src={currentOutputImageSrc}
                  className="saveable-image max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] cursor-pointer object-contain"
                  onLoad={() => {
                    const panel = imagePanelRef.current
                    const image = mainImageRef.current
                    if (!panel || !image) return

                    const panelRect = panel.getBoundingClientRect()
                    const imageRect = image.getBoundingClientRect()
                    setImageLabelLeft(Math.max(8, imageRect.left - panelRect.left))
                  }}
                  onClick={() => setLightboxImageId(task.outputImages[imageIndex], task.outputImages)}
                  alt=""
                />
                <div className="absolute top-[15px] flex items-center gap-1.5" style={{ left: imageLabelLeft }}>
                  {currentImageRatio && currentImageSize ? (
                    <>
                      <span className="rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm">
                        {currentImageRatio}
                      </span>
                      <span className="rounded bg-black/50 px-2 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">
                        {currentImageSize}
                      </span>
                    </>
                  ) : (
                    formatDuration() && (
                      <span className="flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm">
                        <Clock className="h-3 w-3" />
                        {formatDuration()}
                      </span>
                    )
                  )}
                </div>
                {outputLen > 1 && (
                  <>
                    <button
                      onClick={() => setImageIndex((imageIndex - 1 + outputLen) % outputLen)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-1.5 text-white transition hover:bg-black/50"
                      aria-label="上一张"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setImageIndex((imageIndex + 1) % outputLen)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-1.5 text-white transition hover:bg-black/50"
                      aria-label="下一张"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
                      {imageIndex + 1} / {outputLen}
                    </span>
                  </>
                )}
              </>
            )}
            {task.status === 'running' && <Loader2 className="h-10 w-10 animate-spin text-primary" />}
            {task.status === 'error' && (
              <div className="w-full max-w-md px-4 text-center">
                <AlertCircle className="mx-auto mb-2 h-10 w-10 text-danger" />
                <p
                  className="overflow-hidden break-all text-sm leading-6 text-danger"
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 4,
                  }}
                >
                  {task.error || '生成失败'}
                </p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyError}
                    className={errorActionBtnCls}
                    aria-label="复制完整报错"
                    title="复制完整报错"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  {task.rawResponsePayload && (
                    <button
                      type="button"
                      onClick={() => setShowRawPayload(true)}
                      className={errorActionBtnCls}
                      aria-label="查看原始响应"
                      title="查看原始响应"
                    >
                      <Terminal className="h-4 w-4" />
                    </button>
                  )}
                  {task.rawImageUrls && task.rawImageUrls.length > 0 && (
                    <button
                      type="button"
                      onClick={handleCopyRawImageUrls}
                      className={errorActionBtnCls}
                      aria-label="复制图片 URL"
                      title="复制图片 URL"
                    >
                      <Link className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 右侧：信息 */}
          <div className="flex w-full flex-col overflow-y-auto p-5 md:w-1/2">
            <button
              onClick={() => setDetailTaskId(null)}
              className="absolute right-3 top-3 z-10 hidden rounded-full p-1 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground md:block"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex-1">
              <div className="mb-2 flex items-center gap-1.5">
                <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">输入内容</h3>
                {task.prompt && (
                  <button onClick={handleCopyPrompt} className={inlineCopyBtnCls} title="复制提示词">
                    <Copy className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {task.prompt || '(无提示词)'}
              </p>

              {/* API 改写后的提示词 */}
              {showRevisedPrompt && currentRevisedPrompt && (
                <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-warning">
                      API 改写后的提示词
                    </span>
                    <button
                      onClick={handleCopyRevisedPrompt}
                      className="rounded p-1 text-warning transition-colors hover:bg-warning/20"
                      title="复制改写后的提示词"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                    {currentRevisedPrompt}
                  </p>
                </div>
              )}

              {/* 参考图 */}
              {task.inputImageIds?.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-1.5">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">参考图</h3>
                    <button onClick={handleCopyInputImage} className={inlineCopyBtnCls} title="复制参考图">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {task.inputImageIds.map((imgId, idx) => {
                      const url = task.inputImageUrls?.[idx] || ''
                      const thumb = task.inputThumbnails?.[idx] || url
                      return (
                        <img
                          key={imgId}
                          src={thumb}
                          data-original-src={url}
                          className="saveable-image h-16 w-16 cursor-pointer rounded-lg border border-border object-cover transition hover:opacity-80"
                          onClick={() => url && setLightboxImageId(url, task.inputImageUrls || [])}
                          alt=""
                        />
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 参数 */}
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-subtle">参数配置</h3>
              <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
                <ParamCell label="尺寸" value={task.params.size} />
                <ParamCell label="质量" value={task.params.quality} />
                <ParamCell label="格式" value={task.params.output_format} />
                <ParamCell label="审核" value={task.params.moderation} />
                <ParamCell label="数量" value={task.params.n} />
                {task.params.output_compression != null && (
                  <ParamCell label="压缩率" value={task.params.output_compression} />
                )}
              </div>

              {/* 时间 */}
              <div className="mb-4 text-xs text-subtle">
                <span>创建于 {formatTime(task.createdAt)}</span>
                {formatDuration() && <span> · 耗时 {formatDuration()}</span>}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2 border-t border-border pt-3">
              <button
                onClick={handleReuse}
                className={cn(bottomBtnCls, 'bg-primary/10 text-primary hover:bg-primary/20')}
              >
                <Repeat2 className="h-4 w-4 flex-shrink-0" />
                复用配置
              </button>
              <button
                onClick={handleEdit}
                disabled={!outputLen}
                className={cn(bottomBtnCls, 'bg-success/10 text-success hover:bg-success/20 disabled:opacity-40')}
              >
                <Pencil className="h-4 w-4 flex-shrink-0" />
                编辑输出
              </button>
              <button
                onClick={handleDelete}
                className={cn(bottomBtnCls, 'bg-danger/10 text-danger hover:bg-danger/20')}
              >
                <Trash2 className="h-4 w-4 flex-shrink-0" />
                删除记录
              </button>
            </div>
          </div>
        </div>
      </Overlay>

      {/* 上游原始响应 */}
      <Modal
        open={showRawPayload && !!task.rawResponsePayload}
        onClose={() => setShowRawPayload(false)}
        title="上游原始响应"
        size="lg"
        zClassName="z-[80]"
      >
        <div className="mb-3 flex justify-end">
          <Button
            variant="subtle"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(task.rawResponsePayload || '')
                showToast('已复制', 'success')
              } catch {
                showToast('复制失败', 'error')
              }
            }}
          >
            复制
          </Button>
        </div>
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 text-xs text-muted">
          {(() => {
            try {
              return JSON.stringify(JSON.parse(task.rawResponsePayload || ''), null, 2)
            } catch {
              return task.rawResponsePayload
            }
          })()}
        </pre>
      </Modal>
    </>
  )
}
