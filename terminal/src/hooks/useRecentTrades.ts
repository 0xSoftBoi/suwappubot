import { useState, useEffect, useRef } from 'react'

export interface Trade {
  id: string
  price: number
  size: number
  side: 'buy' | 'sell'
  time: number
  isNew?: boolean
}

const BASE_PRICE = 3245.50
const MAX_TRADES = 50

let tradeIdCounter = 0

function generateTrade(refPrice: number): Trade {
  const side: 'buy' | 'sell' = Math.random() > 0.5 ? 'buy' : 'sell'
  const priceOffset = (Math.random() - 0.5) * 2
  const price = parseFloat((refPrice + priceOffset).toFixed(2))
  const size = parseFloat((0.001 + Math.random() * 5).toFixed(4))

  return {
    id: `trade-${++tradeIdCounter}`,
    price,
    size,
    side,
    time: Date.now(),
    isNew: true,
  }
}

function generateInitialTrades(count: number): Trade[] {
  const trades: Trade[] = []
  let refPrice = BASE_PRICE
  const now = Date.now()

  for (let i = 0; i < count; i++) {
    const trade = generateTrade(refPrice)
    trade.time = now - (count - i) * 2000
    trade.isNew = false
    trades.push(trade)
    refPrice = trade.price
  }

  return trades
}

export function useRecentTrades() {
  const [trades, setTrades] = useState<Trade[]>(() => generateInitialTrades(25))
  const [isConnected, setIsConnected] = useState(true)
  const lastPriceRef = useRef(BASE_PRICE)

  useEffect(() => {
    const addTrade = () => {
      const trade = generateTrade(lastPriceRef.current)
      lastPriceRef.current = trade.price

      setTrades(prev => {
        const updated = [trade, ...prev.map(t => ({ ...t, isNew: false }))]
        return updated.slice(0, MAX_TRADES)
      })

      // Clear "new" flag after animation
      setTimeout(() => {
        setTrades(prev =>
          prev.map(t => t.id === trade.id ? { ...t, isNew: false } : t)
        )
      }, 600)
    }

    // Random interval between 1-3 seconds
    let timeout: ReturnType<typeof setTimeout>
    const schedule = () => {
      const delay = 1000 + Math.random() * 2000
      timeout = setTimeout(() => {
        addTrade()
        schedule()
      }, delay)
    }

    schedule()
    return () => clearTimeout(timeout)
  }, [])

  return { trades, isConnected }
}
