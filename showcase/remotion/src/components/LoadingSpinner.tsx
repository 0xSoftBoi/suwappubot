import React from 'react'
import { useCurrentFrame, interpolate } from 'remotion'

interface LoadingSpinnerProps {
  enterFrame?: number
  exitFrame?: number
  size?: number
  strokeWidth?: number
  color?: string
  secondaryColor?: string
  speed?: number
}

/**
 * Animated loading spinner with rotating gradient ring.
 */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  enterFrame = 0,
  exitFrame,
  size = 40,
  strokeWidth = 4,
  color = '#E91E8C',
  secondaryColor = 'rgba(233, 30, 140, 0.2)',
  speed = 1,
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null
  if (exitFrame !== undefined && frame >= exitFrame) return null

  const localFrame = frame - enterFrame

  // Rotation animation
  const rotation = localFrame * 8 * speed

  // Entrance fade
  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
    >
      <svg
        width={size}
        height={size}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={secondaryColor}
          strokeWidth={strokeWidth}
        />
        {/* Animated arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * 0.75}
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

interface PulsingDotsProps {
  enterFrame?: number
  exitFrame?: number
  dotSize?: number
  color?: string
  gap?: number
}

/**
 * Three pulsing dots loading indicator.
 */
export const PulsingDots: React.FC<PulsingDotsProps> = ({
  enterFrame = 0,
  exitFrame,
  dotSize = 8,
  color = '#E91E8C',
  gap = 6,
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null
  if (exitFrame !== undefined && frame >= exitFrame) return null

  const localFrame = frame - enterFrame

  const getDotScale = (dotIndex: number) => {
    const cycleFrame = (localFrame + dotIndex * 6) % 24
    return interpolate(cycleFrame, [0, 8, 16, 24], [0.6, 1.2, 0.6, 0.6], {
      extrapolateRight: 'clamp',
    })
  }

  const getDotOpacity = (dotIndex: number) => {
    const cycleFrame = (localFrame + dotIndex * 6) % 24
    return interpolate(cycleFrame, [0, 8, 16, 24], [0.4, 1, 0.4, 0.4], {
      extrapolateRight: 'clamp',
    })
  }

  // Entrance animation
  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap,
        opacity,
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            backgroundColor: color,
            transform: `scale(${getDotScale(i)})`,
            opacity: getDotOpacity(i),
          }}
        />
      ))}
    </div>
  )
}

interface OverlaySpinnerProps {
  enterFrame: number
  exitFrame?: number
  message?: string
  backgroundColor?: string
}

/**
 * Full-screen overlay with centered spinner and optional message.
 */
export const OverlaySpinner: React.FC<OverlaySpinnerProps> = ({
  enterFrame,
  exitFrame,
  message,
  backgroundColor = 'rgba(0, 0, 0, 0.5)',
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null
  if (exitFrame !== undefined && frame >= exitFrame) return null

  const localFrame = frame - enterFrame

  const opacity = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        opacity,
      }}
    >
      <LoadingSpinner size={50} color="#fff" secondaryColor="rgba(255,255,255,0.2)" />
      {message && (
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 14,
            color: '#fff',
            fontWeight: 500,
          }}
        >
          {message}
        </div>
      )}
    </div>
  )
}

interface GradientSpinnerProps {
  enterFrame?: number
  exitFrame?: number
  size?: number
  strokeWidth?: number
}

/**
 * Spinner with Suwappu gradient colors.
 */
export const GradientSpinner: React.FC<GradientSpinnerProps> = ({
  enterFrame = 0,
  exitFrame,
  size = 48,
  strokeWidth = 4,
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null
  if (exitFrame !== undefined && frame >= exitFrame) return null

  const localFrame = frame - enterFrame
  const rotation = localFrame * 8

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div
      style={{
        width: size,
        height: size,
        opacity,
      }}
    >
      <svg
        width={size}
        height={size}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <defs>
          <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFB7C5" />
            <stop offset="50%" stopColor="#E91E8C" />
            <stop offset="100%" stopColor="#C44569" />
          </linearGradient>
        </defs>
        {/* Background */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 183, 197, 0.2)"
          strokeWidth={strokeWidth}
        />
        {/* Gradient arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#spinner-gradient)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * 0.7}
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
