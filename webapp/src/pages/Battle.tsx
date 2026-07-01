import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { SkeletonCard } from '../components/ui'
import { api } from '../lib/api'
import type { BattleEntry } from '../lib/api'
import a11yToast from '../lib/a11yToast'

function formatUsd(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)
}

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  if (diffMs <= 0) return 'Expired'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m left`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m left`
}

function statusLabel(battle: BattleEntry): { text: string; color: string } {
  if (battle.status === 'open') return { text: 'Open', color: 'text-blue-600 bg-blue-50' }
  if (battle.outcome === 'win') return { text: 'Won', color: 'text-green-600 bg-green-50' }
  if (battle.outcome === 'loss') return { text: 'Lost', color: 'text-red-500 bg-red-50' }
  return { text: 'Cancelled', color: 'text-suwappu-text-secondary bg-suwappu-sakura-light' }
}

const BACKING_INFO: Record<string, string> = {
  perps: 'Uses your Hyperliquid perps balance as collateral. Higher potential returns.',
  prediction: 'Uses your Polymarket prediction balance. Lower risk, lower reward.',
}

export function Battle() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Form state
  const [market, setMarket] = useState('')
  const [direction, setDirection] = useState<'up' | 'down' | ''>('')
  const [stakeUsd, setStakeUsd] = useState('')
  const [backing, setBacking] = useState<'perps' | 'prediction'>('perps')
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null)

  // Fetch config
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['battle', 'config'],
    queryFn: () => api.getBattleConfig(),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch battle list
  const { data: battles, isLoading: battlesLoading } = useQuery({
    queryKey: ['battle', 'list'],
    queryFn: () => api.getBattleList(),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  })

  // Set defaults once config loads
  const handleConfigLoad = (cfg: typeof config) => {
    if (!cfg) return
    if (!market && cfg.markets.length > 0) setMarket(cfg.markets[0])
    if (durationMinutes === null && cfg.durations_minutes.length > 0) setDurationMinutes(cfg.durations_minutes[0])
  }
  if (config && !market) handleConfigLoad(config)

  // Open battle mutation
  const openMutation = useMutation({
    mutationFn: () => {
      if (!direction || !stakeUsd || !market || !durationMinutes) throw new Error('Fill all fields')
      return api.openBattle({
        market,
        direction,
        stake_usd: parseFloat(stakeUsd),
        backing,
        duration_minutes: durationMinutes,
      })
    },
    onSuccess: () => {
      a11yToast.success('Battle opened! Stake debited from your balance.')
      queryClient.invalidateQueries({ queryKey: ['battle', 'list'] })
      setDirection('')
      setStakeUsd('')
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: string })?.detail || 'Could not open battle. Try again.'
      if (detail.toLowerCase().includes('insufficient') || detail.toLowerCase().includes('balance')) {
        a11yToast.error('Insufficient balance. Top up your wallet and try again.')
      } else if (detail.toLowerCase().includes('cap') || detail.toLowerCase().includes('max')) {
        a11yToast.error(`Maximum ${config?.max_open ?? 5} open battles reached. Close one before opening another.`)
      } else {
        a11yToast.error(detail)
      }
    },
  })

  const canSubmit =
    !!market &&
    !!direction &&
    !!stakeUsd &&
    parseFloat(stakeUsd) > 0 &&
    !!durationMinutes &&
    !openMutation.isPending

  const openBattles = battles?.filter((b) => b.status === 'open') ?? []
  const recentBattles = battles?.filter((b) => b.status !== 'open') ?? []
  const multiplier = config?.multiplier ?? 2

  return (
    <AppLayout
      header={<AppHeader title="Battle" showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-24 space-y-3">

        {/* Hero / explainer */}
        <div className="bg-gradient-suwappu rounded-suwappu-xl p-4 text-white">
          <p className="font-heading font-bold text-lg leading-tight mb-1">Crypto Battle</p>
          <p className="text-xs opacity-90 leading-snug">
            Pick a direction — UP or DOWN — for a market. Win and earn up to{' '}
            <span className="font-bold">{multiplier}x</span> your stake. Lose and forfeit the stake.
          </p>
          <p className="text-[10px] opacity-70 mt-1">Stake is debited immediately on open.</p>
        </div>

        {/* Loading config skeleton */}
        {configLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={4} variant="token" />
          </div>
        )}

        {/* Open battle form */}
        {config && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4 space-y-4">
            <p className="font-heading font-semibold text-sm text-suwappu-purple-deep">Open a Battle</p>

            {/* Market picker */}
            <div>
              <label className="block text-xs text-suwappu-text-secondary mb-1.5">Market</label>
              <div className="flex flex-wrap gap-2">
                {config.markets.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarket(m)}
                    className={`px-3 py-1.5 rounded-suwappu-pill text-xs font-semibold border transition-colors ${
                      market === m
                        ? 'bg-suwappu-purple-deep text-white border-suwappu-purple-deep'
                        : 'bg-white text-suwappu-text border-suwappu-sakura-mid hover:bg-suwappu-sakura-light'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Direction buttons */}
            <div>
              <label className="block text-xs text-suwappu-text-secondary mb-1.5">Direction</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDirection('up')}
                  className={`py-4 rounded-suwappu-xl text-base font-heading font-bold transition-all border-2 ${
                    direction === 'up'
                      ? 'bg-green-500 text-white border-green-500 shadow-md scale-[1.02]'
                      : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                  }`}
                >
                  UP
                </button>
                <button
                  onClick={() => setDirection('down')}
                  className={`py-4 rounded-suwappu-xl text-base font-heading font-bold transition-all border-2 ${
                    direction === 'down'
                      ? 'bg-red-500 text-white border-red-500 shadow-md scale-[1.02]'
                      : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                  }`}
                >
                  DOWN
                </button>
              </div>
            </div>

            {/* Stake input */}
            <div>
              <label className="block text-xs text-suwappu-text-secondary mb-1.5">Stake (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 10.00"
                value={stakeUsd}
                onChange={(e) => setStakeUsd(e.target.value)}
                className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2.5 text-sm font-heading font-semibold outline-none placeholder:text-suwappu-text-secondary/60 border border-transparent focus:border-suwappu-purple-deep/30"
              />
              {stakeUsd && parseFloat(stakeUsd) > 0 && (
                <p className="text-[10px] text-suwappu-text-secondary mt-1">
                  {backing === 'prediction' ? (
                    <>Win: +{formatUsd(parseFloat(stakeUsd) * (multiplier - 1))} profit</>
                  ) : (
                    <>Win: profit depends on price move (up to ~{formatUsd(parseFloat(stakeUsd) * (multiplier - 1))})</>
                  )}
                  &nbsp;·&nbsp;
                  Lose: -{formatUsd(parseFloat(stakeUsd))}
                </p>
              )}
            </div>

            {/* Duration picker */}
            <div>
              <label className="block text-xs text-suwappu-text-secondary mb-1.5">Duration</label>
              <div className="flex flex-wrap gap-2">
                {config.durations_minutes.map((d) => {
                  const label = d < 60 ? `${d}m` : `${d / 60}h`
                  return (
                    <button
                      key={d}
                      onClick={() => setDurationMinutes(d)}
                      className={`px-3 py-1.5 rounded-suwappu-pill text-xs font-semibold border transition-colors ${
                        durationMinutes === d
                          ? 'bg-suwappu-magenta-mid text-white border-suwappu-magenta-mid'
                          : 'bg-white text-suwappu-text border-suwappu-sakura-mid hover:bg-suwappu-sakura-light'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Backing toggle */}
            <div>
              <label className="block text-xs text-suwappu-text-secondary mb-1.5">Back with</label>
              <div className="flex gap-2">
                {(config.backings as Array<'perps' | 'prediction'>).map((b) => (
                  <button
                    key={b}
                    onClick={() => setBacking(b)}
                    className={`flex-1 py-2 rounded-suwappu-lg text-xs font-semibold border capitalize transition-colors ${
                      backing === b
                        ? 'bg-suwappu-purple-deep/10 text-suwappu-purple-deep border-suwappu-purple-deep/40'
                        : 'bg-white text-suwappu-text border-suwappu-sakura-mid hover:bg-suwappu-sakura-light'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-suwappu-text-secondary mt-1.5 leading-snug">
                {BACKING_INFO[backing] ?? ''}
              </p>
            </div>

            {/* Open button */}
            <button
              onClick={() => openMutation.mutate()}
              disabled={!canSubmit}
              className={`w-full py-3.5 rounded-suwappu-pill font-heading font-bold text-sm transition-all ${
                canSubmit
                  ? 'bg-suwappu-gradient text-white shadow-suwappu-button active:scale-95'
                  : 'bg-suwappu-sakura-light text-suwappu-text-secondary cursor-not-allowed'
              }`}
            >
              {openMutation.isPending ? 'Opening...' : `Open Battle · ${multiplier}x win`}
            </button>

            {/* Cap warning */}
            {config.max_open > 0 && openBattles.length >= config.max_open && (
              <p className="text-xs text-suwappu-error text-center">
                You have reached the maximum of {config.max_open} open battles.
              </p>
            )}
          </div>
        )}

        {/* Open battles */}
        {battlesLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={3} variant="token" />
          </div>
        )}

        {openBattles.length > 0 && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
              <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Open Battles</span>
              <span className="text-[10px] text-suwappu-text-secondary">{openBattles.length} / {config?.max_open ?? '—'}</span>
            </div>
            <div className="divide-y divide-suwappu-sakura-light/50">
              {openBattles.map((b) => {
                const s = statusLabel(b)
                return (
                  <div key={b.id} className="flex items-center justify-between p-3">
                    <div>
                      <p className="font-heading font-semibold text-sm text-suwappu-text">
                        {b.market} <span className={b.direction === 'up' ? 'text-green-600' : 'text-red-500'}>{b.direction === 'up' ? 'UP' : 'DOWN'}</span>
                      </p>
                      <p className="text-[10px] text-suwappu-text-secondary capitalize">
                        {b.backing} · {formatExpiry(b.expiry_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-heading font-semibold text-sm text-suwappu-text">{formatUsd(b.stake_usd)}</p>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${s.color}`}>{s.text}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Recent battles */}
        {recentBattles.length > 0 && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
              <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Recent Battles</span>
            </div>
            <div className="divide-y divide-suwappu-sakura-light/50">
              {recentBattles.map((b) => {
                const s = statusLabel(b)
                return (
                  <div key={b.id} className="flex items-center justify-between p-3">
                    <div>
                      <p className="font-heading font-semibold text-sm text-suwappu-text">
                        {b.market} <span className={b.direction === 'up' ? 'text-green-600' : 'text-red-500'}>{b.direction === 'up' ? 'UP' : 'DOWN'}</span>
                      </p>
                      <p className="text-[10px] text-suwappu-text-secondary capitalize">{b.backing}</p>
                    </div>
                    <div className="text-right">
                      {b.pnl_usd !== null ? (
                        <p className={`font-heading font-semibold text-sm ${b.pnl_usd >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {b.pnl_usd >= 0 ? '+' : ''}{formatUsd(b.pnl_usd)}
                        </p>
                      ) : (
                        <p className="font-heading font-semibold text-sm text-suwappu-text">{formatUsd(b.stake_usd)}</p>
                      )}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${s.color}`}>{s.text}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!battlesLoading && (!battles || battles.length === 0) && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-2">⚔️</span>
            <p className="font-heading font-semibold text-suwappu-text mb-1">No battles yet</p>
            <p className="text-xs text-suwappu-text-secondary">Open your first battle above</p>
          </div>
        )}

        {/* Info */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-text-secondary">
            Battle outcomes are settled against real market prices at expiry. Backed by Hyperliquid perps
            or Polymarket prediction markets. Only stake what you can afford to lose.
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
