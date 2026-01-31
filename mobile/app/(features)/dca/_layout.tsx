import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function DCALayout() {
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
      <Stack.Screen name="index" options={{ title: 'DCA Plans' }} />
      <Stack.Screen name="create" options={{ title: 'New DCA Plan', presentation: 'modal' }} />
      <Stack.Screen name="[id]" options={{ title: 'DCA Detail' }} />
    </Stack>
  )
}
