/**
 * Zustand store for cross-screen ephemeral UI state.
 */
import { create } from 'zustand'

interface UIState {
  /** Trader ID selected for follow-config flow */
  selectedTraderId: number | null
  setSelectedTraderId: (id: number | null) => void

  /** Deep link route to navigate to after app launch */
  pendingDeepLink: string | null
  setPendingDeepLink: (route: string | null) => void

  /** Global loading overlay */
  globalLoading: boolean
  setGlobalLoading: (loading: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  selectedTraderId: null,
  setSelectedTraderId: (id) => set({ selectedTraderId: id }),

  pendingDeepLink: null,
  setPendingDeepLink: (route) => set({ pendingDeepLink: route }),

  globalLoading: false,
  setGlobalLoading: (loading) => set({ globalLoading: loading }),
}))
