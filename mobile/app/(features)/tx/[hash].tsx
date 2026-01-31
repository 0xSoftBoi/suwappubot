/**
 * Transaction detail screen — status, amounts, gas, explorer link.
 */
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { colors, spacing, radius } from '../../../lib/theme'

const EXPLORER_URLS: Record<string, string> = {
  ethereum: 'https://etherscan.io/tx/',
  bsc: 'https://bscscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  solana: 'https://solscan.io/tx/',
}

export default function TransactionDetailScreen() {
  const params = useLocalSearchParams<{
    hash: string
    fromToken?: string
    toToken?: string
    fromAmount?: string
    toAmount?: string
    fromChain?: string
    toChain?: string
    status?: string
    date?: string
    gasUsd?: string
    exchangeRate?: string
  }>()

  const {
    hash,
    fromToken = '??',
    toToken = '??',
    fromAmount = '--',
    toAmount = '--',
    fromChain = 'ethereum',
    toChain = 'ethereum',
    status = 'completed',
    date,
    gasUsd,
    exchangeRate,
  } = params

  const isCrossChain = fromChain !== toChain
  const explorerBase = EXPLORER_URLS[fromChain] || EXPLORER_URLS.ethereum

  const statusColor =
    status === 'completed' ? colors.success :
    status === 'failed' ? colors.error :
    colors.warning

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Transaction' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Status */}
        <View style={styles.statusContainer}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </View>
        </View>

        {/* Swap summary */}
        <View style={styles.swapSummary}>
          <View style={styles.tokenBlock}>
            <Text style={styles.tokenAmount}>{fromAmount}</Text>
            <Text style={styles.tokenSymbol}>{fromToken}</Text>
            <Text style={styles.chainLabel}>{fromChain}</Text>
          </View>
          <Text style={styles.arrow}>
            {isCrossChain ? '→' : '→'}
          </Text>
          <View style={styles.tokenBlock}>
            <Text style={styles.tokenAmount}>{toAmount}</Text>
            <Text style={styles.tokenSymbol}>{toToken}</Text>
            <Text style={styles.chainLabel}>{toChain}</Text>
          </View>
        </View>

        {/* Route visualization for cross-chain */}
        {isCrossChain && (
          <View style={styles.routeCard}>
            <Text style={styles.detailLabel}>Route</Text>
            <Text style={styles.routeText}>
              {fromChain} → Bridge → {toChain}
            </Text>
          </View>
        )}

        {/* Details */}
        <View style={styles.detailsCard}>
          {exchangeRate && (
            <DetailRow label="Exchange Rate" value={exchangeRate} />
          )}
          {gasUsd && (
            <DetailRow label="Gas Fee" value={`$${gasUsd}`} />
          )}
          {date && (
            <DetailRow label="Time" value={new Date(date).toLocaleString()} />
          )}
          <DetailRow
            label="Tx Hash"
            value={`${hash.slice(0, 10)}...${hash.slice(-6)}`}
          />
        </View>

        {/* Explorer button */}
        <TouchableOpacity
          style={styles.explorerButton}
          onPress={() => Linking.openURL(`${explorerBase}${hash}`)}
        >
          <Text style={styles.explorerButtonText}>View on Explorer</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 40 },
  statusContainer: { alignItems: 'center', marginBottom: spacing.xxl },
  statusBadge: {
    borderRadius: radius.full,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  statusText: { fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  swapSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  tokenBlock: { alignItems: 'center', flex: 1 },
  tokenAmount: { fontSize: 20, fontWeight: '700', color: colors.text },
  tokenSymbol: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  chainLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, textTransform: 'capitalize' },
  arrow: { fontSize: 24, color: colors.textSecondary, marginHorizontal: spacing.md },
  routeCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  routeText: {
    fontSize: 14,
    color: colors.text,
    marginTop: 4,
    textTransform: 'capitalize',
  },
  detailsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: { fontSize: 13, color: colors.textSecondary },
  detailValue: { fontSize: 14, color: colors.text, fontWeight: '500' },
  explorerButton: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  explorerButtonText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
})
