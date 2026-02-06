import React from 'react'
import { useCurrentFrame, interpolate, spring } from 'remotion'

interface TypingIndicatorProps {
  enterFrame: number
  exitFrame?: number
  dotColor?: string
  backgroundColor?: string
  size?: 'small' | 'medium' | 'large'
  variant?: 'telegram' | 'whatsapp' | 'generic'
}

/**
 * Animated typing indicator with 3 bouncing dots.
 * Commonly used to show "bot is typing..." state.
 */
export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  enterFrame,
  exitFrame,
  dotColor = '#6C7A89',
  backgroundColor = '#fff',
  size = 'medium',
  variant = 'generic',
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  // Hide before enterFrame or after exitFrame
  if (frame < enterFrame) return null
  if (exitFrame !== undefined && frame >= exitFrame) return null

  const localFrame = frame - enterFrame

  // Entrance animation
  const entranceOpacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const entranceScale = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 120 },
  })

  // Dot sizes based on size prop
  const dotSizes = {
    small: 6,
    medium: 8,
    large: 10,
  }
  const dotSize = dotSizes[size]
  const containerPadding = size === 'small' ? '6px 10px' : size === 'large' ? '12px 18px' : '8px 14px'

  // Bouncing animation for each dot - offset by 4 frames each
  const getDotY = (dotIndex: number) => {
    const cycleFrame = (localFrame + dotIndex * 4) % 24
    return interpolate(cycleFrame, [0, 6, 12, 18, 24], [0, -4, 0, 0, 0], {
      extrapolateRight: 'clamp',
    })
  }

  // Variant-specific styling
  const getContainerStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: size === 'small' ? 3 : size === 'large' ? 6 : 4,
      padding: containerPadding,
      borderRadius: 16,
      backgroundColor,
      opacity: entranceOpacity,
      transform: `scale(${entranceScale})`,
    }

    switch (variant) {
      case 'telegram':
        return {
          ...baseStyle,
          backgroundColor: '#fff',
          borderRadius: '4px 18px 18px 18px',
          boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
        }
      case 'whatsapp':
        return {
          ...baseStyle,
          backgroundColor: '#fff',
          borderRadius: '8px 8px 8px 0',
          boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
        }
      default:
        return {
          ...baseStyle,
          boxShadow: '0 2px 8px rgba(106,27,154,0.08)',
        }
    }
  }

  return (
    <div style={getContainerStyle()}>
      {[0, 1, 2].map((dotIndex) => (
        <div
          key={dotIndex}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            backgroundColor: dotColor,
            transform: `translateY(${getDotY(dotIndex)}px)`,
          }}
        />
      ))}
    </div>
  )
}

interface TypingIndicatorMessageProps {
  enterFrame: number
  exitFrame?: number
  botName?: string
  botAvatar?: React.ReactNode
  variant?: 'telegram' | 'whatsapp'
}

/**
 * Full typing indicator message bubble with bot avatar and name.
 * Designed for chat interfaces.
 */
export const TypingIndicatorMessage: React.FC<TypingIndicatorMessageProps> = ({
  enterFrame,
  exitFrame,
  botName = 'Bot',
  botAvatar,
  variant = 'telegram',
}) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null
  if (exitFrame !== undefined && frame >= exitFrame) return null

  const localFrame = frame - enterFrame

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const translateY = interpolate(localFrame, [0, 8], [15, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  if (variant === 'telegram') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          padding: '3px 10px',
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div
          style={{
            maxWidth: '85%',
            backgroundColor: '#fff',
            borderRadius: '4px 18px 18px 18px',
            overflow: 'hidden',
            boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px 4px',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            {botAvatar || (
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                }}
              >
                🌸
              </div>
            )}
            <span
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                color: '#E91E8C',
              }}
            >
              {botName}
            </span>
          </div>
          <div style={{ padding: '8px 12px 10px' }}>
            <TypingIndicator
              enterFrame={enterFrame}
              exitFrame={exitFrame}
              variant="generic"
              dotColor="#6C7A89"
              backgroundColor="transparent"
            />
          </div>
        </div>
      </div>
    )
  }

  // WhatsApp variant
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-start',
        padding: '2px 12px',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '8px 8px 8px 0',
          padding: '8px 12px',
          boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
        }}
      >
        <TypingIndicator
          enterFrame={enterFrame}
          exitFrame={exitFrame}
          variant="generic"
          dotColor="#667781"
          backgroundColor="transparent"
        />
      </div>
    </div>
  )
}
