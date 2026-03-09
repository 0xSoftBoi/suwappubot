/**
 * Premium subscription screen — tier comparison + upgrade flow.
 *
 * Displays Free / Pro / Whale tiers with feature comparison.
 * TODO: Integrate StoreKit 2 via expo-in-app-purchases for actual purchases.
 */
import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native'
import { Stack } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import * as Haptics from 'expo-haptics'
import { colors, spacing, radius } from '../../../lib/theme'

type Tier = 'free' | 'pro' | 'whale'

interface TierInfo {
  id: Tier
  name: string
  price: string
  description: string
  color: string
  features: string[]
}

const TIERS: TierInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    description: 'Get started with basic trading',
    color: colors.textSecondary,
    features: [
      '3 price alerts',
      '2 limit orders',
      'Basic swap routing',
      'Community support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$9.99/mo',
    description: 'For active traders',
    color: colors.primary,
    features: [
      'Unlimited price alerts',
      'Unlimited limit orders',
      'Advanced swap routing',
      'DCA automation',
      'Copy trading (5 traders)',
      'Priority support',
      '50% fee discount',
    ],
  },
  {
    id: 'whale',
    name: 'Whale',
    price: '$29.99/mo',
    description: 'Maximum trading power',
    color: colors.warning,
    features: [
      'Everything in Pro',
      'Token sniping with MEV protection',
      'Unlimited copy trading',
      'Custom alert webhooks',
      'API access',
      'Dedicated support',
      '80% fee discount',
      'Early access to features',
    ],
  },
]

const FEATURE_MATRIX = [
  { feature: 'Price Alerts', free: '3', pro: 'Unlimited', whale: 'Unlimited' },
  { feature: 'Limit Orders', free: '2', pro: 'Unlimited', whale: 'Unlimited' },
  { feature: 'DCA Plans', free: '1', pro: '10', whale: 'Unlimited' },
  { feature: 'Copy Traders', free: '-', pro: '5', whale: 'Unlimited' },
  { feature: 'Sniping', free: '-', pro: '-', whale: 'Yes' },
  { feature: 'Fee Discount', free: '0%', pro: '50%', whale: '80%' },
  { feature: 'Swap Routing', free: 'Basic', pro: 'Advanced', whale: 'Advanced' },
  { feature: 'API Access', free: '-', pro: '-', whale: 'Yes' },
]

export default function PremiumScreen() {
  const [selectedTier, setSelectedTier] = useState<Tier>('pro')

  // TODO: Replace with actual user subscription data
  const currentTier: Tier = 'free'

  const handleUpgrade = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    // TODO: Integrate StoreKit 2 / expo-in-app-purchases
    Alert.alert(
      'Coming Soon',
      `In-app purchases for the ${selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1)} plan will be available in a future update.`,
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Premium' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Tier cards */}
        {TIERS.map((tier) => {
          const isSelected = selectedTier === tier.id
          const isCurrent = currentTier === tier.id

          return (
            <TouchableOpacity
              key={tier.id}
              style={[
                styles.tierCard,
                isSelected && { borderColor: tier.color },
                isCurrent && styles.currentBadgeWrap,
              ]}
              activeOpacity={0.7}
              onPress={() => {
                setSelectedTier(tier.id)
                Haptics.selectionAsync()
              }}
            >
              {isCurrent && (
                <View style={[styles.currentBadge, { backgroundColor: tier.color }]}>
                  <Text style={styles.currentBadgeText}>Current</Text>
                </View>
              )}
              <View style={styles.tierHeader}>
                <Text style={[styles.tierName, { color: tier.color }]}>{tier.name}</Text>
                <Text style={styles.tierPrice}>{tier.price}</Text>
              </View>
              <Text style={styles.tierDesc}>{tier.description}</Text>
              <View style={styles.featureList}>
                {tier.features.map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <FontAwesome name="check" size={12} color={tier.color} />
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          )
        })}

        {/* Feature comparison table */}
        <Text style={styles.sectionTitle}>Feature Comparison</Text>
        <View style={styles.table}>
          {/* Header */}
          <View style={styles.tableRow}>
            <Text style={[styles.tableCell, styles.tableHeader, { flex: 2 }]}>Feature</Text>
            <Text style={[styles.tableCell, styles.tableHeader]}>Free</Text>
            <Text style={[styles.tableCell, styles.tableHeader, { color: colors.primary }]}>Pro</Text>
            <Text style={[styles.tableCell, styles.tableHeader, { color: colors.warning }]}>Whale</Text>
          </View>
          {FEATURE_MATRIX.map((row) => (
            <View key={row.feature} style={styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 2, color: colors.text }]}>{row.feature}</Text>
              <Text style={styles.tableCell}>{row.free}</Text>
              <Text style={styles.tableCell}>{row.pro}</Text>
              <Text style={styles.tableCell}>{row.whale}</Text>
            </View>
          ))}
        </View>

        {/* Upgrade CTA */}
        {selectedTier !== currentTier && (
          <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
            <Text style={styles.upgradeText}>
              Upgrade to {selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1)}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 60 },
  tierCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  currentBadgeWrap: { overflow: 'visible' },
  currentBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  currentBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  tierName: { fontSize: 20, fontWeight: '700' },
  tierPrice: { fontSize: 18, fontWeight: '600', color: colors.text },
  tierDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md },
  featureList: { gap: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureText: { fontSize: 14, color: colors.text },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  table: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  tableCell: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tableHeader: {
    fontWeight: '600',
    color: colors.textSecondary,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  upgradeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  upgradeText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
