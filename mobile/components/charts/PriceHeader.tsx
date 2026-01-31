/**
 * Token price header — shows current price + 24h change badge.
 */
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing } from '../../lib/theme'

interface Props {
  symbol: string
  name: string
  price: number
  changePercent24h: number
}

export function PriceHeader({ symbol, name, price, changePercent24h }: Props) {
  const isPositive = changePercent24h >= 0

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.symbol}>{symbol}</Text>
      <Text style={styles.price}>
        ${price < 0.01 ? price.toPrecision(4) : price.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: price < 1 ? 6 : 2,
        })}
      </Text>
      <View style={[styles.changeBadge, isPositive ? styles.changeBadgeUp : styles.changeBadgeDown]}>
        <Text style={[styles.changeText, isPositive ? styles.changeTextUp : styles.changeTextDown]}>
          {isPositive ? '+' : ''}{changePercent24h.toFixed(2)}%
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.xxl, paddingTop: spacing.lg },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  symbol: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  price: { fontSize: 36, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  changeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: spacing.sm,
  },
  changeBadgeUp: { backgroundColor: 'rgba(34,197,94,0.15)' },
  changeBadgeDown: { backgroundColor: 'rgba(239,68,68,0.15)' },
  changeText: { fontSize: 14, fontWeight: '600' },
  changeTextUp: { color: colors.success },
  changeTextDown: { color: colors.error },
})
