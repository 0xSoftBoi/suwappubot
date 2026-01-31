/**
 * Swap confirmation bottom sheet — shows preview before execution.
 *
 * Displays tokens in/out, rate, fees, price impact warnings.
 */
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'

interface SwapDetails {
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  exchangeRate: number
  priceImpact: number
  gasUsd: number
  route: string
  minReceived: string
  mevProtection?: boolean
}

interface Props {
  visible: boolean
  details: SwapDetails | null
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function SwapConfirmSheet({ visible, details, isPending, onConfirm, onCancel }: Props) {
  if (!details) return null

  const highImpact = details.priceImpact > 3
  const veryHighImpact = details.priceImpact > 10

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Confirm Swap</Text>

          {/* Token summary */}
          <View style={styles.summaryRow}>
            <View style={styles.tokenBlock}>
              <Text style={styles.amount}>{details.fromAmount}</Text>
              <Text style={styles.symbol}>{details.fromToken}</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
            <View style={styles.tokenBlock}>
              <Text style={styles.amount}>{details.toAmount}</Text>
              <Text style={styles.symbol}>{details.toToken}</Text>
            </View>
          </View>

          {/* Details */}
          <View style={styles.details}>
            <DetailRow label="Rate" value={`1 ${details.fromToken} = ${details.exchangeRate.toFixed(4)} ${details.toToken}`} />
            <DetailRow
              label="Price Impact"
              value={`${details.priceImpact.toFixed(2)}%`}
              warning={highImpact}
            />
            <DetailRow label="Gas" value={`$${details.gasUsd.toFixed(2)}`} />
            <DetailRow label="Min Received" value={`${details.minReceived} ${details.toToken}`} />
            <DetailRow label="Route" value={details.route} />
            {details.mevProtection && (
              <DetailRow label="MEV Protection" value="Enabled" />
            )}
          </View>

          {/* Warnings */}
          {highImpact && (
            <View style={[styles.warningBanner, veryHighImpact && styles.warningBannerSevere]}>
              <Text style={styles.warningText}>
                {veryHighImpact
                  ? 'Very high price impact! You may lose significant value.'
                  : 'Price impact is above 3%. Review carefully.'}
              </Text>
            </View>
          )}

          {/* Buttons */}
          <TouchableOpacity
            style={[styles.confirmButton, isPending && styles.confirmButtonDisabled]}
            onPress={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.confirmText}>Confirm Swap</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={isPending}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function DetailRow({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, warning && styles.detailWarning]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xxl,
    paddingBottom: 40,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: spacing.xl },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  tokenBlock: { alignItems: 'center', flex: 1 },
  amount: { fontSize: 22, fontWeight: '700', color: colors.text },
  symbol: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  arrow: { fontSize: 24, color: colors.textSecondary },
  details: { gap: spacing.md, marginBottom: spacing.lg },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 13, color: colors.textSecondary },
  detailValue: { fontSize: 13, color: colors.text, fontWeight: '500' },
  detailWarning: { color: colors.warning },
  warningBanner: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  warningBannerSevere: { backgroundColor: 'rgba(239,68,68,0.12)' },
  warningText: { fontSize: 13, color: colors.warning, textAlign: 'center' },
  confirmButton: {
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  confirmButtonDisabled: { backgroundColor: colors.borderLight },
  confirmText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
  cancelButton: {
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '500' },
})
