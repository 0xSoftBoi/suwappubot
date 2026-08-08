import { useCallback, useEffect } from 'react'
import { StyleSheet, Text } from 'react-native'
import { Tabs } from 'expo-router'
import { isAuthenticated } from '../../src/lib/auth'
import { usePrefetch } from '../../src/hooks/use-prefetch'
import { palette } from '../../src/theme'

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={[local.icon, { color }]}>{glyph}</Text>
}

export default function TabsLayout() {
  const { prefetchSnapshot, prefetchActivity } = usePrefetch()
  const icon = useCallback((glyph: string) => ({ color }: { color: string }) => (
    <TabIcon glyph={glyph} color={color} />
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
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('●') }} />
      <Tabs.Screen name="ask" options={{ title: 'Ask', tabBarIcon: icon('✦') }} />
      <Tabs.Screen name="money" options={{ title: 'Money', tabBarIcon: icon('$') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('≡') }} />
    </Tabs>
  )
}

const local = StyleSheet.create({
  header: { backgroundColor: palette.bg },
  headerTitle: { color: palette.text, fontWeight: '700' },
  tabBar: { backgroundColor: palette.surface, borderTopColor: palette.border },
  icon: { fontSize: 18, fontWeight: '700' },
})
