/**
 * Trending token row — symbol, name, price, 24h change.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { colors, spacing, radius } from '../../lib/theme'
import type { DiscoveryToken } from '../../hooks/useTokenDiscovery'

interface Props {
  token: DiscoveryToken
  rank?: number
}

export function TrendingTokenRow({ token, rank }: Props) {
  const router = useRouter()
  const isPositive = token.change24h >= 0

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() =>
        router.push({
          pathname: '/(features)/token/[address]' as any,
          params: { address: token.address, chain: token.chain, symbol: token.symbol },
        })
      }
    >
      <View style={styles.left}>
        {rank != null && <Text style={styles.rank}>{rank}</Text>}
        <View>
          <Text style={styles.symbol}>{token.symbol}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {token.name}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={styles.price}>
          ${token.price < 0.01
            ? token.price.toPrecision(4)
            : token.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
        <Text style={[styles.change, isPositive ? styles.changeUp : styles.changeDown]}>
          {isPositive ? '+' : ''}{token.change24h.toFixed(2)}%
        </Text>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  rank: { fontSize: 14, color: colors.textSecondary, fontWeight: '600', width: 24 },
  symbol: { fontSize: 15, fontWeight: '600', color: colors.text },
  name: { fontSize: 12, color: colors.textSecondary, marginTop: 2, maxWidth: 150 },
  right: { alignItems: 'flex-end' },
  price: { fontSize: 15, color: colors.text, fontWeight: '500' },
  change: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  changeUp: { color: colors.success },
  changeDown: { color: colors.error },
})
