import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function CopyTradingLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Copy Trading' }} />
      <Stack.Screen name="follow-config" options={{ title: 'Follow Settings', presentation: 'modal' }} />
      <Stack.Screen name="trader/[id]" options={{ title: 'Trader' }} />
    </Stack>
  )
}
