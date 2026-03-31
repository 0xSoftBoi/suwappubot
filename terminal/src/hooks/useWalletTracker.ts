import { useState, useEffect, useCallback, useRef } from 'react'
import type { TrackedWallet, WalletActivity, WalletStats } from '../types/api'

const STORAGE_KEY = 'suwappu_tracked_wallets'

const MOCK_TOKENS = [
  { symbol: 'PEPE', address: '0x6982...3e28' },
  { symbol: 'WIF', address: '5Ws2...Kp4R' },
  { symbol: 'BONK', address: 'DezX...cPQa' },
  { symbol: 'FLOKI', address: '0xcf0c...9fd6' },
  { symbol: 'SHIB', address: '0x95aD...c001' },
  { symbol: 'SOL', address: 'So11...1112' },
  { symbol: 'ETH', address: '0xC02a...6Cc2' },
  { symbol: 'ARB', address: '0x912C...5a1B' },
  { symbol: 'ONDO', address: '0xfAbA...fc10' },
  { symbol: 'RENDER', address: '0x68...4c40' },
  { symbol: 'JUP', address: 'JUPy...cGXu' },
  { symbol: 'POPCAT', address: '7GCi...pump' },
]

const MOCK_CHAINS = ['ethereum', 'solana', 'arbitrum', 'base']

function loadWallets(): TrackedWallet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveWallets(wallets: TrackedWallet[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets))
}

function generateMockActivity(wallets: TrackedWallet[]): WalletActivity | null {
  if (wallets.length === 0) return null

  const wallet = wallets[Math.floor(Math.random() * wallets.length)]
  const token = MOCK_TOKENS[Math.floor(Math.random() * MOCK_TOKENS.length)]
  const action = Math.random() > 0.45 ? 'buy' : 'sell'
  const amount = Math.round((Math.random() * 50000 + 100) * 100) / 100
  const priceUsd = Math.round((Math.random() * 200 + 0.001) * 10000) / 10000

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    walletAddress: wallet.address,
    walletLabel: wallet.label,
    action,
    tokenSymbol: token.symbol,
    tokenAddress: token.address,
    amount,
    priceUsd,
    chain: wallet.chain || MOCK_CHAINS[Math.floor(Math.random() * MOCK_CHAINS.length)],
    timestamp: new Date().toISOString(),
    txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
  }
}

function generateMockStats(address: string): WalletStats {
  const pnl7d = Math.round((Math.random() * 40000 - 8000) * 100) / 100
  const pnl30d = Math.round((pnl7d * (2 + Math.random() * 3)) * 100) / 100
  const winRate = Math.round((Math.random() * 40 + 45) * 10) / 10
  const totalTrades = Math.floor(Math.random() * 800 + 50)

  const holdingCount = Math.floor(Math.random() * 4) + 2
  const topHoldings = Array.from({ length: holdingCount }, () => {
    const token = MOCK_TOKENS[Math.floor(Math.random() * MOCK_TOKENS.length)]
    return { symbol: token.symbol, valueUsd: Math.round(Math.random() * 100000 + 500) }
  })

  return { address, pnl7d, pnl30d, winRate, totalTrades, topHoldings }
}

export function useWalletTracker() {
  const [wallets, setWallets] = useState<TrackedWallet[]>(loadWallets)
  const [activities, setActivities] = useState<WalletActivity[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, WalletStats>>({})
  const walletsRef = useRef(wallets)

  useEffect(() => {
    walletsRef.current = wallets
  }, [wallets])

  // Generate mock stats whenever wallets change
  useEffect(() => {
    const map: Record<string, WalletStats> = {}
    for (const w of wallets) {
      map[w.address] = statsMap[w.address] ?? generateMockStats(w.address)
    }
    setStatsMap(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.length])

  // Generate mock activity every 5-10s
  useEffect(() => {
    function tick() {
      const activity = generateMockActivity(walletsRef.current)
      if (activity) {
        setActivities(prev => [activity, ...prev].slice(0, 100))
      }
    }

    // Generate a few initial activities
    for (let i = 0; i < 5; i++) {
      const activity = generateMockActivity(walletsRef.current)
      if (activity) {
        const pastMs = (i + 1) * 60_000 * (Math.random() * 5 + 1)
        activity.timestamp = new Date(Date.now() - pastMs).toISOString()
        activity.id = `init-${i}-${Math.random().toString(36).slice(2, 8)}`
        setActivities(prev => [...prev, activity])
      }
    }

    const interval = setInterval(tick, 5000 + Math.random() * 5000)
    return () => clearInterval(interval)
  }, [])

  const addWallet = useCallback((address: string, label?: string, chain?: string) => {
    setWallets(prev => {
      if (prev.some(w => w.address === address)) return prev
      const updated = [...prev, {
        address,
        label,
        chain: chain || (address.startsWith('0x') ? 'ethereum' : 'solana'),
        addedAt: new Date().toISOString(),
      }]
      saveWallets(updated)
      return updated
    })
  }, [])

  const removeWallet = useCallback((address: string) => {
    setWallets(prev => {
      const updated = prev.filter(w => w.address !== address)
      saveWallets(updated)
      return updated
    })
    setActivities(prev => prev.filter(a => a.walletAddress !== address))
  }, [])

  const updateLabel = useCallback((address: string, label: string) => {
    setWallets(prev => {
      const updated = prev.map(w => w.address === address ? { ...w, label } : w)
      saveWallets(updated)
      return updated
    })
  }, [])

  const getStats = useCallback((address: string): WalletStats | undefined => {
    return statsMap[address]
  }, [statsMap])

  return {
    wallets,
    activities,
    addWallet,
    removeWallet,
    updateLabel,
    getStats,
    statsMap,
  }
}
