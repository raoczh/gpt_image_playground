import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, List, Check, X } from 'lucide-react'
import Overlay from './ui/Overlay'
import { GithubIcon } from './icons'

interface HelpModalProps {
  onClose: () => void
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

export default function HelpModal({ onClose }: HelpModalProps) {
  const isMobile = useIsMobile()
  const modalRef = useRef<HTMLDivElement>(null)

  // 渲染到 body：Header 是 z-40 的 sticky 层（自带堆叠上下文），不 portal 出去 z-[100] 会被困在其内。
  // 遮罩 / ESC / 背景滚动锁交给 Overlay 统一处理。
  return createPortal(
    <Overlay open onClose={onClose} zClassName="z-[100]" scrollRef={modalRef}>
      <div
        ref={modalRef}
        className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-elevated p-5 shadow-xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <HelpCircle className="h-5 w-5 text-primary" />
            操作指南
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 flex-1 space-y-6 overflow-y-auto overscroll-contain pr-2 text-sm text-muted">
          {isMobile ? (
            <>
              <section>
                <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <List className="h-4 w-4 text-subtle" />
                  多选记录
                </h4>
                <div className="space-y-4">
                  <p>在历史记录卡片上<strong className="font-medium text-primary">左右滑动</strong>即可选中或取消选中该卡片。</p>
                </div>
              </section>
              <section>
                <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Check className="h-4 w-4 text-subtle" />
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>选中一条或多条记录后，页面底部会出现操作栏，支持<strong className="font-medium text-muted">取消选择</strong>、<strong className="font-medium text-primary">全选当前可见记录</strong>、<strong className="font-medium text-warning">批量收藏</strong>、<strong className="font-medium text-success">批量下载</strong>，和<strong className="font-medium text-danger">批量删除</strong>。</p>
                </div>
              </section>
            </>
          ) : (
            <>
              <section>
                <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <List className="h-4 w-4 text-subtle" />
                  多选记录
                </h4>
                <div className="space-y-4">
                  <ul className="list-disc space-y-2 pl-4">
                    <li>使用鼠标在空白处<strong className="font-medium text-primary">拖拽框选</strong>。</li>
                    <li>按住 <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-xs">Ctrl</kbd> 或 <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-xs">⌘</kbd> 并点击卡片，可添加或移除单项。</li>
                    <li>再次框选已选中的卡片会将其取消选中。</li>
                    <li>点击卡片外任意空白处可取消所有选择。</li>
                  </ul>
                </div>
              </section>
              <section>
                <h4 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Check className="h-4 w-4 text-subtle" />
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>选中一条或多条记录后，页面底部会出现操作栏，支持<strong className="font-medium text-muted">取消选择</strong>、<strong className="font-medium text-primary">全选当前可见记录</strong>、<strong className="font-medium text-warning">批量收藏</strong>、<strong className="font-medium text-success">批量下载</strong>，和<strong className="font-medium text-danger">批量删除</strong>。</p>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="flex justify-center border-t border-border pt-4">
          <a
            href="https://github.com/CookSleep/gpt_image_playground"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            <GithubIcon className="h-5 w-5 transition-transform group-hover:scale-110" />
            @CookSleep
          </a>
        </div>
      </div>
    </Overlay>,
    document.body,
  )
}
