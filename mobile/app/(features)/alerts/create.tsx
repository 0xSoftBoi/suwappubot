/**
 * Create alert screen — token, chain, type, target price.
 */
import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useCreateAlert } from '../../../hooks/useAlerts'
import { colors, spacing, radius } from '../../../lib/theme'
import type { AlertType } from '../../../../packages/shared/src/types/alerts'

const ALERT_TYPES: { key: AlertType; label: string }[] = [
  { key: 'price_above', label: 'Price Above' },
  { key: 'price_below', label: 'Price Below' },
  { key: 'percent_change', label: '% Change' },
]

const CHAINS = ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'solana']

export default function CreateAlertScreen() {
  const router = useRouter()
  const createMutation = useCreateAlert()

  const [tokenSymbol, setTokenSymbol] = useState('')
  const [tokenAddress, setTokenAddress] = useState('')
  const [chain, setChain] = useState('ethereum')
  const [alertType, setAlertType] = useState<AlertType>('price_above')
  const [targetPrice, setTargetPrice] = useState('')
  const [percentChange, setPercentChange] = useState('')

  const handleCreate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    createMutation.mutate(
      {
        tokenSymbol: tokenSymbol.toUpperCase(),
        tokenAddress,
        chain,
        alertType,
        targetPrice: alertType !== 'percent_change' ? parseFloat(targetPrice) : undefined,
        percentChange: alertType === 'percent_change' ? parseFloat(percentChange) : undefined,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          router.back()
        },
        onError: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          Alert.alert('Error', 'Failed to create alert. Please try again.')
        },
      },
    )
  }

  const isValid =
    tokenSymbol.length > 0 &&
    (alertType === 'percent_change' ? percentChange.length > 0 : targetPrice.length > 0)

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Token */}
      <Text style={styles.label}>Token Symbol</Text>
      <TextInput
        style={styles.input}
        value={tokenSymbol}
        onChangeText={setTokenSymbol}
        placeholder="ETH"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>Token Address (optional)</Text>
      <TextInput
        style={styles.input}
        value={tokenAddress}
        onChangeText={setTokenAddress}
        placeholder="0x..."
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
      />

      {/* Chain */}
      <Text style={styles.label}>Chain</Text>
      <View style={styles.chips}>
        {CHAINS.map(c => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, chain === c && styles.chipActive]}
            onPress={() => setChain(c)}
          >
            <Text style={[styles.chipText, chain === c && styles.chipTextActive]}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Alert type */}
      <Text style={styles.label}>Alert Type</Text>
      <View style={styles.chips}>
        {ALERT_TYPES.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.chip, alertType === t.key && styles.chipActive]}
            onPress={() => setAlertType(t.key)}
          >
            <Text style={[styles.chipText, alertType === t.key && styles.chipTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Target */}
      {alertType !== 'percent_change' ? (
        <>
          <Text style={styles.label}>Target Price (USD)</Text>
          <TextInput
            style={styles.input}
            value={targetPrice}
            onChangeText={setTargetPrice}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>Percent Change (%)</Text>
          <TextInput
            style={styles.input}
            value={percentChange}
            onChangeText={setPercentChange}
            placeholder="10"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
          />
        </>
      )}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, !isValid && styles.submitDisabled]}
        onPress={handleCreate}
        disabled={!isValid || createMutation.isPending}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.submitText}>Create Alert</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 60 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: 16,
    color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textSecondary },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xxxl,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
