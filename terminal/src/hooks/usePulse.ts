import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { PulseToken, PulseFilters } from '../types/api'

type PulseStage = 'new' | 'final_stretch' | 'migrated'

const TOKEN_NAMES = [
  ['PEPE', 'Pepe Token'], ['DOGE2', 'Doge 2.0'], ['SHIB2', 'Shiba Inu V2'],
  ['MEME', 'Meme Coin'], ['WOJAK', 'Wojak'], ['MOON', 'MoonShot'],
  ['FROG', 'FrogSwap'], ['CHAD', 'Chad Token'], ['APE', 'ApeX'],
  ['BOME', 'Book of Meme'], ['WIF', 'Dogwifhat'], ['BONK', 'BonkSwap'],
  ['FLOKI2', 'Floki V2'], ['NEET', 'NEET Protocol'], ['SMOL', 'SmolBrain'],
  ['TURBO', 'Turbo Token'], ['MFER', 'mfer coin'], ['GIGA', 'GigaChad'],
  ['COPE', 'Cope Token'], ['NGMI', 'Not Gonna Make It'],
  ['WAGMI', 'We All Gonna Make It'], ['LAMBO', 'Lambo Finance'],
  ['HODL', 'HodlVault'], ['PUMP', 'PumpFun Token'], ['SNEK', 'Snek Protocol'],
  ['SILLY', 'SillyGoose'], ['RIZZ', 'Rizz Token'], ['BASED', 'Based Protocol'],
  ['SIGMA', 'Sigma Grindset'], ['ALPHA', 'Alpha Drops'],
]

const CHAINS = ['ethereum', 'solana', 'base', 'arbitrum', 'bsc']

function randomAddr(): string {
  const chars = '0123456789abcdef'
  let addr = '0x'
  for (let i = 0; i < 40; i++) addr += chars[Math.floor(Math.random() * 16)]
  return addr
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function generateToken(stage: PulseStage, ageOffsetMs?: number): PulseToken {
  const [symbol, name] = TOKEN_NAMES[Math.floor(Math.random() * TOKEN_NAMES.length)]
  const suffix = Math.floor(Math.random() * 999)
  const chain = CHAINS[Math.floor(Math.random() * CHAINS.length)]

  let ageMs: number
  let marketCap: number
  let volume: number
  let holders: number
  let liquidity: number
  let bondingProgress: number | undefined

  if (stage === 'new') {
    ageMs = ageOffsetMs ?? randomBetween(5_000, 300_000)
    marketCap = randomBetween(1_000, 100_000)
    volume = randomBetween(100, 50_000)
    holders = Math.floor(randomBetween(2, 50))
    liquidity = randomBetween(500, 30_000)
  } else if (stage === 'final_stretch') {
    ageMs = ageOffsetMs ?? randomBetween(300_000, 3_600_000)
    marketCap = randomBetween(50_000, 500_000)
    volume = randomBetween(10_000, 200_000)
    holders = Math.floor(randomBetween(30, 300))
    liquidity = randomBetween(10_000, 100_000)
    bondingProgress = randomBetween(70, 99)
  } else {
    ageMs = ageOffsetMs ?? randomBetween(60_000, 7_200_000)
    marketCap = randomBetween(100_000, 5_000_000)
    volume = randomBetween(50_000, 1_000_000)
    holders = Math.floor(randomBetween(100, 2000))
    liquidity = randomBetween(50_000, 500_000)
  }

  const createdAt = new Date(Date.now() - ageMs).toISOString()

  const trustScore = Math.floor(randomBetween(40, 98))
  const riskLevel: 'safe' | 'caution' | 'danger' = trustScore >= 80 ? 'safe' : trustScore >= 50 ? 'caution' : 'danger'
  const isBundled = Math.random() < 0.1
  const bundleCount = isBundled ? Math.floor(randomBetween(2, 9)) : undefined

  return {
    address: randomAddr(),
    symbol: `${symbol}${suffix}`,
    name: `${name} #${suffix}`,
    chain,
    stage,
    createdAt,
    marketCap,
    volume24h: volume,
    holders,
    topHolderPercent: randomBetween(5, 80),
    devPercent: randomBetween(0, 40),
    sniperPercent: randomBetween(0, 35),
    bondingProgress,
    liquidityUsd: liquidity,
    priceUsd: randomBetween(0.000001, 0.01),
    priceChange5m: randomBetween(-50, 200),
    trustScore,
    riskLevel,
    isBundled,
    bundleCount,
    priceChange1h: randomBetween(-30, 150),
    priceChange6h: randomBetween(-40, 300),
    priceChange24h: randomBetween(-60, 500),
  }
}

function generateBatch(stage: PulseStage, count: number): PulseToken[] {
  return Array.from({ length: count }, () => generateToken(stage))
}

const DEFAULT_FILTERS: PulseFilters = {
  minMarketCap: null,
  maxMarketCap: null,
  minLiquidity: null,
  maxTopHolderPercent: null,
  maxDevPercent: null,
  maxSniperPercent: null,
  minHolders: null,
}

function applyFilters(tokens: PulseToken[], filters: PulseFilters): PulseToken[] {
  return tokens.filter(t => {
    if (filters.minMarketCap !== null && t.marketCap < filters.minMarketCap) return false
    if (filters.maxMarketCap !== null && t.marketCap > filters.maxMarketCap) return false
    if (filters.minLiquidity !== null && t.liquidityUsd < filters.minLiquidity) return false
    if (filters.maxTopHolderPercent !== null && t.topHolderPercent > filters.maxTopHolderPercent) return false
    if (filters.maxDevPercent !== null && t.devPercent > filters.maxDevPercent) return false
    if (filters.maxSniperPercent !== null && t.sniperPercent > filters.maxSniperPercent) return false
    if (filters.minHolders !== null && t.holders < filters.minHolders) return false
    return true
  })
}

export function usePulse() {
  const [activeStage, setActiveStage] = useState<PulseStage>('new')
  const [filters, setFilters] = useState<PulseFilters>(DEFAULT_FILTERS)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [newTokens, setNewTokens] = useState<PulseToken[]>(() => generateBatch('new', 15))
  const [finalStretchTokens, setFinalStretchTokens] = useState<PulseToken[]>(() => generateBatch('final_stretch', 12))
  const [migratedTokens, setMigratedTokens] = useState<PulseToken[]>(() => generateBatch('migrated', 10))
  const [lastUpdated, setLastUpdated] = useState(Date.now())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-refresh every 5 seconds — add new tokens to front, trim old ones
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setNewTokens(prev => [generateToken('new', randomBetween(1_000, 15_000)), ...prev].slice(0, 30))
      setFinalStretchTokens(prev => {
        // Occasionally add a new one, always bump progress on existing
        const updated = prev.map(t => ({
          ...t,
          bondingProgress: Math.min(99.9, (t.bondingProgress ?? 70) + randomBetween(0.1, 2)),
          holders: t.holders + Math.floor(randomBetween(0, 5)),
          volume24h: t.volume24h + randomBetween(100, 5000),
        }))
        if (Math.random() > 0.5) {
          return [generateToken('final_stretch'), ...updated].slice(0, 20)
        }
        return updated
      })
      setMigratedTokens(prev => {
        if (Math.random() > 0.6) {
          return [generateToken('migrated', randomBetween(5_000, 60_000)), ...prev].slice(0, 25)
        }
        return prev
      })
      setLastUpdated(Date.now())
    }, 5000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  const rawTokens = activeStage === 'new'
    ? newTokens
    : activeStage === 'final_stretch'
      ? finalStretchTokens
      : migratedTokens

  const tokens = useMemo(() => applyFilters(rawTokens, filters), [rawTokens, filters])

  return {
    activeStage,
    setActiveStage,
    tokens,
    filters,
    setFilters,
    resetFilters,
    lastUpdated,
    soundEnabled,
    setSoundEnabled,
  }
}
