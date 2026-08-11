import { useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { palette, spacing, styles as s } from '../theme'

const LEGAL_LINKS = [
  { label: 'Privacy', url: 'https://suwappu.bot/legal/privacy' },
  { label: 'Terms', url: 'https://suwappu.bot/legal/terms' },
  { label: 'Support', url: 'https://suwappu.bot/contact' },
] as const

export function LegalLinks() {
  return (
    <View style={local.legal} accessibilityLabel="Legal and support links">
      {LEGAL_LINKS.map(({ label, url }) => (
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          key={url}
          onPress={() => void Linking.openURL(url)}
        >
          <Text style={local.legalLink}>{label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export function SignedOutState() {
  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
      <View style={s.card}>
        <Text style={s.heading}>Connect Gecko</Text>
        <Text selectable style={local.copy}>
          This device isn’t connected to your Suwappu account yet. Sign-in is not part of this preview, so Gecko won’t invent account data.
        </Text>
      </View>
      <LegalLinks />
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
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={local.button}
      >
        <Text style={local.buttonText}>Try again</Text>
      </Pressable>
    </ScrollView>
  )
}

/** Every empty state must carry one action, never a bare status sentence. */
export function EmptyAction({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <View style={[s.card, local.emptyCard]}>
      <Text style={s.heading}>{title}</Text>
      <Text selectable style={local.copy}>{body}</Text>
      <Pressable
        onPress={onAction}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        style={local.button}
      >
        <Text style={local.buttonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  )
}

/** Small, discoverable "What is this?" disclosure. Used on the balance and
 * in Savings so showing dollar amounts stays honest about what's actually
 * backing them, without cluttering the primary number. */
export function InfoNote({ label = 'What is this?', detail }: { label?: string; detail: string }) {
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? `Hide info: ${label}` : label}
        hitSlop={8}
        style={local.infoToggle}
      >
        <Text style={local.infoToggleText}>{open ? 'Hide' : label}</Text>
      </Pressable>
      {open ? <Text selectable style={local.infoDetail}>{detail}</Text> : null}
    </View>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: spacing.xl },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  copy: { color: palette.textSecondary, fontSize: 16, lineHeight: 22, paddingTop: spacing.sm },
  button: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent, borderRadius: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buttonText: { color: palette.bg, fontSize: 16, fontWeight: '700' },
  legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.sm },
  legalLink: { color: palette.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
  emptyCard: { gap: spacing.sm, alignItems: 'flex-start' },
  infoToggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingVertical: spacing.xs },
  infoToggleText: { color: palette.textSecondary, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  infoDetail: { color: palette.textMuted, fontSize: 13, lineHeight: 19, paddingTop: spacing.xs, paddingBottom: spacing.xs },
})
