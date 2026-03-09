/**
 * Skeleton shimmer loading placeholder.
 *
 * Uses a simple opacity animation to create a pulsing effect.
 * Reanimated-based shimmer can be added later for a gradient sweep.
 */
import { useEffect, useRef } from 'react'
import { View, Animated, StyleSheet, type ViewStyle } from 'react-native'
import { colors, radius } from '../../lib/theme'

interface SkeletonProps {
  width?: number | string
  height?: number
  borderRadius?: number
  style?: ViewStyle
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius: br = radius.sm,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [opacity])

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: br,
          backgroundColor: colors.cardAlt,
          opacity,
        },
        style,
      ]}
    />
  )
}

/** Skeleton for a typical list row (icon + two text lines + right value). */
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={40} height={40} borderRadius={20} />
      <View style={styles.rowContent}>
        <Skeleton width={120} height={14} />
        <Skeleton width={80} height={12} style={{ marginTop: 6 }} />
      </View>
      <View style={styles.rowRight}>
        <Skeleton width={60} height={14} />
        <Skeleton width={40} height={12} style={{ marginTop: 6 }} />
      </View>
    </View>
  )
}

/** Skeleton for a card (stat block, chart placeholder, etc.). */
export function SkeletonCard({ height = 120 }: { height?: number }) {
  return <Skeleton width="100%" height={height} borderRadius={radius.lg} />
}

/** Full-screen skeleton for a typical list screen. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  )
}

/** Skeleton for a portfolio/dashboard screen. */
export function SkeletonDashboard() {
  return (
    <View style={styles.dashboard}>
      <Skeleton width={160} height={32} style={{ alignSelf: 'center' }} />
      <Skeleton width={100} height={16} style={{ alignSelf: 'center', marginTop: 8 }} />
      <SkeletonCard height={200} />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  rowContent: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  list: { paddingHorizontal: 24, paddingTop: 16, gap: 4 },
  dashboard: { padding: 24, gap: 16 },
})
