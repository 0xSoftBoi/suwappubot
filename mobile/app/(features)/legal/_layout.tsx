import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function LegalLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  )
}
