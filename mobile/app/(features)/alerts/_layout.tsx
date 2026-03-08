import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function AlertsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Price Alerts' }} />
      <Stack.Screen name="create" options={{ title: 'New Alert', presentation: 'modal' }} />
    </Stack>
  )
}
