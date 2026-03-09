/**
 * Token logo with fallback to generated avatar.
 *
 * Tries to load logoUrl first. If unavailable or failed,
 * shows a colored circle with the first 1-2 characters of the symbol.
 * Color is deterministic based on the token address hash.
 */
import { useState } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA',
  '#F1948A', '#AED6F1', '#A3E4D7', '#FAD7A0',
]

interface TokenLogoProps {
  logoUrl?: string | null
  symbol: string
  address?: string
  size?: number
  /** Optional chain badge overlay */
  chainBadge?: string
}

function hashToIndex(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % AVATAR_COLORS.length
}

export default function TokenLogo({
  logoUrl,
  symbol,
  address,
  size = 40,
  chainBadge,
}: TokenLogoProps) {
  const [imgError, setImgError] = useState(false)
  const showImage = logoUrl && !imgError

  const bgColor = AVATAR_COLORS[hashToIndex(address || symbol)]
  const initials = symbol.slice(0, 2).toUpperCase()
  const fontSize = size * 0.35

  return (
    <View style={{ width: size, height: size }}>
      {showImage ? (
        <Image
          source={{ uri: logoUrl }}
          style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
          onError={() => setImgError(true)}
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: bgColor,
            },
          ]}
        >
          <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
        </View>
      )}
      {chainBadge && (
        <View style={[styles.badge, { right: -2, bottom: -2 }]}>
          <Text style={styles.badgeText}>{chainBadge}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.cardAlt },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontWeight: '700', color: '#fff' },
  badge: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  badgeText: { fontSize: 8, fontWeight: '700', color: colors.text },
})
