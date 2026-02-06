import React from 'react'
import { useCurrentFrame, interpolate, spring } from 'remotion'

interface ProgressBarProps {
  enterFrame: number
  duration?: number
  targetProgress?: number
  width?: number
  height?: number
  backgroundColor?: string
  fillColor?: string
  borderRadius?: number
  useSpring?: boolean
}

/**
 * Animated progress bar with spring-based or linear fill.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  enterFrame,
  duration = 60,
  targetProgress = 100,
  width = 200,
  height = 8,
  backgroundColor = 'rgba(255, 183, 197, 0.2)',
  fillColor = '#E91E8C',
  borderRadius = 4,
  useSpring = true,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  // Progress animation
  let progress: number
  if (useSpring) {
    const springValue = spring({
      frame: localFrame,
      fps,
      config: { damping: 15, stiffness: 80 },
    })
    progress = springValue * targetProgress
  } else {
    progress = interpolate(localFrame, [0, duration], [0, targetProgress], {
      extrapolateRight: 'clamp',
    })
  }

  // Entrance animation
  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const fillWidth = (progress / 100) * width

  return (
    <div
      style={{
        width,
        height,
        backgroundColor,
        borderRadius,
        overflow: 'hidden',
        opacity,
      }}
    >
      <div
        style={{
          width: fillWidth,
          height: '100%',
          backgroundColor: fillColor,
          borderRadius,
        }}
      />
    </div>
  )
}

interface GradientProgressBarProps {
  enterFrame: number
  duration?: number
  targetProgress?: number
  width?: number
  height?: number
  showPercentage?: boolean
}

/**
 * Progress bar with Suwappu gradient fill.
 */
export const GradientProgressBar: React.FC<GradientProgressBarProps> = ({
  enterFrame,
  duration = 60,
  targetProgress = 100,
  width = 200,
  height = 12,
  showPercentage = false,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const springValue = spring({
    frame: localFrame,
    fps,
    config: { damping: 15, stiffness: 80 },
  })
  const progress = springValue * targetProgress

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const fillWidth = (progress / 100) * width

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity }}>
      <div
        style={{
          width,
          height,
          backgroundColor: 'rgba(255, 183, 197, 0.2)',
          borderRadius: height / 2,
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <div
          style={{
            width: fillWidth,
            height: '100%',
            background: 'linear-gradient(90deg, #FFB7C5 0%, #E91E8C 50%, #C44569 100%)',
            borderRadius: height / 2,
            boxShadow: '0 2px 8px rgba(233, 30, 140, 0.3)',
          }}
        />
      </div>
      {showPercentage && (
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            color: '#E91E8C',
            minWidth: 45,
          }}
        >
          {Math.round(progress)}%
        </div>
      )}
    </div>
  )
}

interface StepProgressProps {
  enterFrame: number
  totalSteps: number
  currentStep: number
  stepLabels?: string[]
  size?: 'small' | 'medium' | 'large'
}

/**
 * Step-based progress indicator for multi-step flows.
 */
export const StepProgress: React.FC<StepProgressProps> = ({
  enterFrame,
  totalSteps,
  currentStep,
  stepLabels,
  size = 'medium',
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const sizes = {
    small: { circle: 24, line: 2, font: 11 },
    medium: { circle: 32, line: 3, font: 13 },
    large: { circle: 40, line: 4, font: 15 },
  }
  const { circle, line, font } = sizes[size]

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {Array.from({ length: totalSteps }).map((_, index) => {
          const isCompleted = index < currentStep
          const isCurrent = index === currentStep
          const stepFrame = enterFrame + index * 8

          const stepSpring = spring({
            frame: Math.max(0, localFrame - index * 8),
            fps,
            config: { damping: 12, stiffness: 150 },
          })

          return (
            <React.Fragment key={index}>
              {/* Step circle */}
              <div
                style={{
                  width: circle,
                  height: circle,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                  fontSize: font,
                  fontWeight: 600,
                  backgroundColor: isCompleted
                    ? '#E91E8C'
                    : isCurrent
                    ? '#FFB7C5'
                    : '#f0f0f0',
                  color: isCompleted || isCurrent ? '#fff' : '#6C7A89',
                  transform: `scale(${stepSpring})`,
                  boxShadow: isCurrent
                    ? '0 0 0 4px rgba(233, 30, 140, 0.2)'
                    : undefined,
                }}
              >
                {isCompleted ? '✓' : index + 1}
              </div>

              {/* Connector line */}
              {index < totalSteps - 1 && (
                <div
                  style={{
                    width: 40,
                    height: line,
                    backgroundColor: isCompleted ? '#E91E8C' : '#e0e0e0',
                    marginLeft: 4,
                    marginRight: 4,
                  }}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Step labels */}
      {stepLabels && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            marginTop: 8,
          }}
        >
          {stepLabels.map((label, index) => (
            <div
              key={index}
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: font - 2,
                color: index <= currentStep ? '#E91E8C' : '#6C7A89',
                textAlign: 'center',
                flex: 1,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CountingNumberProps {
  enterFrame: number
  duration?: number
  startValue?: number
  endValue: number
  prefix?: string
  suffix?: string
  decimals?: number
  style?: React.CSSProperties
}

/**
 * Animated counting number (e.g., $0 → $12,847).
 */
export const CountingNumber: React.FC<CountingNumberProps> = ({
  enterFrame,
  duration = 45,
  startValue = 0,
  endValue,
  prefix = '',
  suffix = '',
  decimals = 0,
  style,
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  // Ease out for natural deceleration
  const progress = interpolate(localFrame, [0, duration], [0, 1], {
    extrapolateRight: 'clamp',
  })
  const easedProgress = 1 - Math.pow(1 - progress, 3)

  const currentValue = startValue + (endValue - startValue) * easedProgress

  // Format number with commas
  const formattedValue = currentValue.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return (
    <span style={style}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  )
}
