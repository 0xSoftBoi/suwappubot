/**
 * Haptic feedback hook for Telegram Mini App
 * 
 * Uses Telegram's HapticFeedback API for native-feeling interactions.
 * Falls back to no-op on web/unsupported platforms.
 */

import { useCallback } from 'react'
import { getWebApp } from '../lib/telegram'

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
type NotificationType = 'error' | 'success' | 'warning'

export function useHaptic() {
  const webApp = getWebApp()
  const haptic = webApp?.HapticFeedback

  /**
   * Trigger impact feedback (for button presses, collisions)
   */
  const impact = useCallback((style: ImpactStyle = 'medium') => {
    try {
      haptic?.impactOccurred(style)
    } catch (e) {
      // Silently fail on unsupported platforms
    }
  }, [haptic])

  /**
   * Trigger notification feedback (for success/error states)
   */
  const notification = useCallback((type: NotificationType) => {
    try {
      haptic?.notificationOccurred(type)
    } catch (e) {
      // Silently fail
    }
  }, [haptic])

  /**
   * Trigger selection changed feedback (for picker/toggle changes)
   */
  const selection = useCallback(() => {
    try {
      haptic?.selectionChanged()
    } catch (e) {
      // Silently fail
    }
  }, [haptic])

  // Convenience methods
  const tap = useCallback(() => impact('light'), [impact])
  const press = useCallback(() => impact('medium'), [impact])
  const heavyPress = useCallback(() => impact('heavy'), [impact])
  const success = useCallback(() => notification('success'), [notification])
  const error = useCallback(() => notification('error'), [notification])
  const warning = useCallback(() => notification('warning'), [notification])

  return {
    impact,
    notification,
    selection,
    // Convenience
    tap,
    press,
    heavyPress,
    success,
    error,
    warning,
    // Check if available
    isSupported: !!haptic,
  }
}

export default useHaptic
