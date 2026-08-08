import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { palette, spacing, styles as s } from '../theme'

export function SignedOutState() {
  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
      <View style={s.card}>
        <Text style={s.heading}>Connect Gecko</Text>
        <Text selectable style={local.copy}>
          This device isn’t connected to your Suwappu account yet. Sign-in is not part of this preview, so Gecko won’t invent account data.
        </Text>
      </View>
    </ScrollView>
  )
}

export function LoadingState({ label }: { label: string }) {
  return <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.center}><ActivityIndicator color={palette.accent} /><Text style={s.muted}>{label}</Text></ScrollView>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.center}>
      <Text selectable style={s.body}>{message}</Text>
      <Pressable onPress={onRetry} style={local.button}><Text style={local.buttonText}>Try again</Text></Pressable>
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: spacing.xl },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  copy: { color: palette.textSecondary, fontSize: 15, lineHeight: 22, paddingTop: spacing.sm },
  button: { backgroundColor: palette.accent, borderRadius: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buttonText: { color: palette.bg, fontSize: 15, fontWeight: '700' },
})
