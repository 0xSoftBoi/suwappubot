import { useState, useEffect, useRef } from 'react'

export interface OrderBookLevel {
  price: number
  size: number
  total: number
}

export interface OrderBookData {
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  spread: number
  spreadPercent: number
  midPrice: number
}

export type OrderBookViewMode = 'both' | 'bids' | 'asks'
export type PrecisionStep = 0.01 | 0.1 | 1 | 10

const BASE_PRICE = 3245.50
const LEVELS = 15

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

function generateSide(
  basePrice: number,
  levels: number,
  step: number,
  direction: 'bid' | 'ask'
): OrderBookLevel[] {
  const result: OrderBookLevel[] = []
  let cumulative = 0

  for (let i = 0; i < levels; i++) {
    const offset = (i + 1) * step
    const price = direction === 'bid'
      ? roundToStep(basePrice - offset, step)
      : roundToStep(basePrice + offset, step)

    // More liquidity near the spread, tapering off
    const baseLiquidity = 2 + Math.random() * 8
    const depthMultiplier = 1 + (i / levels) * 0.5
    const size = parseFloat((baseLiquidity * depthMultiplier).toFixed(4))
    cumulative += size

    result.push({
      price: parseFloat(price.toFixed(Math.max(2, -Math.log10(step)))),
      size: parseFloat(size.toFixed(4)),
      total: parseFloat(cumulative.toFixed(4)),
    })
  }

  return result
}

function jitterBook(book: OrderBookData, step: number): OrderBookData {
  const jitterLevel = (level: OrderBookLevel): OrderBookLevel => {
    const sizeDelta = (Math.random() - 0.5) * 0.6
    const newSize = Math.max(0.01, level.size + sizeDelta)
    return { ...level, size: parseFloat(newSize.toFixed(4)) }
  }

  const bids = book.bids.map(jitterLevel)
  const asks = book.asks.map(jitterLevel)

  // Recalculate cumulative totals
  let bidCum = 0
  for (const b of bids) {
    bidCum += b.size
    b.total = parseFloat(bidCum.toFixed(4))
  }
  let askCum = 0
  for (const a of asks) {
    askCum += a.size
    a.total = parseFloat(askCum.toFixed(4))
  }

  // Small mid price drift
  const drift = (Math.random() - 0.5) * step * 2
  const midPrice = roundToStep(book.midPrice + drift, step)

  // Recalculate prices from new mid
  for (let i = 0; i < bids.length; i++) {
    bids[i].price = parseFloat(roundToStep(midPrice - (i + 1) * step, step).toFixed(Math.max(2, -Math.log10(step))))
  }
  for (let i = 0; i < asks.length; i++) {
    asks[i].price = parseFloat(roundToStep(midPrice + (i + 1) * step, step).toFixed(Math.max(2, -Math.log10(step))))
  }

  const spread = asks[0].price - bids[0].price
  const spreadPercent = (spread / midPrice) * 100

  return {
    bids,
    asks,
    spread: parseFloat(spread.toFixed(2)),
    spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    midPrice,
  }
}

function generateInitialBook(step: PrecisionStep): OrderBookData {
  const midPrice = roundToStep(BASE_PRICE, step)
  const bids = generateSide(midPrice, LEVELS, step, 'bid')
  const asks = generateSide(midPrice, LEVELS, step, 'ask')

  const spread = asks[0].price - bids[0].price
  const spreadPercent = (spread / midPrice) * 100

  return {
    bids,
    asks,
    spread: parseFloat(spread.toFixed(2)),
    spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    midPrice,
  }
}

export function useOrderBook(precision: PrecisionStep = 0.01) {
  const [book, setBook] = useState<OrderBookData>(() => generateInitialBook(precision))
  const [isConnected, setIsConnected] = useState(true)
  const bookRef = useRef(book)

  // Regenerate when precision changes
  useEffect(() => {
    const newBook = generateInitialBook(precision)
    setBook(newBook)
    bookRef.current = newBook
  }, [precision])

  // Simulate live updates every 500ms
  useEffect(() => {
    const interval = setInterval(() => {
      const updated = jitterBook(bookRef.current, precision)
      bookRef.current = updated
      setBook(updated)
    }, 500)

    return () => clearInterval(interval)
  }, [precision])

  const maxTotal = Math.max(
    book.bids.length > 0 ? book.bids[book.bids.length - 1].total : 0,
    book.asks.length > 0 ? book.asks[book.asks.length - 1].total : 0,
  )

  return { book, isConnected, maxTotal }
}
