/**
 * Root layout — the app's boot sequence.
 *
 * Order matters here:
 *  1. Hold the native splash screen (`preventAutoHideAsync` at module scope,
 *     before React mounts) so the user never sees an empty white frame between
 *     the splash and first paint.
 *  2. Restore auth from the Keychain and rehydrate the persisted query cache.
 *  3. Only then hide the splash — at which point the first screen already has
 *     real data, not a skeleton.
 */
import { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import * as SplashScreen from 'expo-splash-screen'
import { queryClient, persistOptions, installAppStateBridges } from '../src/lib/queryClient'
import { loadAuth } from '../src/lib/auth'
import { reportTimeToInteractive } from '../src/lib/perf'
import { palette } from '../src/theme'

// Must run before the first render, not inside an effect.
void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const teardown = installAppStateBridges()
    loadAuth()
      .catch(() => {
        // A Keychain read failure means "signed out", not "crash on launch".
      })
      .finally(() => setReady(true))
    return teardown
  }, [])

  if (!ready) return null

  return (
    <GestureHandlerRootView style={local.root}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={persistOptions}
          onSuccess={() => {
            // Cache is rehydrated — safe to reveal the UI with real content.
            void SplashScreen.hideAsync()
            reportTimeToInteractive()
          }}
        >
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.bg },
              // Native stack animations run on the UI thread; the JS thread
              // stays free to render the destination screen mid-transition.
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
})
