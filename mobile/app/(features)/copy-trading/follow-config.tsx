/**
 * Follow setup — mode, amount, limits.
 */
import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useFollowTrader } from '../../../hooks/useCopyTrading'
import { useUIStore } from '../../../stores/ui'
import { colors, spacing, radius } from '../../../lib/theme'
import type { CopyMode, CopyType } from '../../../../packages/shared/src/types/copy-trading'

export default function FollowConfigScreen() {
  const router = useRouter()
  const traderId = useUIStore(s => s.selectedTraderId)
  const followMutation = useFollowTrader()

  const [copyMode, setCopyMode] = useState<CopyMode>('notify')
  const [copyType, setCopyType] = useState<CopyType>('fixed_amount')
  const [copyAmount, setCopyAmount] = useState('50')
  const [copyPercentage, setCopyPercentage] = useState('10')
  const [maxPerTrade, setMaxPerTrade] = useState('200')
  const [dailyLimit, setDailyLimit] = useState('500')

  const handleFollow = () => {
    if (!traderId) return
    followMutation.mutate(
      {
        traderId,
        config: {
          copyMode,
          copyType,
          copyAmount: copyType === 'fixed_amount' ? copyAmount : undefined,
          copyPercentage: copyType === 'percentage' ? parseFloat(copyPercentage) : undefined,
          maxPerTrade,
          dailyLimit,
        },
      },
      { onSuccess: () => router.back() },
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Mode */}
      <Text style={styles.label}>Copy Mode</Text>
      <View style={styles.chips}>
        <TouchableOpacity
          style={[styles.chip, copyMode === 'notify' && styles.chipActive]}
          onPress={() => setCopyMode('notify')}
        >
          <Text style={[styles.chipText, copyMode === 'notify' && styles.chipTextActive]}>Notify Only</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, copyMode === 'auto' && styles.chipActive]}
          onPress={() => setCopyMode('auto')}
        >
          <Text style={[styles.chipText, copyMode === 'auto' && styles.chipTextActive]}>Auto Copy</Text>
        </TouchableOpacity>
      </View>

      {/* Type */}
      <Text style={styles.label}>Amount Type</Text>
      <View style={styles.chips}>
        <TouchableOpacity
          style={[styles.chip, copyType === 'fixed_amount' && styles.chipActive]}
          onPress={() => setCopyType('fixed_amount')}
        >
          <Text style={[styles.chipText, copyType === 'fixed_amount' && styles.chipTextActive]}>Fixed USD</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, copyType === 'percentage' && styles.chipActive]}
          onPress={() => setCopyType('percentage')}
        >
          <Text style={[styles.chipText, copyType === 'percentage' && styles.chipTextActive]}>% Mirror</Text>
        </TouchableOpacity>
      </View>

      {/* Amount */}
      {copyType === 'fixed_amount' ? (
        <>
          <Text style={styles.label}>Amount per Trade (USD)</Text>
          <TextInput
            style={styles.input}
            value={copyAmount}
            onChangeText={setCopyAmount}
            placeholder="50"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>Mirror Percentage (%)</Text>
          <TextInput
            style={styles.input}
            value={copyPercentage}
            onChangeText={setCopyPercentage}
            placeholder="10"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
          />
        </>
      )}

      {/* Limits */}
      <Text style={styles.label}>Max per Trade (USD)</Text>
      <TextInput
        style={styles.input}
        value={maxPerTrade}
        onChangeText={setMaxPerTrade}
        placeholder="200"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Daily Limit (USD)</Text>
      <TextInput
        style={styles.input}
        value={dailyLimit}
        onChangeText={setDailyLimit}
        placeholder="500"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
      />

      <TouchableOpacity
        style={styles.submitButton}
        onPress={handleFollow}
        disabled={followMutation.isPending}
      >
        {followMutation.isPending ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.submitText}>
            {copyMode === 'auto' ? 'Start Auto-Copying' : 'Follow Trader'}
          </Text>
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
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 15, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xxxl,
  },
  submitText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
