import { useState, useCallback } from 'react'
import type { TrackedWallet, WalletActivity, WalletStats } from '../types/api'

const STORAGE_KEY = 'suwappu_tracked_wallets'

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

export function useWalletTracker() {
  const [wallets, setWallets] = useState<TrackedWallet[]>(loadWallets)
  const [activities, setActivities] = useState<WalletActivity[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, WalletStats>>({})

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
    setStatsMap(prev => {
      const next = { ...prev }
      delete next[address]
      return next
    })
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
