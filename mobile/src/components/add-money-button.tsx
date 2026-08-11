import { useEffect } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useOnramp } from '../hooks/use-onramp'
import { analytics } from '../lib/analytics'
import { palette, radius, spacing } from '../theme'

/**
 * "Add money with a card" — buys dollars to spend and save, worded per
 * Apple Guideline 3.1.5 (never "buy crypto" / "on-ramp"). Renders nothing at
 * all when Onramp isn't configured (see src/lib/onramp.ts) — never a
 * disabled or broken-looking button.
 */
export function AddMoneyButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const { available, open } = useOnramp()

  useEffect(() => {
    if (available) analytics.track('funding_method_shown', { method: 'card_onramp' })
  }, [available])

  if (!available) return null

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel="Add money with a card"
      style={variant === 'primary' ? local.primary : local.secondary}
    >
      <Text style={variant === 'primary' ? local.primaryText : local.secondaryText}>
        Add money with a card
      </Text>
    </Pressable>
  )
}

const local = StyleSheet.create({
  primary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  primaryText: { color: palette.bg, fontSize: 16, fontWeight: '700' },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  secondaryText: { color: palette.text, fontSize: 16, fontWeight: '700' },
})
