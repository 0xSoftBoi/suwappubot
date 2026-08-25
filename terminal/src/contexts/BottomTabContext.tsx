import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { usePersistentState } from '../lib/persist'

export type BottomTab = 'portfolio' | 'signals' | 'discovery' | 'watchlist' | 'copy-trading' | 'wallet-tracker' | 'tweets' | 'defi' | 'curve' | 'lido' | 'aave' | 'balancer' | 'compound' | 'uniswap' | 'pancakeswap' | 'morpho' | 'euler' | 'copilot' | 'referrals' | 'rewards' | 'intel' | 'approvals' | 'audit' | 'data'

interface BottomTabContextType {
  activeTab: BottomTab
  setActiveTab: (tab: BottomTab) => void
}

const BottomTabContext = createContext<BottomTabContextType | undefined>(undefined)

export function BottomTabProvider({ children }: { children: ReactNode }) {
  // Reopen on the panel you were last using.
  const [activeTab, setActiveTabState] = usePersistentState<BottomTab>('bottomTab', 'portfolio')

  const setActiveTab = useCallback((tab: BottomTab) => {
    setActiveTabState(tab)
  }, [setActiveTabState])

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
