/**
 * Token + amount input row — reusable for swaps, orders, DCA, sniping.
 */
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'

interface TokenAmountInputProps {
  label: string
  token: string
  chain?: string
  amount: string
  onAmountChange: (value: string) => void
  onTokenPress?: () => void
  placeholder?: string
  editable?: boolean
}

export default function TokenAmountInput({
  label,
  token,
  chain,
  amount,
  onAmountChange,
  onTokenPress,
  placeholder = '0.0',
  editable = true,
}: TokenAmountInputProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={onAmountChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          editable={editable}
        />
        <TouchableOpacity
          style={styles.tokenButton}
          onPress={onTokenPress}
          disabled={!onTokenPress}
        >
          <Text style={styles.tokenText}>{token}</Text>
          {chain && <Text style={styles.chainText}>{chain}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    padding: 0,
  },
  tokenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  tokenText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  chainText: {
    fontSize: 11,
    color: colors.textTertiary,
  },
})
