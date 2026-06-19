import { useEffect, useState } from 'react'
import type { HLMarket } from '../types/api'
import type { FundingInfo } from '../types/perps'

// HyperLiquid pays funding once per hour, on the hour (UTC). The funding RATE
// itself is real (HLMarket.fundingRate, the hourly rate as a decimal); the
// next-funding COUNTDOWN is derived from this fixed schedule + the wall clock,
// not invented. So nothing here is a fake number — it's the live rate plus the
// real cadence.

const HOUR_MS = 60 * 60 * 1000

function msUntilNextHour(now = Date.now()): number {
  return HOUR_MS - (now % HOUR_MS)
}

// Pure derivation from a market's real fundingRate field. Safe to call in render.
export function deriveFundingInfo(market: HLMarket | undefined, now = Date.now()): FundingInfo {
  const hourlyRate = market?.fundingRate ?? 0
  return {
    hourlyRate,
    annualizedRate: hourlyRate * 24 * 365,
    msUntilNextFunding: msUntilNextHour(now),
  }
}

// Live funding info for a single market: the rate comes from the (already
// fetched) market object; the countdown ticks every second so the next-funding
// timer stays accurate without re-fetching markets.
export function usePerpsFunding(market: HLMarket | undefined): FundingInfo {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  return deriveFundingInfo(market, now)
}

// "12m 34s" style formatter for the countdown.
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

// Funding rate as a signed percentage string, e.g. "+0.0013%".
export function formatFundingPct(rate: number): string {
  const pct = rate * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(4)}%`
}
