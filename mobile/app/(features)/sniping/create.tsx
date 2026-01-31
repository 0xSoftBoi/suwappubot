/**
 * Create snipe — token, platform, mode, amount.
 */
import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useCreateSnipeOrder, useSnipeConfig } from '../../../hooks/useSniping'
import { colors, spacing, radius } from '../../../lib/theme'
import type { SnipePlatform, SnipeMode } from '../../../../packages/shared/src/types/sniping'

const PLATFORMS: { key: SnipePlatform; label: string }[] = [
  { key: 'pump_fun', label: 'pump.fun' },
  { key: 'raydium', label: 'Raydium' },
  { key: 'any', label: 'Any' },
]

const MODES: { key: SnipeMode; label: string; desc: string }[] = [
  { key: 'instant', label: 'Instant', desc: 'Buy immediately when detected' },
  { key: 'conditional', label: 'Conditional', desc: 'Wait for conditions to be met' },
  { key: 'first_block', label: 'First Block', desc: 'Snipe in the first block' },
]

export default function CreateSnipeScreen() {
  const router = useRouter()
  const createMutation = useCreateSnipeOrder()
  const { data: config } = useSnipeConfig()

  const [tokenAddress, setTokenAddress] = useState('')
  const [platform, setPlatform] = useState<SnipePlatform>('any')
  const [mode, setMode] = useState<SnipeMode>('instant')
  const [amountSol, setAmountSol] = useState('')
  const [useMevProtection, setUseMevProtection] = useState(true)

  const quickAmounts = config?.quickAmounts || [0.1, 0.25, 0.5, 1.0]

  const handleCreate = () => {
    createMutation.mutate(
      {
        tokenAddress: tokenAddress || undefined,
        platform,
        mode,
        amountSol,
        useMevProtection,
      },
      { onSuccess: () => router.back() },
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Token address */}
      <Text style={styles.label}>Token Address (optional)</Text>
      <TextInput
        style={styles.input}
        value={tokenAddress}
        onChangeText={setTokenAddress}
        placeholder="Token mint address..."
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
      />

      {/* Platform */}
      <Text style={styles.label}>Platform</Text>
      <View style={styles.chips}>
        {PLATFORMS.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.chip, platform === p.key && styles.chipActive]}
            onPress={() => setPlatform(p.key)}
          >
            <Text style={[styles.chipText, platform === p.key && styles.chipTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Mode */}
      <Text style={styles.label}>Snipe Mode</Text>
      {MODES.map(m => (
        <TouchableOpacity
          key={m.key}
          style={[styles.modeCard, mode === m.key && styles.modeCardActive]}
          onPress={() => setMode(m.key)}
        >
          <Text style={[styles.modeLabel, mode === m.key && styles.modeLabelActive]}>{m.label}</Text>
          <Text style={styles.modeDesc}>{m.desc}</Text>
        </TouchableOpacity>
      ))}

      {/* Amount */}
      <Text style={styles.label}>Amount (SOL)</Text>
      <View style={styles.quickAmounts}>
        {quickAmounts.map(a => (
          <TouchableOpacity
            key={a}
            style={[styles.quickChip, amountSol === String(a) && styles.chipActive]}
            onPress={() => setAmountSol(String(a))}
          >
            <Text style={[styles.chipText, amountSol === String(a) && styles.chipTextActive]}>
              {a} SOL
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={amountSol}
        onChangeText={setAmountSol}
        placeholder="Custom amount"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
      />

      {/* MEV Protection */}
      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleLabel}>MEV Protection (Jito)</Text>
          <Text style={styles.toggleHint}>Bundle with Jito to prevent sandwich attacks</Text>
        </View>
        <Switch
          value={useMevProtection}
          onValueChange={setUseMevProtection}
          trackColor={{ false: colors.borderLight, true: colors.success }}
        />
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, !amountSol && styles.submitDisabled]}
        onPress={handleCreate}
        disabled={!amountSol || createMutation.isPending}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.submitText}>Create Snipe Order</Text>
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
  chipText: { fontSize: 14, color: colors.textSecondary },
  chipTextActive: { color: colors.bg, fontWeight: '600' },
  modeCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modeCardActive: { borderColor: colors.primary },
  modeLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  modeLabelActive: { color: colors.primary },
  modeDesc: { fontSize: 13, color: colors.textTertiary, marginTop: 2 },
  quickAmounts: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  quickChip: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  toggleLabel: { fontSize: 16, fontWeight: '500', color: colors.text },
  toggleHint: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xxxl,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
})
