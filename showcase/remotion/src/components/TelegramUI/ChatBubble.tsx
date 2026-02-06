import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'

interface ChatBubbleProps {
  message: string
  isUser: boolean
  timestamp?: string
  enterFrame: number
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  isUser,
  timestamp = '12:00',
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
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '4px 12px',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          maxWidth: '75%',
          padding: '8px 12px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          backgroundColor: isUser ? '#E91E8C' : '#f0f0f0',
          color: isUser ? '#fff' : '#000',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: 15,
          lineHeight: 1.4,
          position: 'relative',
        }}
      >
        {message}
        <span
          style={{
            display: 'block',
            textAlign: 'right',
            fontSize: 11,
            marginTop: 4,
            opacity: 0.6,
          }}
        >
          {timestamp}
          {isUser && (
            <span style={{ marginLeft: 4 }}>✓✓</span>
          )}
        </span>
      </div>
    </div>
  )
}
