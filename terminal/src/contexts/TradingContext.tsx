import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1D'
type Side = 'buy' | 'sell'

interface TradingContextType {
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
}

const TradingContext = createContext<TradingContextType | undefined>(undefined)

export function TradingProvider({ children }: { children: ReactNode }) {
  const [limitPrice, setLimitPriceState] = useState('')
  const [chartInterval, setChartIntervalState] = useState<Interval>('1h')
  const [chartFullscreen, setChartFullscreen] = useState(false)
  const [side, setSideState] = useState<Side>('buy')

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

  return (
    <TradingContext.Provider
      value={{
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
