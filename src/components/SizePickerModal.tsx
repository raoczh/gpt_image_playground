import { useMemo, useRef, useState } from 'react'
import { Zap, Info, X } from 'lucide-react'
import { calculateImageSize, normalizeImageSize, parseRatio, type SizeTier } from '../lib/size'
import { cn } from '../lib/cn'
import Overlay from './ui/Overlay'
import Button from './ui/Button'

const TIERS: SizeTier[] = ['1K', '2K', '4K']

const SIZE_LIMIT_TEXT = '宽高 16 的倍数 · 最大边 3840 · 比例 ≤ 3:1 · 总像素 655360-8294400'

const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400
const MAX_SIDE = 3840
const MIN_SIDE = 256
const MAX_RATIO = 3 // 长短边比例

function clampSize(rawW: number, rawH: number) {
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) {
    return { width: rawW, height: rawH, clamped: false }
  }

  let w = rawW
  let h = rawH

  const longest = Math.max(w, h)
  if (longest > MAX_SIDE) {
    const k = MAX_SIDE / longest
    w *= k
    h *= k
  }

  const shortest = Math.min(w, h)
  if (shortest < MIN_SIDE) {
    const k = MIN_SIDE / shortest
    w *= k
    h *= k
  }

  const ratio = Math.max(w, h) / Math.min(w, h)
  if (ratio > MAX_RATIO) {
    if (w > h) w = h * MAX_RATIO
    else h = w * MAX_RATIO
  }

  const pixels = w * h
  if (pixels > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / pixels)
    w *= k
    h *= k
  } else if (pixels < MIN_PIXELS) {
    const k = Math.sqrt(MIN_PIXELS / pixels)
    w *= k
    h *= k
  }

  const finalW = Math.round(w / 16) * 16
  const finalH = Math.round(h / 16) * 16
  const clamped = finalW !== Math.round(rawW / 16) * 16 || finalH !== Math.round(rawH / 16) * 16
  return { width: finalW, height: finalH, clamped }
}

const RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
]

interface Props {
  currentSize: string
  onSelect: (size: string) => void
  onClose: () => void
}

type Mode = 'auto' | 'ratio' | 'resolution'

function parseSize(size: string) {
  const match = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!match) return null
  return { width: match[1], height: match[2] }
}

function findPresetForSize(size: string) {
  const normalized = normalizeImageSize(size)
  for (const tier of TIERS) {
    for (const ratio of RATIOS) {
      if (calculateImageSize(tier, ratio.value) === normalized) {
        return { tier, ratio: ratio.value }
      }
    }
  }
  return null
}

export default function SizePickerModal({ currentSize, onSelect, onClose }: Props) {
  const currentPreset = findPresetForSize(currentSize)
  const currentParsedSize = parseSize(currentSize)
  const panelRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>(() => {
    if (!currentSize || currentSize === 'auto') return 'auto'
    if (currentPreset) return 'ratio'
    return 'resolution'
  })

  const [tier, setTier] = useState<SizeTier>(currentPreset?.tier ?? '1K')
  const [ratio, setRatio] = useState(currentPreset?.ratio ?? '1:1')
  const [customRatio, setCustomRatio] = useState('16:9')

  const [customW, setCustomW] = useState(currentParsedSize?.width ?? '1024')
  const [customH, setCustomH] = useState(currentParsedSize?.height ?? '1024')

  const activeRatio = ratio === 'custom' ? customRatio : ratio
  const customRatioValid = ratio !== 'custom' || Boolean(parseRatio(customRatio))

  const { previewSize, isClamped } = useMemo(() => {
    if (mode === 'auto') return { previewSize: 'auto', isClamped: false }

    if (mode === 'ratio') {
      const size = calculateImageSize(tier, activeRatio)
      return { previewSize: size ? normalizeImageSize(size) : '', isClamped: false }
    }

    if (mode === 'resolution') {
      const w = parseInt(customW, 10)
      const h = parseInt(customH, 10)
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        const c = clampSize(w, h)
        if (Number.isFinite(c.width) && Number.isFinite(c.height) && c.width > 0 && c.height > 0) {
          return { previewSize: `${c.width}x${c.height}`, isClamped: c.clamped }
        }
      }
      return { previewSize: '', isClamped: false }
    }

    return { previewSize: '', isClamped: false }
  }, [mode, tier, activeRatio, customW, customH])

  const applySize = () => {
    if (!previewSize) return
    onSelect(previewSize)
    onClose()
  }

  const presetClass = (active: boolean) =>
    cn(
      'rounded-lg border px-3 py-2 text-sm transition-colors',
      active
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border bg-surface text-muted hover:bg-surface-2',
    )

  const modeTab = (value: Mode, label: string) => (
    <button
      onClick={() => setMode(value)}
      className={cn(
        'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
        mode === value ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  )

  const resolutionInputClass = (valid: boolean) =>
    cn(
      'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors',
      valid ? 'border-border focus:border-primary' : 'border-danger focus:border-danger',
    )

  return (
    <Overlay open onClose={onClose} zClassName="z-[70]" scrollRef={panelRef}>
      <div
        ref={panelRef}
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-elevated p-5 shadow-xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">设置图像尺寸</h3>
            <p className="mt-1 text-xs text-subtle">当前：{currentSize || 'auto'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex rounded-lg bg-surface-2 p-1">
            {modeTab('auto', '自动')}
            {modeTab('ratio', '按比例')}
            {modeTab('resolution', '自定义宽高')}
          </div>

          <div className="min-h-[220px]">
            {mode === 'auto' && (
              <div className="flex h-full animate-fade-in items-center justify-center pt-8 pb-4 text-center">
                <div>
                  <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Zap className="h-6 w-6" />
                  </div>
                  <h4 className="text-sm font-medium text-foreground">自动尺寸</h4>
                  <p className="mt-1 text-xs text-subtle">不向模型传递具体的分辨率参数<br />由模型自己决定生成尺寸</p>
                </div>
              </div>
            )}

            {mode === 'ratio' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-2 text-xs font-medium text-subtle">基准分辨率</div>
                  <div className="grid grid-cols-3 gap-2">
                    {TIERS.map((item) => (
                      <button key={item} className={presetClass(tier === item)} onClick={() => setTier(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium text-subtle">图像比例</div>
                  <div className="grid grid-cols-4 gap-2">
                    {RATIOS.map((item) => (
                      <button key={item.value} className={presetClass(ratio === item.value)} onClick={() => setRatio(item.value)}>
                        {item.label}
                      </button>
                    ))}
                    <button className={cn(presetClass(ratio === 'custom'), 'col-span-4')} onClick={() => setRatio('custom')}>
                      自定义比例
                    </button>
                  </div>
                </section>

                {ratio === 'custom' && (
                  <label className="block animate-fade-in">
                    <span className="mb-2 block text-xs font-medium text-subtle">输入自定义比例</span>
                    <input
                      value={customRatio}
                      onChange={(e) => setCustomRatio(e.target.value)}
                      placeholder="例如 5:4 / 2.39:1"
                      className={resolutionInputClass(customRatioValid)}
                    />
                  </label>
                )}
              </div>
            )}

            {mode === 'resolution' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-4 text-xs font-medium text-subtle">输入具体像素值</div>
                  <div className="flex items-center gap-4">
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-muted">宽度 (Width)</span>
                      <input
                        type="number"
                        value={customW}
                        onChange={(e) => setCustomW(e.target.value)}
                        className={resolutionInputClass(true)}
                        placeholder="例如 1024"
                      />
                    </label>
                    <div className="mt-5 text-subtle">
                      <X className="h-4 w-4" />
                    </div>
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-muted">高度 (Height)</span>
                      <input
                        type="number"
                        value={customH}
                        onChange={(e) => setCustomH(e.target.value)}
                        className={resolutionInputClass(true)}
                        placeholder="例如 1024"
                      />
                    </label>
                  </div>
                </section>
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 text-xs text-primary">
                  <p className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>由于模型限制，最终输出将被自动规整到 16 的倍数。</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-surface-2 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-subtle">将使用</div>
              {isClamped && (
                <span
                  className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                  title={SIZE_LIMIT_TEXT}
                >
                  已自动调整
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">
              {previewSize || '尺寸无效'}
            </div>
          </div>
          <div className="text-[10px] leading-relaxed text-subtle">
            限制：{SIZE_LIMIT_TEXT}
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="subtle" className="flex-1 py-2.5" onClick={onClose}>
            取消
          </Button>
          <Button className="flex-1 py-2.5" onClick={applySize} disabled={!previewSize}>
            确定
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
