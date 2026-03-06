/**
 * Push notification helpers for the Suwappu iOS app.
 *
 * Handles Expo push token registration, notification categories
 * (with action buttons), and cleanup on logout.
 */
import { Platform } from 'react-native'
import Constants from 'expo-constants'

// Lazy-import expo-notifications to avoid crashes on web
async function getNotifications() {
  return await import('expo-notifications')
}

/**
 * Request permissions, get Expo push token, and register it
 * with the Suwappu backend so we can receive push notifications.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null

  try {
    const Notifications = await getNotifications()

    // Request permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') {
      return null
    }

    // Get Expo push token
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: projectId ?? undefined,
    })
    const pushToken = tokenData.data

    // Register with backend (lazy import to avoid circular dependency)
    const { api } = await import('./api')
    await api.registerPushToken(pushToken)

    return pushToken
  } catch (e) {
    console.error('Failed to register for push notifications:', e)
    return null
  }
}

/**
 * Set up notification categories with action buttons.
 * These correspond to the NOTIFICATION_ROUTES in _layout.tsx.
 */
export async function setupNotificationCategories(): Promise<void> {
  if (Platform.OS === 'web') return

  try {
    const Notifications = await getNotifications()

    await Notifications.setNotificationCategoryAsync('alert_triggered', [
      { identifier: 'view', buttonTitle: 'View Alert', options: { opensAppToForeground: true } },
    ])

    await Notifications.setNotificationCategoryAsync('order_filled', [
      { identifier: 'view', buttonTitle: 'View Order', options: { opensAppToForeground: true } },
    ])

    await Notifications.setNotificationCategoryAsync('swap_completed', [
      { identifier: 'view', buttonTitle: 'View Swap', options: { opensAppToForeground: true } },
    ])

    await Notifications.setNotificationCategoryAsync('copy_trade', [
      { identifier: 'copy_now', buttonTitle: 'Copy Now', options: { opensAppToForeground: true } },
      { identifier: 'view', buttonTitle: 'View', options: { opensAppToForeground: true } },
    ])

    await Notifications.setNotificationCategoryAsync('dca_executed', [
      { identifier: 'view', buttonTitle: 'View DCA', options: { opensAppToForeground: true } },
    ])
  } catch (e) {
    console.error('Failed to set notification categories:', e)
  }
}

/**
 * Unregister push token from backend on logout.
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const { api } = await import('./api')
    await api.unregisterPushToken()
  } catch {
    // best effort — ignore errors during logout
  }
}
