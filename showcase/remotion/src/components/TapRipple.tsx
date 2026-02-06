import React from 'react'
import { useCurrentFrame, interpolate, spring } from 'remotion'

interface TapRippleProps {
  triggerFrame: number
  duration?: number
  color?: string
  x?: number | string
  y?: number | string
  maxRadius?: number
}

/**
 * Expanding circle ripple effect from tap point.
 * Use for button tap feedback animations.
 */
export const TapRipple: React.FC<TapRippleProps> = ({
  triggerFrame,
  duration = 20,
  color = 'rgba(233, 30, 140, 0.3)',
  x = '50%',
  y = '50%',
  maxRadius = 100,
}) => {
  const frame = useCurrentFrame()

  if (frame < triggerFrame || frame > triggerFrame + duration) return null

  const localFrame = frame - triggerFrame

  // Ripple expands quickly then slows (ease-out)
  const progress = interpolate(localFrame, [0, duration], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const radius = interpolate(progress, [0, 1], [0, maxRadius], {
    extrapolateRight: 'clamp',
  })

  const opacity = interpolate(progress, [0, 0.3, 1], [0.6, 0.4, 0], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: radius * 2,
        height: radius * 2,
        borderRadius: '50%',
        backgroundColor: color,
        opacity,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    />
  )
}

interface TapHighlightProps {
  triggerFrame: number
  duration?: number
  highlightColor?: string
  glowColor?: string
  children: React.ReactNode
  style?: React.CSSProperties
  showRipple?: boolean
}

/**
 * Button tap highlight with optional ripple effect.
 * Wraps a button/element and shows tap feedback.
 */
export const TapHighlight: React.FC<TapHighlightProps> = ({
  triggerFrame,
  duration = 15,
  highlightColor = '#E91E8C',
  glowColor = 'rgba(233, 30, 140, 0.4)',
  children,
  style,
  showRipple = true,
}) => {
  const frame = useCurrentFrame()

  const isActive = frame >= triggerFrame && frame < triggerFrame + duration

  // Scale pulse on tap
  const scale = isActive
    ? interpolate(frame - triggerFrame, [0, 5, duration], [1, 0.96, 1], {
        extrapolateRight: 'clamp',
      })
    : 1

  // Glow effect
  const glowIntensity = isActive
    ? interpolate(frame - triggerFrame, [0, 5, duration], [0, 1, 0], {
        extrapolateRight: 'clamp',
      })
    : 0

  return (
    <div
      style={{
        ...style,
        position: 'relative',
        overflow: 'hidden',
        transform: `scale(${scale})`,
        boxShadow: glowIntensity > 0
          ? `0 0 ${20 * glowIntensity}px ${glowColor}`
          : undefined,
        transition: 'box-shadow 0.1s ease',
      }}
    >
      {children}
      {showRipple && isActive && (
        <TapRipple
          triggerFrame={triggerFrame}
          duration={duration}
          color={glowColor}
        />
      )}
    </div>
  )
}

interface ButtonTapProps {
  triggerFrame: number
  duration?: number
  normalBg: string
  activeBg: string
  normalColor: string
  activeColor: string
  children: React.ReactNode
  style?: React.CSSProperties
  showRipple?: boolean
  rippleColor?: string
}

/**
 * Complete button component with tap state animation.
 * Shows color change, scale, and optional ripple on tap.
 */
export const ButtonTap: React.FC<ButtonTapProps> = ({
  triggerFrame,
  duration = 30,
  normalBg,
  activeBg,
  normalColor,
  activeColor,
  children,
  style,
  showRipple = true,
  rippleColor = 'rgba(255, 255, 255, 0.3)',
}) => {
  const frame = useCurrentFrame()

  const isActive = frame >= triggerFrame
  const isAnimating = frame >= triggerFrame && frame < triggerFrame + 15

  // Scale animation on tap
  const scale = isAnimating
    ? interpolate(frame - triggerFrame, [0, 5, 15], [1, 0.95, 1], {
        extrapolateRight: 'clamp',
      })
    : 1

  // Color transition
  const colorProgress = isActive
    ? interpolate(frame - triggerFrame, [0, 8], [0, 1], {
        extrapolateRight: 'clamp',
      })
    : 0

  return (
    <div
      style={{
        ...style,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: colorProgress > 0.5 ? activeBg : normalBg,
        color: colorProgress > 0.5 ? activeColor : normalColor,
        transform: `scale(${scale})`,
      }}
    >
      {children}
      {showRipple && isAnimating && (
        <TapRipple
          triggerFrame={triggerFrame}
          duration={20}
          color={rippleColor}
        />
      )}
    </div>
  )
}

interface GlowPulseProps {
  triggerFrame: number
  duration?: number
  color?: string
  intensity?: number
  children: React.ReactNode
  style?: React.CSSProperties
}

/**
 * Glow pulse effect for success states or emphasis.
 */
export const GlowPulse: React.FC<GlowPulseProps> = ({
  triggerFrame,
  duration = 30,
  color = 'rgba(168, 230, 163, 0.5)',
  intensity = 20,
  children,
  style,
}) => {
  const frame = useCurrentFrame()

  if (frame < triggerFrame) {
    return <div style={style}>{children}</div>
  }

  const localFrame = frame - triggerFrame

  // Pulse in and out
  const glowAmount = localFrame < duration
    ? interpolate(localFrame, [0, duration / 2, duration], [0, intensity, 0], {
        extrapolateRight: 'clamp',
      })
    : 0

  return (
    <div
      style={{
        ...style,
        boxShadow: glowAmount > 0 ? `0 0 ${glowAmount}px ${color}` : undefined,
      }}
    >
      {children}
    </div>
  )
}
