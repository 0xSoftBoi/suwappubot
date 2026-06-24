import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type BottomTab = 'portfolio' | 'signals' | 'discovery' | 'watchlist' | 'copy-trading' | 'wallet-tracker' | 'tweets' | 'defi' | 'copilot'

interface BottomTabContextType {
  activeTab: BottomTab
  setActiveTab: (tab: BottomTab) => void
}

const BottomTabContext = createContext<BottomTabContextType | undefined>(undefined)

export function BottomTabProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTabState] = useState<BottomTab>('portfolio')

  const setActiveTab = useCallback((tab: BottomTab) => {
    setActiveTabState(tab)
  }, [])

  return (
    <BottomTabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </BottomTabContext.Provider>
  )
}

export function useBottomTab(): BottomTabContextType {
  const context = useContext(BottomTabContext)
  if (!context) throw new Error('useBottomTab must be used within BottomTabProvider')
  return context
}
