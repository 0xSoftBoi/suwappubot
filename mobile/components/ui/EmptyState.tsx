/**
 * Reusable empty state component with icon, title, subtitle, and optional CTA.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { colors, spacing, radius } from '../../lib/theme'

interface EmptyStateProps {
  icon: keyof typeof FontAwesome.glyphMap
  title: string
  subtitle?: string
  ctaLabel?: string
  onPress?: () => void
}

export default function EmptyState({ icon, title, subtitle, ctaLabel, onPress }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <FontAwesome name={icon} size={48} color={colors.textTertiary} />
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {ctaLabel && onPress && (
        <TouchableOpacity style={styles.cta} onPress={onPress}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  ctaText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '600',
  },
})
