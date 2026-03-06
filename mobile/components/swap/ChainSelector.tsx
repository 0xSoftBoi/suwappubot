/**
 * Horizontal chain picker for the swap screen.
 *
 * Shows supported chains as tappable pills with color-coded dots.
 */
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'

interface Chain {
  id: number
  key: string
  name: string
}

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#627eea',
  optimism: '#ff0420',
  bsc: '#f0b90b',
  polygon: '#8247e5',
  arbitrum: '#28a0f0',
  base: '#0052ff',
  avalanche: '#e84142',
  linea: '#61dfff',
  zksync: '#8c8dfc',
  solana: '#9945ff',
}

interface ChainSelectorProps {
  chains: Chain[]
  selected: string
  onSelect: (chainKey: string) => void
  label?: string
}

export function ChainSelector({ chains, selected, onSelect, label }: ChainSelectorProps) {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
        {chains.map((chain) => {
          const isActive = chain.key === selected || chain.name.toLowerCase() === selected
          const dotColor = CHAIN_COLORS[chain.key] || CHAIN_COLORS[chain.name.toLowerCase()] || colors.textSecondary
          return (
            <TouchableOpacity
              key={chain.id}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => onSelect(chain.key)}
              activeOpacity={0.7}
            >
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {chain.name}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  label: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  list: { gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary },
})
