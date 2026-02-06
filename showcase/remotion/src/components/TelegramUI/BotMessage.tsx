import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'

interface BotMessageProps {
  title?: string
  content: string | React.ReactNode
  enterFrame: number
}

export const BotMessage: React.FC<BotMessageProps> = ({
  title,
  content,
  enterFrame,
}) => {
  const frame = useCurrentFrame()

  const opacity = interpolate(frame, [enterFrame, enterFrame + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const translateY = interpolate(frame, [enterFrame, enterFrame + 10], [20, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        padding: '4px 12px',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          backgroundColor: '#f0f0f0',
          borderRadius: '16px 16px 16px 4px',
          overflow: 'hidden',
        }}
      >
        {/* Bot avatar and name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px 6px',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
          >
            🌸
          </div>
          <span
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              color: '#E91E8C',
            }}
          >
            Suwappu Bot
          </span>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '0 12px 10px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 15,
            lineHeight: 1.5,
            color: '#000',
          }}
        >
          {title && (
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {title}
            </div>
          )}
          {typeof content === 'string' ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
          ) : (
            content
          )}
        </div>
      </div>
    </div>
  )
}
