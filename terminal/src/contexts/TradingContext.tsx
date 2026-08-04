import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { usePersistentState } from '../lib/persist'

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1D'
type Side = 'buy' | 'sell'

// Top-level workspace mode. 'spot' is the classic swap terminal; 'perps' is the
// HyperLiquid perps desk; 'predict' is the Polymarket prediction desk. Switched
// from the Header and read by TradingLayout to swap the whole workspace.
export type TradingMode = 'spot' | 'bridge' | 'perps' | 'predict'

interface TradingContextType {
  // Top-level workspace mode (spot / perps / predict)
  tradingMode: TradingMode
  setTradingMode: (mode: TradingMode) => void

  // Order book click-to-fill: sets limit price
  limitPrice: string
  setLimitPrice: (price: string) => void

  // Chart interval (shared so hotkeys + toolbar + PriceChart all use the same state)
  chartInterval: Interval
  setChartInterval: (interval: Interval) => void

  // Fullscreen chart toggle
  chartFullscreen: boolean
  toggleChartFullscreen: () => void

  // Buy/Sell side
  side: Side
  setSide: (side: Side) => void

  // Refs for focusing swap inputs via hotkeys
  buyInputRef: RefObject<HTMLInputElement | null>
  sellInputRef: RefObject<HTMLInputElement | null>

  // Quick-buy pre-fill: DiscoveryPanel sets this so SwapPanel picks it up
  pendingSwapAmount: string
  setPendingSwapAmount: (amount: string) => void
}

const TradingContext = createContext<TradingContextType | undefined>(undefined)

export function TradingProvider({ children }: { children: ReactNode }) {
  // Persisted across reloads: the workspace mode, chart interval, and buy/sell
  // side are sticky preferences. limitPrice / fullscreen / pending amount are
  // transient and intentionally not persisted.
  const [tradingMode, setTradingModeState] = usePersistentState<TradingMode>('mode', 'spot')
  const [limitPrice, setLimitPriceState] = useState('')
  const [chartInterval, setChartIntervalState] = usePersistentState<Interval>('interval', '1h')
  const [chartFullscreen, setChartFullscreen] = useState(false)
  const [side, setSideState] = usePersistentState<Side>('side', 'buy')
  const [pendingSwapAmount, setPendingSwapAmountState] = useState('')

  const buyInputRef = useRef<HTMLInputElement | null>(null)
  const sellInputRef = useRef<HTMLInputElement | null>(null)

  const setLimitPrice = useCallback((price: string) => {
    setLimitPriceState(price)
  }, [])

  const setChartInterval = useCallback((interval: Interval) => {
    setChartIntervalState(interval)
  }, [])

  const toggleChartFullscreen = useCallback(() => {
    setChartFullscreen(prev => !prev)
  }, [])

  const setSide = useCallback((s: Side) => {
    setSideState(s)
  }, [])

  const setPendingSwapAmount = useCallback((amount: string) => {
    setPendingSwapAmountState(amount)
  }, [])

  const setTradingMode = useCallback((mode: TradingMode) => {
    setTradingModeState(mode)
  }, [])

  return (
    <TradingContext.Provider
      value={{
        tradingMode,
        setTradingMode,
        limitPrice,
        setLimitPrice,
        chartInterval,
        setChartInterval,
        chartFullscreen,
        toggleChartFullscreen,
        side,
        setSide,
        buyInputRef,
        sellInputRef,
        pendingSwapAmount,
        setPendingSwapAmount,
      }}
    >
      {children}
    </TradingContext.Provider>
  )
}

export function useTrading(): TradingContextType {
  const context = useContext(TradingContext)
  if (!context) throw new Error('useTrading must be used within TradingProvider')
  return context
}
