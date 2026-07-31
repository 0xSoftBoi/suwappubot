/**
 * A single token row.
 *
 * `memo` is not decoration here — this component is rendered once per token in
 * a virtualised list, and the list's data array is replaced wholesale on every
 * poll. Without memo + stable props, a 15s balance refresh re-renders every
 * visible row even when nothing about that row changed.
 *
 * `expo-image` (not RN `Image`) because it has a real two-tier memory+disk
 * cache and decodes off the JS thread. Token logos are the single largest
 * source of scroll jank in a wallet UI.
 */
import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { palette, radius, spacing, styles as s } from '../theme'
import type { Token } from '../types/api'

export const TOKEN_ROW_HEIGHT = 64

interface Props {
  token: Token
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 4 : 2,
  })
}

function TokenRowBase({ token }: Props) {
  return (
    <View style={local.row}>
      <Image
        source={token.logoUrl}
        style={local.logo}
        contentFit="cover"
        cachePolicy="memory-disk"
        // A 1-frame fade instead of the default 300ms — a logo popping in late
        // reads as slowness even when the data arrived instantly.
        transition={80}
        recyclingKey={token.address}
      />
      <View style={local.labels}>
        <Text style={s.heading} numberOfLines={1}>
          {token.symbol}
        </Text>
        <Text style={s.muted} numberOfLines={1}>
          {token.chain}
        </Text>
      </View>
      <View style={local.values}>
        <Text style={s.body}>{formatUsd(token.usdValue)}</Text>
        <Text style={s.muted} numberOfLines={1}>
          {token.balance}
        </Text>
      </View>
    </View>
  )
}

/**
 * Compare only the fields the row actually renders. The API returns a fresh
 * object identity on every poll, so a default shallow compare would never hit.
 */
export const TokenRow = memo(TokenRowBase, (prev, next) => {
  const a = prev.token
  const b = next.token
  return (
    a.address === b.address &&
    a.balance === b.balance &&
    a.usdValue === b.usdValue &&
    a.logoUrl === b.logoUrl
  )
})

const local = StyleSheet.create({
  row: {
    height: TOKEN_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: palette.surface,
  },
  labels: { flex: 1, gap: 2 },
  values: { alignItems: 'flex-end', gap: 2 },
})
