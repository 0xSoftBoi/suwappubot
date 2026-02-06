import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'

interface BlurTransitionProps {
  startFrame: number
  duration?: number
  maxBlur?: number
  children: React.ReactNode
  direction?: 'in' | 'out' | 'inOut'
}

/**
 * Blur transition effect for scene changes.
 * Blurs out from 0→maxBlur, then can blur back in.
 */
export const BlurTransition: React.FC<BlurTransitionProps> = ({
  startFrame,
  duration = 20,
  maxBlur = 10,
  children,
  direction = 'out',
}) => {
  const frame = useCurrentFrame()

  let blur = 0
  let opacity = 1

  if (direction === 'out' && frame >= startFrame) {
    const localFrame = frame - startFrame
    blur = interpolate(localFrame, [0, duration], [0, maxBlur], {
      extrapolateRight: 'clamp',
    })
    opacity = interpolate(localFrame, [0, duration], [1, 0], {
      extrapolateRight: 'clamp',
    })
  } else if (direction === 'in' && frame >= startFrame) {
    const localFrame = frame - startFrame
    blur = interpolate(localFrame, [0, duration], [maxBlur, 0], {
      extrapolateRight: 'clamp',
    })
    opacity = interpolate(localFrame, [0, duration], [0, 1], {
      extrapolateRight: 'clamp',
    })
  } else if (direction === 'inOut') {
    const halfDuration = duration / 2
    if (frame >= startFrame && frame < startFrame + halfDuration) {
      const localFrame = frame - startFrame
      blur = interpolate(localFrame, [0, halfDuration], [0, maxBlur], {
        extrapolateRight: 'clamp',
      })
      opacity = interpolate(localFrame, [0, halfDuration], [1, 0], {
        extrapolateRight: 'clamp',
      })
    } else if (frame >= startFrame + halfDuration && frame < startFrame + duration) {
      const localFrame = frame - startFrame - halfDuration
      blur = interpolate(localFrame, [0, halfDuration], [maxBlur, 0], {
        extrapolateRight: 'clamp',
      })
      opacity = interpolate(localFrame, [0, halfDuration], [0, 1], {
        extrapolateRight: 'clamp',
      })
    }
  }

  return (
    <div
      style={{
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
        opacity,
        width: '100%',
        height: '100%',
      }}
    >
      {children}
    </div>
  )
}

interface SceneTransitionProps {
  transitionFrame: number
  duration?: number
  type?: 'blur' | 'fade' | 'slide' | 'zoom'
  slideDirection?: 'left' | 'right' | 'up' | 'down'
  outgoingContent: React.ReactNode
  incomingContent: React.ReactNode
}

/**
 * Complete scene transition with multiple effect types.
 * Handles both outgoing and incoming content.
 */
export const SceneTransition: React.FC<SceneTransitionProps> = ({
  transitionFrame,
  duration = 20,
  type = 'blur',
  slideDirection = 'left',
  outgoingContent,
  incomingContent,
}) => {
  const frame = useCurrentFrame()
  const halfDuration = duration / 2

  const isBeforeTransition = frame < transitionFrame
  const isInTransition = frame >= transitionFrame && frame < transitionFrame + duration
  const isAfterTransition = frame >= transitionFrame + duration

  const localFrame = Math.max(0, frame - transitionFrame)

  // Calculate transition progress (0 to 1)
  const progress = interpolate(localFrame, [0, duration], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const getOutgoingStyle = (): React.CSSProperties => {
    if (isAfterTransition) return { display: 'none' }

    switch (type) {
      case 'blur': {
        const blur = interpolate(progress, [0, 0.5], [0, 10], { extrapolateRight: 'clamp' })
        const opacity = interpolate(progress, [0, 0.5], [1, 0], { extrapolateRight: 'clamp' })
        return { filter: `blur(${blur}px)`, opacity }
      }
      case 'fade': {
        const opacity = interpolate(progress, [0, 0.5], [1, 0], { extrapolateRight: 'clamp' })
        return { opacity }
      }
      case 'slide': {
        const distance = 100
        const offset = interpolate(progress, [0, 0.5], [0, distance], { extrapolateRight: 'clamp' })
        const opacity = interpolate(progress, [0, 0.5], [1, 0], { extrapolateRight: 'clamp' })
        const transform =
          slideDirection === 'left' ? `translateX(-${offset}%)` :
          slideDirection === 'right' ? `translateX(${offset}%)` :
          slideDirection === 'up' ? `translateY(-${offset}%)` :
          `translateY(${offset}%)`
        return { transform, opacity }
      }
      case 'zoom': {
        const scale = interpolate(progress, [0, 0.5], [1, 1.1], { extrapolateRight: 'clamp' })
        const opacity = interpolate(progress, [0, 0.5], [1, 0], { extrapolateRight: 'clamp' })
        return { transform: `scale(${scale})`, opacity }
      }
      default:
        return {}
    }
  }

  const getIncomingStyle = (): React.CSSProperties => {
    if (isBeforeTransition) return { display: 'none' }

    switch (type) {
      case 'blur': {
        const blur = interpolate(progress, [0.5, 1], [10, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        const opacity = interpolate(progress, [0.5, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        return { filter: `blur(${blur}px)`, opacity }
      }
      case 'fade': {
        const opacity = interpolate(progress, [0.5, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        return { opacity }
      }
      case 'slide': {
        const distance = 100
        const offset = interpolate(progress, [0.5, 1], [distance, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        const opacity = interpolate(progress, [0.5, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        const transform =
          slideDirection === 'left' ? `translateX(${offset}%)` :
          slideDirection === 'right' ? `translateX(-${offset}%)` :
          slideDirection === 'up' ? `translateY(${offset}%)` :
          `translateY(-${offset}%)`
        return { transform, opacity }
      }
      case 'zoom': {
        const scale = interpolate(progress, [0.5, 1], [0.9, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        const opacity = interpolate(progress, [0.5, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        return { transform: `scale(${scale})`, opacity }
      }
      default:
        return {}
    }
  }

  return (
    <AbsoluteFill>
      <AbsoluteFill style={getOutgoingStyle()}>
        {outgoingContent}
      </AbsoluteFill>
      <AbsoluteFill style={getIncomingStyle()}>
        {incomingContent}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

interface ScreenSlideProps {
  enterFrame: number
  duration?: number
  direction?: 'left' | 'right' | 'up' | 'down'
  children: React.ReactNode
}

/**
 * Simple screen slide-in effect.
 * Useful for tab/screen navigation animations.
 */
export const ScreenSlide: React.FC<ScreenSlideProps> = ({
  enterFrame,
  duration = 15,
  direction = 'left',
  children,
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame
  const progress = interpolate(localFrame, [0, duration], [0, 1], {
    extrapolateRight: 'clamp',
  })

  // Ease out curve for smooth deceleration
  const easedProgress = 1 - Math.pow(1 - progress, 3)

  const getTransform = () => {
    const remaining = 1 - easedProgress
    switch (direction) {
      case 'left':
        return `translateX(${remaining * 100}%)`
      case 'right':
        return `translateX(${-remaining * 100}%)`
      case 'up':
        return `translateY(${remaining * 100}%)`
      case 'down':
        return `translateY(${-remaining * 100}%)`
      default:
        return 'none'
    }
  }

  return (
    <AbsoluteFill style={{ transform: getTransform() }}>
      {children}
    </AbsoluteFill>
  )
}
