/**
 * Create DCA — tokens, amount, interval, limits.
 */
import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useCreateDCA } from '../../../hooks/useDCA'
import { colors, spacing, radius } from '../../../lib/theme'

const INTERVALS = [
  { hours: 1, label: '1h' },
  { hours: 4, label: '4h' },
  { hours: 12, label: '12h' },
  { hours: 24, label: 'Daily' },
  { hours: 168, label: 'Weekly' },
]

const CHAINS = ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'solana']

export default function CreateDCAScreen() {
  const router = useRouter()
  const createMutation = useCreateDCA()

  const [fromToken, setFromToken] = useState('')
  const [toToken, setToToken] = useState('')
  const [fromChain, setFromChain] = useState('ethereum')
  const [amountPerExecution, setAmountPerExecution] = useState('')
  const [intervalHours, setIntervalHours] = useState(24)
  const [maxExecutions, setMaxExecutions] = useState('')

  const handleCreate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    createMutation.mutate(
      {
        fromToken: fromToken.toUpperCase(),
        toToken: toToken.toUpperCase(),
        fromChain,
        toChain: fromChain,
        amountPerExecution,
        intervalHours,
        maxExecutions: maxExecutions ? parseInt(maxExecutions) : undefined,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          router.back()
        },
        onError: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          Alert.alert('Error', 'Failed to create DCA plan. Please try again.')
        },
      },
    )
  }

  const isValid = fromToken && toToken && amountPerExecution

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Buy Token</Text>
      <TextInput
        style={styles.input}
        value={toToken}
        onChangeText={setToToken}
        placeholder="ETH"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>With Token</Text>
      <TextInput
        style={styles.input}
        value={fromToken}
        onChangeText={setFromToken}
        placeholder="USDC"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>Chain</Text>
      <View style={styles.chips}>
        {CHAINS.map(c => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, fromChain === c && styles.chipActive]}
            onPress={() => setFromChain(c)}
          >
            <Text style={[styles.chipText, fromChain === c && styles.chipTextActive]}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Amount Per Execution</Text>
      <TextInput
        style={styles.input}
        value={amountPerExecution}
        onChangeText={setAmountPerExecution}
        placeholder="100"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Interval</Text>
      <View style={styles.chips}>
        {INTERVALS.map(i => (
          <TouchableOpacity
            key={i.hours}
            style={[styles.chip, intervalHours === i.hours && styles.chipActive]}
            onPress={() => setIntervalHours(i.hours)}
          >
            <Text style={[styles.chipText, intervalHours === i.hours && styles.chipTextActive]}>
              {i.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Max Executions (optional)</Text>
      <TextInput
        style={styles.input}
        value={maxExecutions}
        onChangeText={setMaxExecutions}
        placeholder="Unlimited"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
      />

      <TouchableOpacity
        style={[styles.submitButton, !isValid && styles.submitDisabled]}
        onPress={handleCreate}
        disabled={!isValid || createMutation.isPending}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.submitText}>Start DCA</Text>
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
