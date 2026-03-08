/**
 * Stack navigator for settings screens.
 */
import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function SettingsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="wallets" options={{ title: 'Wallets' }} />
    </Stack>
  )
}
