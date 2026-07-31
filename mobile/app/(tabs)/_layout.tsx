/**
 * Tab layout.
 *
 * Prefetches the other tabs' data on mount so switching tabs feels instant —
 * by the time the user taps "Swap" or "Activity" the query cache is already
 * warm and the screen paints with real content on its first frame.
 */
import { useEffect, useCallback } from 'react'
import { StyleSheet, Text } from 'react-native'
import { Tabs } from 'expo-router'
import { palette } from '../../src/theme'
import { usePrefetch } from '../../src/hooks/usePrefetch'

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={[local.icon, { color }]}>{glyph}</Text>
}

export default function TabsLayout() {
  const { prefetchPortfolio, prefetchSwaps } = usePrefetch()

  const renderPortfolioIcon = useCallback(({ color }: { color: string }) => (
    <TabIcon glyph="◎" color={color} />
  ), [])
  const renderSwapIcon = useCallback(({ color }: { color: string }) => (
    <TabIcon glyph="⇄" color={color} />
  ), [])
  const renderActivityIcon = useCallback(({ color }: { color: string }) => (
    <TabIcon glyph="≡" color={color} />
  ), [])

  useEffect(() => {
    // index.tsx already fetches portfolio itself; warm the other two tabs.
    prefetchSwaps()
    prefetchPortfolio()
  }, [prefetchSwaps, prefetchPortfolio])

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: local.tabBar,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Portfolio', tabBarIcon: renderPortfolioIcon }}
      />
      <Tabs.Screen
        name="swap"
        options={{ title: 'Swap', tabBarIcon: renderSwapIcon }}
      />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarIcon: renderActivityIcon }}
      />
    </Tabs>
  )
}

const local = StyleSheet.create({
  tabBar: {
    backgroundColor: palette.surface,
    borderTopColor: palette.border,
  },
  icon: { fontSize: 20 },
})
