import React from 'react'
import { useCurrentFrame, spring, interpolate } from 'remotion'

type Direction = 'up' | 'down' | 'left' | 'right'

interface SpringSlideProps {
  enterFrame: number
  direction?: Direction
  distance?: number
  damping?: number
  stiffness?: number
  children: React.ReactNode
  style?: React.CSSProperties
  fadeIn?: boolean
}

/**
 * Spring-based slide-in animation component.
 * Premium motion with configurable spring physics.
 */
export const SpringSlide: React.FC<SpringSlideProps> = ({
  enterFrame,
  direction = 'up',
  distance = 30,
  damping = 12,
  stiffness = 120,
  children,
  style,
  fadeIn = true,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  // Spring animation progress (0 to 1)
  const springProgress = spring({
    frame: localFrame,
    fps,
    config: { damping, stiffness },
  })

  // Calculate transform based on direction
  const getTransform = () => {
    const offset = (1 - springProgress) * distance
    switch (direction) {
      case 'up':
        return `translateY(${offset}px)`
      case 'down':
        return `translateY(${-offset}px)`
      case 'left':
        return `translateX(${offset}px)`
      case 'right':
        return `translateX(${-offset}px)`
      default:
        return 'none'
    }
  }

  // Optional fade in
  const opacity = fadeIn
    ? interpolate(localFrame, [0, 8], [0, 1], {
        extrapolateRight: 'clamp',
      })
    : 1

  return (
    <div
      style={{
        ...style,
        transform: getTransform(),
        opacity,
      }}
    >
      {children}
    </div>
  )
}

interface SpringScaleProps {
  enterFrame: number
  initialScale?: number
  damping?: number
  stiffness?: number
  children: React.ReactNode
  style?: React.CSSProperties
  fadeIn?: boolean
}

/**
 * Spring-based scale animation.
 * Great for success states, modals, or attention-grabbing elements.
 */
export const SpringScale: React.FC<SpringScaleProps> = ({
  enterFrame,
  initialScale = 0,
  damping = 10,
  stiffness = 100,
  children,
  style,
  fadeIn = true,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const scale = spring({
    frame: localFrame,
    fps,
    config: { damping, stiffness },
    from: initialScale,
    to: 1,
  })

  const opacity = fadeIn
    ? interpolate(localFrame, [0, 6], [0, 1], {
        extrapolateRight: 'clamp',
      })
    : 1

  return (
    <div
      style={{
        ...style,
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      {children}
    </div>
  )
}

interface StaggeredSlideProps {
  enterFrame: number
  direction?: Direction
  distance?: number
  damping?: number
  stiffness?: number
  staggerDelay?: number
  children: React.ReactNode[]
  itemStyle?: React.CSSProperties
  containerStyle?: React.CSSProperties
}

/**
 * Staggered slide-in for multiple items.
 * Each child animates with a delay after the previous.
 */
export const StaggeredSlide: React.FC<StaggeredSlideProps> = ({
  enterFrame,
  direction = 'up',
  distance = 20,
  damping = 12,
  stiffness = 120,
  staggerDelay = 3,
  children,
  itemStyle,
  containerStyle,
}) => {
  return (
    <div style={containerStyle}>
      {React.Children.map(children, (child, index) => (
        <SpringSlide
          enterFrame={enterFrame + index * staggerDelay}
          direction={direction}
          distance={distance}
          damping={damping}
          stiffness={stiffness}
          style={itemStyle}
        >
          {child}
        </SpringSlide>
      ))}
    </div>
  )
}

interface SlideAndBounceProps {
  enterFrame: number
  direction?: Direction
  distance?: number
  bounceHeight?: number
  children: React.ReactNode
  style?: React.CSSProperties
}

/**
 * Slide in with a subtle bounce at the end.
 * More playful motion for UI elements.
 */
export const SlideAndBounce: React.FC<SlideAndBounceProps> = ({
  enterFrame,
  direction = 'up',
  distance = 30,
  bounceHeight = 5,
  children,
  style,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  // Initial slide with overshoot
  const springValue = spring({
    frame: localFrame,
    fps,
    config: { damping: 8, stiffness: 150 },
  })

  // Calculate position with overshoot effect built into spring
  const getTransform = () => {
    const offset = (1 - springValue) * distance
    switch (direction) {
      case 'up':
        return `translateY(${offset}px)`
      case 'down':
        return `translateY(${-offset}px)`
      case 'left':
        return `translateX(${offset}px)`
      case 'right':
        return `translateX(${-offset}px)`
      default:
        return 'none'
    }
  }

  const opacity = interpolate(localFrame, [0, 6], [0, 1], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        ...style,
        transform: getTransform(),
        opacity,
      }}
    >
      {children}
    </div>
  )
}

interface MessageSlideProps {
  enterFrame: number
  isUser?: boolean
  children: React.ReactNode
  style?: React.CSSProperties
}

/**
 * Pre-configured slide animation for chat messages.
 * User messages slide from right, bot messages from left.
 */
export const MessageSlide: React.FC<MessageSlideProps> = ({
  enterFrame,
  isUser = false,
  children,
  style,
}) => {
  return (
    <SpringSlide
      enterFrame={enterFrame}
      direction={isUser ? 'left' : 'right'}
      distance={20}
      damping={12}
      stiffness={120}
      style={{
        ...style,
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {children}
    </SpringSlide>
  )
}
