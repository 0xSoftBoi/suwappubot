import { useCallback, useEffect } from 'react'
import { StyleSheet, Text, type ColorValue } from 'react-native'
import { Image } from 'expo-image'
import { Tabs } from 'expo-router'
import { isAuthenticated } from '../../src/lib/auth'
import { usePrefetch } from '../../src/hooks/use-prefetch'
import { palette } from '../../src/theme'

type TabIconProps = { symbol: `sf:${string}`; fallback: string; color: ColorValue }

function TabIcon({ symbol, fallback, color }: TabIconProps) {
  if (process.env.EXPO_OS === 'ios') {
    return <Image source={symbol} style={[local.symbol, { tintColor: color }]} />
  }
  return <Text style={[local.fallbackIcon, { color }]}>{fallback}</Text>
}

export default function TabsLayout() {
  const { prefetchSnapshot, prefetchActivity } = usePrefetch()
  const icon = useCallback((symbol: TabIconProps['symbol'], fallback: string) => ({ color }: { color: ColorValue }) => (
    <TabIcon symbol={symbol} fallback={fallback} color={color} />
  ), [])

  useEffect(() => {
    if (!isAuthenticated()) return
    prefetchSnapshot()
    prefetchActivity()
  }, [prefetchActivity, prefetchSnapshot])

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerStyle: local.header,
        headerTitleStyle: local.headerTitle,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: local.tabBar,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sf:house', '●') }} />
      <Tabs.Screen name="ask" options={{ title: 'Ask', tabBarIcon: icon('sf:message', '✦') }} />
      <Tabs.Screen name="money" options={{ title: 'Money', tabBarIcon: icon('sf:chart.pie', '$') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('sf:clock', '≡') }} />
    </Tabs>
  )
}

const local = StyleSheet.create({
  header: { backgroundColor: palette.bg },
  headerTitle: { color: palette.text, fontWeight: '700' },
  tabBar: { backgroundColor: palette.surface, borderTopColor: palette.border },
  symbol: { width: 23, height: 23 },
  fallbackIcon: { fontSize: 18, fontWeight: '700' },
})
