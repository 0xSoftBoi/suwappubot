import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

// Settings response from API
export interface UserSettings {
  slippage: number // As percentage (e.g., 0.5)
  priceAlerts: boolean
  txUpdates: boolean
  promotions: boolean
  language: string
  theme: string
}

// Update request shape
export interface UpdateSettingsRequest {
  slippage?: number
  priceAlerts?: boolean
  txUpdates?: boolean
  promotions?: boolean
  language?: string
  theme?: string
}

// Default settings (used as fallback)
const DEFAULT_SETTINGS: UserSettings = {
  slippage: 0.5,
  priceAlerts: true,
  txUpdates: true,
  promotions: false,
  language: 'en',
  theme: 'light',
}

/**
 * Hook to get user settings
 */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: DEFAULT_SETTINGS,
  })
}

/**
 * Hook to update user settings
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (updates: UpdateSettingsRequest) => api.updateSettings(updates),
    onMutate: async (updates) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['settings'] })

      // Snapshot the previous value
      const previousSettings = queryClient.getQueryData<UserSettings>(['settings'])

      // Optimistically update to the new value
      if (previousSettings) {
        queryClient.setQueryData<UserSettings>(['settings'], {
          ...previousSettings,
          ...updates,
        })
      }

      return { previousSettings }
    },
    onError: (_err, _updates, context) => {
      // Roll back to the previous value
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings'], context.previousSettings)
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

/**
 * Hook for slippage setting specifically
 */
export function useSlippage() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  return {
    slippage: settings?.slippage ?? DEFAULT_SETTINGS.slippage,
    setSlippage: (slippage: number) => updateSettings.mutateAsync({ slippage }),
    isUpdating: updateSettings.isPending,
  }
}

/**
 * Hook for notification settings
 */
export function useNotificationSettings() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  return {
    priceAlerts: settings?.priceAlerts ?? DEFAULT_SETTINGS.priceAlerts,
    txUpdates: settings?.txUpdates ?? DEFAULT_SETTINGS.txUpdates,
    promotions: settings?.promotions ?? DEFAULT_SETTINGS.promotions,
    setPriceAlerts: (enabled: boolean) => updateSettings.mutateAsync({ priceAlerts: enabled }),
    setTxUpdates: (enabled: boolean) => updateSettings.mutateAsync({ txUpdates: enabled }),
    setPromotions: (enabled: boolean) => updateSettings.mutateAsync({ promotions: enabled }),
    isUpdating: updateSettings.isPending,
  }
}
