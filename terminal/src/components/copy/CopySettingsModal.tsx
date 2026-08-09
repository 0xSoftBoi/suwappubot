import { useState, useEffect } from 'react'
import type { FollowSettings, CopyMode } from '../../types/api'

const CHAINS = [
  { id: 'ethereum', label: 'ETH' },
  { id: 'arbitrum', label: 'ARB' },
  { id: 'base', label: 'BASE' },
  { id: 'optimism', label: 'OP' },
  { id: 'polygon', label: 'POL' },
  { id: 'bsc', label: 'BSC' },
  { id: 'avalanche', label: 'AVAX' },
  { id: 'solana', label: 'SOL' },
]

const DEFAULT_CHAINS = CHAINS.map(chain => chain.id)

interface CopySettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (settings: FollowSettings) => void
  initialSettings?: FollowSettings
  traderName?: string
  autoCopyAvailable?: boolean
}

export function CopySettingsModal({
  isOpen,
  onClose,
  onSave,
  initialSettings,
  traderName,
  autoCopyAvailable = true,
}: CopySettingsModalProps) {
  const [copyMode, setCopyMode] = useState<CopyMode>(initialSettings?.copyMode || 'notify')
  const [fixedAmount, setFixedAmount] = useState(initialSettings?.fixedAmount?.toString() || '100')
  const [percentageAmount, setPercentageAmount] = useState(initialSettings?.percentageAmount?.toString() || '10')
  const [maxPerTrade, setMaxPerTrade] = useState(initialSettings?.maxPerTrade?.toString() || '500')
  const [dailyLimit, setDailyLimit] = useState(initialSettings?.dailyLimit?.toString() || '2000')
  const [chainFilter, setChainFilter] = useState<string[]>(initialSettings?.chainFilter || DEFAULT_CHAINS)
  const [maxSlippage, setMaxSlippage] = useState(initialSettings?.maxSlippage?.toString() || '1')

  useEffect(() => {
    if (!isOpen) return
    const requestedMode = initialSettings?.copyMode || 'notify'
    setCopyMode(autoCopyAvailable ? requestedMode : 'notify')
    setFixedAmount(initialSettings?.fixedAmount?.toString() || '100')
    setPercentageAmount(initialSettings?.percentageAmount?.toString() || '10')
    setMaxPerTrade(initialSettings?.maxPerTrade?.toString() || '500')
    setDailyLimit(initialSettings?.dailyLimit?.toString() || '2000')
    setChainFilter(initialSettings?.chainFilter || DEFAULT_CHAINS)
    setMaxSlippage(initialSettings?.maxSlippage?.toString() || '1')
  }, [autoCopyAvailable, initialSettings, isOpen])

  if (!isOpen) return null

  const toggleChain = (chainId: string) => {
    setChainFilter(prev =>
      prev.includes(chainId) ? prev.filter(c => c !== chainId) : [...prev, chainId]
    )
  }

  const handleSave = () => {
    if (copyMode !== 'notify' && chainFilter.length === 0) return
    onSave({
      copyMode,
      fixedAmount: parseFloat(fixedAmount) || undefined,
      percentageAmount: parseFloat(percentageAmount) || undefined,
      maxPerTrade: parseFloat(maxPerTrade) || undefined,
      dailyLimit: parseFloat(dailyLimit) || undefined,
      chainFilter,
      maxSlippage: parseFloat(maxSlippage) || undefined,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-settings-title"
        className="bg-terminal-panel border border-terminal-border rounded-xl w-full max-w-md max-h-[85vh] overflow-auto p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="copy-settings-title" className="text-sm font-semibold text-terminal-text">
            {traderName ? `Copy Settings — ${traderName}` : 'Copy Settings'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close copy settings"
            className="text-terminal-text-muted hover:text-terminal-text text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Copy Mode */}
        <div>
          <label className="text-xs text-terminal-text-secondary mb-2 block">Copy Mode</label>
          <div className="space-y-1.5">
            {([
              { value: 'notify' as CopyMode, label: 'Follow + alerts', desc: 'See this trader\'s moves and review each trade yourself' },
              { value: 'fixed' as CopyMode, label: 'Auto-copy fixed · Pro', desc: 'Copy every eligible trade with a fixed USD amount' },
              { value: 'percentage' as CopyMode, label: 'Auto-copy percentage · Pro', desc: 'Copy a percentage of the trader\'s size' },
            ]).map(mode => (
              <label
                key={mode.value}
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  copyMode === mode.value
                    ? 'border-sakura-600 bg-sakura-900/10'
                    : mode.value !== 'notify' && !autoCopyAvailable
                      ? 'border-terminal-border opacity-45 cursor-not-allowed'
                      : 'border-terminal-border hover:border-terminal-border-active'
                }`}
              >
                <input
                  type="radio"
                  name="copyMode"
                  value={mode.value}
                  checked={copyMode === mode.value}
                  disabled={mode.value !== 'notify' && !autoCopyAvailable}
                  onChange={() => setCopyMode(mode.value)}
                  className="mt-0.5 accent-sakura-500"
                />
                <div>
                  <div className="text-xs font-semibold text-terminal-text">{mode.label}</div>
                  <div className="text-[10px] text-terminal-text-muted">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {!autoCopyAvailable && (
          <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-[10px] leading-relaxed text-terminal-text-muted">
            Automatic copy requires a Pro account with a Suwappu signing wallet. External wallets can still follow signals and sign trades themselves.
          </div>
        )}

        {/* Amount input (conditional) */}
        {copyMode === 'fixed' && (
          <div>
            <label className="text-xs text-terminal-text-secondary mb-1 block">Fixed Amount (USD)</label>
            <input
              type="text"
              value={fixedAmount}
              onChange={e => setFixedAmount(e.target.value)}
              placeholder="100"
              className="terminal-input w-full font-mono"
            />
          </div>
        )}
        {copyMode === 'percentage' && (
          <div>
            <label className="text-xs text-terminal-text-secondary mb-1 block">Percentage (%)</label>
            <input
              type="text"
              value={percentageAmount}
              onChange={e => setPercentageAmount(e.target.value)}
              placeholder="10"
              className="terminal-input w-full font-mono"
            />
          </div>
        )}

        {/* Max per trade */}
        {copyMode !== 'notify' && (
          <>
            <div className="rounded-lg border border-terminal-warn/30 bg-terminal-warn/5 px-3 py-2 text-[10px] leading-relaxed text-terminal-text-muted">
              Auto-copy requires active Pro and a Suwappu signing wallet, and can lose money. Your max-per-trade, daily limit, chain filter, and slippage cap are enforced before each copy attempt.
            </div>
            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Max Per Trade (USD)</label>
              <input
                type="text"
                value={maxPerTrade}
                onChange={e => setMaxPerTrade(e.target.value)}
                placeholder="500"
                className="terminal-input w-full font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Daily Limit (USD)</label>
              <input
                type="text"
                value={dailyLimit}
                onChange={e => setDailyLimit(e.target.value)}
                placeholder="2000"
                className="terminal-input w-full font-mono"
              />
            </div>

            {/* Max Slippage */}
            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Max Slippage (%)</label>
              <input
                type="text"
                value={maxSlippage}
                onChange={e => setMaxSlippage(e.target.value)}
                placeholder="1"
                className="terminal-input w-full font-mono"
              />
            </div>
          </>
        )}

        {/* Chain filter */}
        <div>
          <label className="text-xs text-terminal-text-secondary mb-2 block">Chain Filter</label>
          <div className="flex flex-wrap gap-2">
            {CHAINS.map(chain => (
              <label
                key={chain.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded border cursor-pointer text-xs transition-colors ${
                  chainFilter.includes(chain.id)
                    ? 'border-sakura-600 bg-sakura-900/10 text-terminal-text'
                    : 'border-terminal-border text-terminal-text-muted hover:border-terminal-border-active'
                }`}
              >
                <input
                  type="checkbox"
                  checked={chainFilter.includes(chain.id)}
                  onChange={() => toggleChain(chain.id)}
                  className="accent-sakura-500 w-3 h-3"
                />
                {chain.label}
              </label>
            ))}
          </div>
          {copyMode !== 'notify' && chainFilter.length === 0 && (
            <p className="mt-1.5 text-[10px] text-bear">Select at least one chain for automatic copy.</p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded text-sm font-semibold bg-terminal-bg-tertiary border border-terminal-border text-terminal-text-secondary hover:text-terminal-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={copyMode !== 'notify' && chainFilter.length === 0}
            className="flex-1 py-2.5 rounded text-sm font-semibold bg-sakura-600 hover:bg-sakura-700 text-terminal-on-accent transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
