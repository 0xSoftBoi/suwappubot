import React, { useMemo } from 'react'
import { useCurrentFrame, interpolate, random } from 'remotion'

interface Petal {
  id: number
  startX: number
  startY: number
  size: number
  rotation: number
  rotationSpeed: number
  swayAmplitude: number
  swayFrequency: number
  fallSpeed: number
  opacity: number
  color: string
  delay: number
}

interface SakuraPetalsProps {
  startFrame?: number
  duration?: number
  petalCount?: number
  width?: number
  height?: number
  colors?: string[]
  fallSpeed?: number
  windStrength?: number
}

/**
 * Floating sakura petal effect for Remotion videos.
 * Petals drift down with sine wave movement, rotation, and opacity fade.
 */
export const SakuraPetals: React.FC<SakuraPetalsProps> = ({
  startFrame = 0,
  duration = 900,
  petalCount = 20,
  width = 720,
  height = 1280,
  colors = ['#FFD1DC', '#FFB7C5', '#F8A5C2', '#FFC0CB'],
  fallSpeed = 1.5,
  windStrength = 30,
}) => {
  const frame = useCurrentFrame()

  if (frame < startFrame) return null

  const localFrame = frame - startFrame

  // Generate petals deterministically
  const petals = useMemo(() => {
    const result: Petal[] = []
    for (let i = 0; i < petalCount; i++) {
      result.push({
        id: i,
        startX: random(`petal-x-${i}`) * width,
        startY: -50 - random(`petal-y-${i}`) * 200,
        size: 8 + random(`petal-size-${i}`) * 12,
        rotation: random(`petal-rot-${i}`) * 360,
        rotationSpeed: (random(`petal-rotspeed-${i}`) - 0.5) * 4,
        swayAmplitude: windStrength * (0.5 + random(`petal-sway-${i}`) * 0.5),
        swayFrequency: 0.02 + random(`petal-freq-${i}`) * 0.02,
        fallSpeed: fallSpeed * (0.7 + random(`petal-fall-${i}`) * 0.6),
        opacity: 0.6 + random(`petal-opacity-${i}`) * 0.4,
        color: colors[Math.floor(random(`petal-color-${i}`) * colors.length)],
        delay: random(`petal-delay-${i}`) * 120,
      })
    }
    return result
  }, [petalCount, width, colors, fallSpeed, windStrength])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {petals.map((petal) => {
        const effectiveFrame = Math.max(0, localFrame - petal.delay)
        if (effectiveFrame <= 0) return null

        // Calculate position
        const y = petal.startY + effectiveFrame * petal.fallSpeed
        const swayOffset = Math.sin(effectiveFrame * petal.swayFrequency) * petal.swayAmplitude
        const x = petal.startX + swayOffset

        // Loop the petal when it goes off screen
        const normalizedY = ((y + 50) % (height + 100)) - 50

        // Rotation
        const rotation = petal.rotation + effectiveFrame * petal.rotationSpeed

        // Slight opacity pulse
        const opacityPulse = 0.8 + Math.sin(effectiveFrame * 0.05) * 0.2

        return (
          <div
            key={petal.id}
            style={{
              position: 'absolute',
              left: x,
              top: normalizedY,
              transform: `rotate(${rotation}deg)`,
              opacity: petal.opacity * opacityPulse,
            }}
          >
            <PetalShape size={petal.size} color={petal.color} />
          </div>
        )
      })}
    </div>
  )
}

interface PetalShapeProps {
  size: number
  color: string
}

/**
 * SVG sakura petal shape.
 */
const PetalShape: React.FC<PetalShapeProps> = ({ size, color }) => (
  <svg
    width={size}
    height={size * 1.2}
    viewBox="0 0 20 24"
    style={{ display: 'block' }}
  >
    <defs>
      <linearGradient id={`petal-grad-${color.replace('#', '')}`} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={color} stopOpacity="1" />
        <stop offset="100%" stopColor={color} stopOpacity="0.6" />
      </linearGradient>
    </defs>
    <path
      d="M10 0 C14 4 18 10 18 16 C18 20 14 24 10 24 C6 24 2 20 2 16 C2 10 6 4 10 0"
      fill={`url(#petal-grad-${color.replace('#', '')})`}
    />
    <path
      d="M10 4 C10 10 10 18 10 22"
      stroke={color}
      strokeOpacity="0.3"
      strokeWidth="0.5"
      fill="none"
    />
  </svg>
)

interface FloatingPetalsProps {
  enterFrame: number
  exitFrame?: number
  petalCount?: number
  density?: 'light' | 'medium' | 'heavy'
}

/**
 * Pre-configured floating petals with density presets.
 */
export const FloatingPetals: React.FC<FloatingPetalsProps> = ({
  enterFrame,
  exitFrame,
  petalCount,
  density = 'medium',
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null
  if (exitFrame && frame > exitFrame) return null

  const densityMap = {
    light: 10,
    medium: 20,
    heavy: 35,
  }

  const count = petalCount || densityMap[density]

  return (
    <SakuraPetals
      startFrame={enterFrame}
      duration={exitFrame ? exitFrame - enterFrame : 900}
      petalCount={count}
    />
  )
}

interface PetalBurstProps {
  triggerFrame: number
  duration?: number
  petalCount?: number
  originX?: number
  originY?: number
}

/**
 * Petal burst effect from a specific point.
 * Great for celebration moments.
 */
export const PetalBurst: React.FC<PetalBurstProps> = ({
  triggerFrame,
  duration = 60,
  petalCount = 15,
  originX = 360,
  originY = 400,
}) => {
  const frame = useCurrentFrame()

  if (frame < triggerFrame || frame > triggerFrame + duration) return null

  const localFrame = frame - triggerFrame

  const petals = useMemo(() => {
    const result = []
    for (let i = 0; i < petalCount; i++) {
      const angle = (random(`burst-petal-angle-${i}`) * Math.PI * 2)
      const velocity = 3 + random(`burst-petal-vel-${i}`) * 5
      result.push({
        id: i,
        angle,
        velocity,
        size: 10 + random(`burst-petal-size-${i}`) * 8,
        rotationSpeed: (random(`burst-petal-rot-${i}`) - 0.5) * 10,
        color: ['#FFD1DC', '#FFB7C5', '#F8A5C2', '#E91E8C'][i % 4],
      })
    }
    return result
  }, [petalCount])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {petals.map((petal) => {
        const distance = petal.velocity * localFrame
        const gravity = localFrame * localFrame * 0.01
        const x = originX + Math.cos(petal.angle) * distance
        const y = originY + Math.sin(petal.angle) * distance + gravity

        const opacity = interpolate(localFrame, [duration * 0.5, duration], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        const rotation = localFrame * petal.rotationSpeed

        return (
          <div
            key={petal.id}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: `rotate(${rotation}deg)`,
              opacity,
            }}
          >
            <PetalShape size={petal.size} color={petal.color} />
          </div>
        )
      })}
    </div>
  )
}
