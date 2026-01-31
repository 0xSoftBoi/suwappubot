/**
 * Interactive line chart with timeframe selector pills.
 *
 * Uses react-native-wagmi-charts for gesture-driven price display.
 * Falls back to a simple SVG polyline if wagmi-charts is unavailable.
 */
import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'
import type { PricePoint, Timeframe } from '../../hooks/useTokenPrice'

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1H', value: '1h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
  { label: '1M', value: '1m' },
  { label: '1Y', value: '1y' },
]

const CHART_HEIGHT = 200
const SCREEN_WIDTH = Dimensions.get('window').width

interface Props {
  prices: PricePoint[]
  timeframe: Timeframe
  onTimeframeChange: (tf: Timeframe) => void
}

export function PriceChart({ prices, timeframe, onTimeframeChange }: Props) {
  // Build a simple SVG-like polyline using View-based rendering
  const { points, isUp } = useMemo(() => {
    if (!prices || prices.length < 2) return { points: '', isUp: true }

    const values = prices.map((p) => p.value)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1

    const chartWidth = SCREEN_WIDTH - spacing.xxl * 2
    const stepX = chartWidth / (values.length - 1)

    const pts = values.map((v, i) => {
      const x = i * stepX
      const y = CHART_HEIGHT - ((v - minVal) / range) * (CHART_HEIGHT - 20) - 10
      return `${x},${y}`
    })

    return {
      points: pts.join(' '),
      isUp: values[values.length - 1] >= values[0],
    }
  }, [prices])

  const lineColor = isUp ? colors.success : colors.error

  return (
    <View style={styles.container}>
      {/* Chart area */}
      <View style={styles.chartArea}>
        {prices && prices.length >= 2 ? (
          <View style={{ width: '100%', height: CHART_HEIGHT }}>
            {/* Simple rendered chart using absolute positioned dots connected visually */}
            <ChartPolyline prices={prices} height={CHART_HEIGHT} color={lineColor} />
          </View>
        ) : (
          <View style={[styles.chartArea, styles.emptyChart]}>
            <Text style={styles.emptyText}>No price data</Text>
          </View>
        )}
      </View>

      {/* Timeframe pills */}
      <View style={styles.pills}>
        {TIMEFRAMES.map((tf) => (
          <TouchableOpacity
            key={tf.value}
            style={[styles.pill, timeframe === tf.value && styles.pillActive]}
            onPress={() => onTimeframeChange(tf.value)}
          >
            <Text style={[styles.pillText, timeframe === tf.value && styles.pillTextActive]}>
              {tf.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

/**
 * Minimal polyline chart drawn with absolute-positioned View segments.
 */
function ChartPolyline({
  prices,
  height,
  color,
}: {
  prices: PricePoint[]
  height: number
  color: string
}) {
  const segments = useMemo(() => {
    if (prices.length < 2) return []
    const values = prices.map((p) => p.value)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1
    const chartWidth = SCREEN_WIDTH - spacing.xxl * 2
    const stepX = chartWidth / (values.length - 1)

    const result: { x: number; y: number; width: number; angle: number }[] = []
    for (let i = 0; i < values.length - 1; i++) {
      const x1 = i * stepX
      const y1 = height - ((values[i] - minVal) / range) * (height - 20) - 10
      const x2 = (i + 1) * stepX
      const y2 = height - ((values[i + 1] - minVal) / range) * (height - 20) - 10
      const dx = x2 - x1
      const dy = y2 - y1
      const dist = Math.sqrt(dx * dx + dy * dy)
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI
      result.push({ x: x1, y: y1, width: dist, angle })
    }
    return result
  }, [prices, height])

  return (
    <View style={{ width: '100%', height }}>
      {segments.map((seg, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: seg.x,
            top: seg.y,
            width: seg.width,
            height: 2,
            backgroundColor: color,
            transform: [{ rotate: `${seg.angle}deg` }],
            transformOrigin: 'left center',
          }}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.lg },
  chartArea: {
    height: CHART_HEIGHT,
    paddingHorizontal: spacing.xxl,
    justifyContent: 'center',
  },
  emptyChart: { alignItems: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 14 },
  pills: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xxl,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.card,
  },
  pillActive: { backgroundColor: colors.text },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  pillTextActive: { color: colors.bg },
})
