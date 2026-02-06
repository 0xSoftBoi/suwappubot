import React, { useMemo } from 'react'
import { useCurrentFrame, interpolate, random } from 'remotion'

interface ConfettiParticle {
  id: number
  x: number
  y: number
  rotation: number
  rotationSpeed: number
  size: number
  color: string
  shape: 'square' | 'circle' | 'rectangle'
  velocityX: number
  velocityY: number
  gravity: number
  drag: number
  opacity: number
}

interface ConfettiProps {
  triggerFrame: number
  duration?: number
  particleCount?: number
  colors?: string[]
  spread?: number
  gravity?: number
  originX?: number
  originY?: number
  width?: number
  height?: number
}

/**
 * Physics-based confetti animation.
 * Particles burst from origin with gravity, drag, and rotation.
 */
export const Confetti: React.FC<ConfettiProps> = ({
  triggerFrame,
  duration = 90,
  particleCount = 50,
  colors = ['#FFB7C5', '#E91E8C', '#C44569', '#A8E6A3', '#90CAF9', '#FFE4A0'],
  spread = 70,
  gravity = 0.4,
  originX = 50,
  originY = 50,
  width = 720,
  height = 1280,
}) => {
  const frame = useCurrentFrame()

  if (frame < triggerFrame || frame > triggerFrame + duration) return null

  const localFrame = frame - triggerFrame

  // Generate particles deterministically
  const particles = useMemo(() => {
    const result: ConfettiParticle[] = []
    for (let i = 0; i < particleCount; i++) {
      const angle = (random(`confetti-angle-${i}`) * spread * 2 - spread) * (Math.PI / 180) - Math.PI / 2
      const velocity = 8 + random(`confetti-velocity-${i}`) * 10

      result.push({
        id: i,
        x: (originX / 100) * width,
        y: (originY / 100) * height,
        rotation: random(`confetti-rot-${i}`) * 360,
        rotationSpeed: (random(`confetti-rotspeed-${i}`) - 0.5) * 20,
        size: 6 + random(`confetti-size-${i}`) * 8,
        color: colors[Math.floor(random(`confetti-color-${i}`) * colors.length)],
        shape: ['square', 'circle', 'rectangle'][Math.floor(random(`confetti-shape-${i}`) * 3)] as 'square' | 'circle' | 'rectangle',
        velocityX: Math.cos(angle) * velocity * (random(`confetti-dir-${i}`) > 0.5 ? 1 : -1),
        velocityY: Math.sin(angle) * velocity,
        gravity: gravity * (0.8 + random(`confetti-grav-${i}`) * 0.4),
        drag: 0.97 + random(`confetti-drag-${i}`) * 0.02,
        opacity: 1,
      })
    }
    return result
  }, [particleCount, colors, spread, gravity, originX, originY, width, height])

  // Calculate particle positions based on frame
  const getParticleStyle = (particle: ConfettiParticle): React.CSSProperties => {
    // Physics simulation
    let x = particle.x
    let y = particle.y
    let vx = particle.velocityX
    let vy = particle.velocityY

    for (let t = 0; t < localFrame; t++) {
      vy += particle.gravity
      vx *= particle.drag
      vy *= particle.drag
      x += vx
      y += vy
    }

    const rotation = particle.rotation + particle.rotationSpeed * localFrame

    // Fade out near end
    const opacity = interpolate(localFrame, [duration * 0.7, duration], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })

    const shapeStyle: React.CSSProperties =
      particle.shape === 'circle'
        ? { borderRadius: '50%' }
        : particle.shape === 'rectangle'
        ? { width: particle.size * 0.6 }
        : {}

    return {
      position: 'absolute',
      left: x,
      top: y,
      width: particle.size,
      height: particle.shape === 'rectangle' ? particle.size * 1.5 : particle.size,
      backgroundColor: particle.color,
      transform: `rotate(${rotation}deg)`,
      opacity,
      ...shapeStyle,
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {particles.map((particle) => (
        <div key={particle.id} style={getParticleStyle(particle)} />
      ))}
    </div>
  )
}

interface ConfettiBurstProps {
  triggerFrame: number
  duration?: number
  burstCount?: number
  colors?: string[]
  x?: number
  y?: number
}

/**
 * Radial confetti burst from a specific point.
 * Great for success celebrations.
 */
export const ConfettiBurst: React.FC<ConfettiBurstProps> = ({
  triggerFrame,
  duration = 60,
  burstCount = 30,
  colors = ['#FFB7C5', '#E91E8C', '#C44569', '#A8E6A3', '#FFE4A0'],
  x = 360,
  y = 400,
}) => {
  const frame = useCurrentFrame()

  if (frame < triggerFrame || frame > triggerFrame + duration) return null

  const localFrame = frame - triggerFrame

  const particles = useMemo(() => {
    const result = []
    for (let i = 0; i < burstCount; i++) {
      const angle = (i / burstCount) * Math.PI * 2
      const velocity = 4 + random(`burst-vel-${i}`) * 8
      result.push({
        id: i,
        angle,
        velocity,
        color: colors[i % colors.length],
        size: 4 + random(`burst-size-${i}`) * 6,
        rotationSpeed: (random(`burst-rot-${i}`) - 0.5) * 15,
      })
    }
    return result
  }, [burstCount, colors])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {particles.map((particle) => {
        const distance = particle.velocity * localFrame * 0.5
        const px = x + Math.cos(particle.angle) * distance
        const py = y + Math.sin(particle.angle) * distance + localFrame * localFrame * 0.02

        const opacity = interpolate(localFrame, [duration * 0.6, duration], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        const rotation = particle.rotationSpeed * localFrame

        return (
          <div
            key={particle.id}
            style={{
              position: 'absolute',
              left: px,
              top: py,
              width: particle.size,
              height: particle.size,
              backgroundColor: particle.color,
              transform: `rotate(${rotation}deg)`,
              opacity,
              borderRadius: particle.id % 3 === 0 ? '50%' : 0,
            }}
          />
        )
      })}
    </div>
  )
}

interface SakuraConfettiProps {
  triggerFrame: number
  duration?: number
  petalCount?: number
}

/**
 * Sakura-themed confetti with petal shapes.
 * Uses Suwappu brand colors.
 */
export const SakuraConfetti: React.FC<SakuraConfettiProps> = ({
  triggerFrame,
  duration = 120,
  petalCount = 40,
}) => {
  return (
    <Confetti
      triggerFrame={triggerFrame}
      duration={duration}
      particleCount={petalCount}
      colors={['#FFD1DC', '#FFB7C5', '#F8A5C2', '#E91E8C', '#C44569']}
      gravity={0.25}
      spread={90}
    />
  )
}
