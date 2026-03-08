/**
 * Root layout — wraps the entire app with providers.
 */
import { useEffect } from 'react'
import { Platform } from 'react-native'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { DarkTheme, ThemeProvider } from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from '../contexts/AuthContext'
import { AppErrorBoundary } from '../components/ui/AppErrorBoundary'
import 'react-native-reanimated'

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <AppErrorBoundary {...props} />
}

export const unstable_settings = {
  initialRouteName: '(tabs)',
}

SplashScreen.preventAutoHideAsync()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      retry: 2,
    },
  },
})

// Force dark theme for Suwappu
const suwappuTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#000',
    card: '#111',
    primary: '#FF85A1',
  },
}

/**
 * Map push notification category to deep link route.
 */
const NOTIFICATION_ROUTES: Record<string, string> = {
  alert_triggered: '/(features)/alerts',
  order_filled: '/(features)/orders',
  swap_completed: '/(tabs)/portfolio',
  copy_trade: '/(features)/copy-trading',
  dca_executed: '/(features)/dca',
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  })
  // Push notification deep link listener
  useEffect(() => {
    if (Platform.OS === 'web') return

    let sub: { remove: () => void } | undefined

    ;(async () => {
      try {
        const Notifications = await import('expo-notifications')
        const { router: expoRouter } = await import('expo-router')

        // Handle taps on notifications when app is running
        sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const category = response.notification.request.content.categoryIdentifier
          const data = response.notification.request.content.data as Record<string, any> | undefined

          let route = category ? NOTIFICATION_ROUTES[category] : undefined

          // Special case: copy_trade with "Copy Now" action -> trader profile
          if (category === 'copy_trade' && response.actionIdentifier === 'copy_now' && data?.traderId) {
            route = `/(features)/copy-trading/trader/${data.traderId}`
          }

          if (route) {
            expoRouter.push(route as any)
          }
        })
      } catch {
        // expo-notifications not available (web)
      }
    })()

    return () => sub?.remove()
  }, [])

  useEffect(() => {
    if (error) throw error
  }, [error])

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync()
    }
  }, [loaded])

  if (!loaded) {
    return null
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider value={suwappuTheme}>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(features)" options={{ presentation: 'card' }} />
            </Stack>
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
