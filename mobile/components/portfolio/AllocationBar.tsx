/**
 * Horizontal stacked bar showing portfolio allocation by token/chain.
 */
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'

interface TokenAllocation {
  symbol: string
  chain: string
  usdValue: number
  percentage: number
}

interface Props {
  tokens: { symbol: string; chain: string; usdValue: number }[]
  totalValue: number
}

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#627eea',
  bsc: '#f3ba2f',
  polygon: '#8247e5',
  arbitrum: '#28a0f0',
  optimism: '#ff0420',
  base: '#0052ff',
  solana: '#9945ff',
}

const FALLBACK_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

export function AllocationBar({ tokens, totalValue }: Props) {
  if (!tokens.length || totalValue <= 0) return null

  // Calculate allocations, sorted by value descending
  const allocations: TokenAllocation[] = tokens
    .map((t) => ({
      symbol: t.symbol,
      chain: t.chain,
      usdValue: t.usdValue,
      percentage: (t.usdValue / totalValue) * 100,
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .filter((a) => a.percentage >= 0.5) // hide dust

  // Top 5 individually + "Other"
  const top = allocations.slice(0, 5)
  const otherPct = allocations.slice(5).reduce((sum, a) => sum + a.percentage, 0)

  return (
    <View style={styles.container}>
      {/* Bar */}
      <View style={styles.bar}>
        {top.map((a, i) => (
          <View
            key={`${a.symbol}-${a.chain}`}
            style={[
              styles.segment,
              {
                flex: a.percentage,
                backgroundColor: CHAIN_COLORS[a.chain] || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
              },
              i === 0 && styles.segmentFirst,
              i === top.length - 1 && !otherPct && styles.segmentLast,
            ]}
          />
        ))}
        {otherPct > 0 && (
          <View
            style={[styles.segment, styles.segmentLast, { flex: otherPct, backgroundColor: colors.borderLight }]}
          />
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {top.map((a, i) => (
          <View key={`${a.symbol}-${a.chain}`} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor:
                    CHAIN_COLORS[a.chain] || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
                },
              ]}
            />
            <Text style={styles.legendText}>
              {a.symbol} {a.percentage.toFixed(1)}%
            </Text>
          </View>
        ))}
        {otherPct > 0 && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.borderLight }]} />
            <Text style={styles.legendText}>Other {otherPct.toFixed(1)}%</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.lg },
  bar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  segment: { height: '100%' },
  segmentFirst: { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  segmentLast: { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.textSecondary },
})
