import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

const CARD_WIDTH = 640
const CARD_HEIGHT = 360
const UP_COLOR = '#2FBF71'
const DOWN_COLOR = '#E5484D'

type Timeframe = '24h' | 'all'

interface PnlShareCardProps {
  isOpen: boolean
  onClose: () => void
  /** Current total portfolio value in USD (real, from usePortfolio). */
  totalValueUsd: number
  /** Realized PnL over the last 24h, or null when there's no priced trade in that window. */
  pnl24hUsd: number | null
  pnl24hPercent: number | null
  /** All-time realized PnL from swap history, or null when there's no trade history yet. */
  pnlAllTimeUsd: number | null
  pnlAllTimePercent: number | null
}

function formatUsdSigned(value: number): string {
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}$${abs}`
}

function drawCard(
  canvas: HTMLCanvasElement,
  data: { timeframeLabel: string; pnlUsd: number; pnlPercent: number | null; totalValueUsd: number },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height

  // Near-black base
  ctx.fillStyle = '#08090C'
  ctx.fillRect(0, 0, W, H)

  // Persimmon "breath" — a soft radial glow, top-right, matching the shell doctrine.
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.05, 0, W * 0.8, H * 0.05, W * 0.75)
  glow.addColorStop(0, 'rgba(229,141,43,0.14)')
  glow.addColorStop(1, 'rgba(229,141,43,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Hairline frame
  ctx.strokeStyle = 'rgba(236,237,239,0.13)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

  const isUp = data.pnlUsd >= 0
  const color = isUp ? UP_COLOR : DOWN_COLOR
  const glyph = isUp ? '▲' : '▼'

  // Wordmark
  ctx.fillStyle = '#E58D2B'
  ctx.font = '600 24px Geist, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('SUWAPPU', 32, 52)

  ctx.fillStyle = 'rgba(155,161,171,1)'
  ctx.font = '500 12px "JetBrains Mono", monospace'
  ctx.fillText('PORTFOLIO PNL', 32, 72)

  // Timeframe chip, top-right
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(236,237,239,0.75)'
  ctx.font = '500 12px "JetBrains Mono", monospace'
  ctx.fillText(data.timeframeLabel.toUpperCase(), W - 32, 52)
  ctx.fillStyle = 'rgba(107,114,128,1)'
  ctx.fillText('terminal.suwappu.bot', W - 32, 72)
  ctx.textAlign = 'left'

  // Hero % figure
  ctx.fillStyle = color
  ctx.font = '600 64px Geist, sans-serif'
  const pctText =
    data.pnlPercent !== null
      ? `${glyph} ${data.pnlPercent > 0 ? '+' : ''}${data.pnlPercent.toFixed(2)}%`
      : `${glyph} n/a %`
  ctx.fillText(pctText, 32, 190)

  // $ amount, mono
  ctx.font = '600 34px "JetBrains Mono", monospace'
  ctx.fillStyle = color
  ctx.fillText(formatUsdSigned(data.pnlUsd), 32, 235)

  // Divider hairline
  ctx.strokeStyle = 'rgba(236,237,239,0.07)'
  ctx.beginPath()
  ctx.moveTo(32, 268)
  ctx.lineTo(W - 32, 268)
  ctx.stroke()

  // Portfolio value caption
  ctx.fillStyle = 'rgba(155,161,171,1)'
  ctx.font = '500 12px "JetBrains Mono", monospace'
  ctx.fillText('PORTFOLIO VALUE', 32, 296)
  ctx.fillStyle = '#ECEDEF'
  ctx.font = '600 18px "JetBrains Mono", monospace'
  ctx.fillText(
    `$${data.totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    32,
    320,
  )

  // Footer
  ctx.fillStyle = 'rgba(107,114,128,1)'
  ctx.font = '500 11px "JetBrains Mono", monospace'
  ctx.textAlign = 'right'
  ctx.fillText('Not financial advice · realized PnL', W - 32, H - 24)
  ctx.textAlign = 'left'
}

export function PnlShareCard({
  isOpen,
  onClose,
  totalValueUsd,
  pnl24hUsd,
  pnl24hPercent,
  pnlAllTimeUsd,
  pnlAllTimePercent,
}: PnlShareCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>(pnlAllTimeUsd !== null ? 'all' : '24h')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const activeUsd = timeframe === '24h' ? pnl24hUsd : pnlAllTimeUsd
  const activePercent = timeframe === '24h' ? pnl24hPercent : pnlAllTimePercent
  const hasData = activeUsd !== null

  useEffect(() => {
    if (!isOpen) return
    setCopyState('idle')
  }, [isOpen, timeframe])

  useEffect(() => {
    if (!isOpen || !canvasRef.current || !hasData) return
    const canvas = canvasRef.current
    const render = () =>
      drawCard(canvas, {
        timeframeLabel: timeframe === '24h' ? '24H' : 'ALL-TIME',
        pnlUsd: activeUsd ?? 0,
        pnlPercent: activePercent,
        totalValueUsd,
      })
    // Fonts requested in index.html may still be downloading; redraw once
    // they're ready so the export doesn't silently fall back to a system font.
    if (document.fonts?.ready) {
      render()
      document.fonts.ready.then(render).catch(() => {})
    } else {
      render()
    }
  }, [isOpen, hasData, timeframe, activeUsd, activePercent, totalValueUsd])

  if (!isOpen) return null

  const toBlob = (): Promise<Blob | null> =>
    new Promise(resolve => {
      const canvas = canvasRef.current
      if (!canvas) {
        resolve(null)
        return
      }
      canvas.toBlob(blob => resolve(blob), 'image/png')
    })

  const handleDownload = async () => {
    const blob = await toBlob()
    if (!blob) {
      toast.error('Could not generate the image — try again.')
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `suwappu-pnl-${timeframe}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleCopy = async () => {
    const blob = await toBlob()
    if (!blob) {
      toast.error('Could not generate the image — try again.')
      return
    }
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        throw new Error('Clipboard image API unavailable')
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopyState('copied')
      toast.success('PnL card copied to clipboard')
    } catch {
      setCopyState('failed')
      await handleDownload()
      toast('Clipboard copy isn’t supported here — downloaded instead.')
    }
  }

  return (
    <div
      className="terminal-theme-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share PnL card"
    >
      <div
        className="terminal-theme-overlay w-full max-w-[680px] p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-terminal-text">Share PnL</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-terminal-text-muted hover:text-terminal-text"
            aria-label="Close share dialog"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTimeframe('24h')}
            disabled={pnl24hUsd === null}
            className={`terminal-tab text-xs ${timeframe === '24h' ? 'terminal-tab-active' : ''} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            24h
          </button>
          <button
            type="button"
            onClick={() => setTimeframe('all')}
            disabled={pnlAllTimeUsd === null}
            className={`terminal-tab text-xs ${timeframe === 'all' ? 'terminal-tab-active' : ''} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            All-Time
          </button>
        </div>

        <div className="hairline overflow-hidden rounded-terminal-card">
          {hasData ? (
            <canvas
              ref={canvasRef}
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
              className="block w-full"
              style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
              role="img"
              aria-label="Portfolio PnL share card preview"
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-terminal-text-muted">
              Not enough trade history yet for this window.
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!hasData}
            className="terminal-button-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copyState === 'copied' ? 'Copied!' : 'Copy image'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!hasData}
            className="terminal-button text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            Download PNG
          </button>
        </div>
      </div>
    </div>
  )
}
