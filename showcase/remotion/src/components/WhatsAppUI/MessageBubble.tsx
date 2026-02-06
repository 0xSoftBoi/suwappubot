import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'

interface MessageBubbleProps {
  message: string
  isUser: boolean
  timestamp?: string
  enterFrame: number
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isUser,
  timestamp = '12:00 PM',
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
        padding: '2px 12px',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          maxWidth: '75%',
          padding: '8px 12px',
          borderRadius: isUser ? '10px 10px 0 10px' : '10px 10px 10px 0',
          backgroundColor: isUser ? '#DCF8C6' : '#fff',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: 15,
          lineHeight: 1.4,
          position: 'relative',
          boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
        }}
      >
        {message}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 4,
            marginTop: 2,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: '#667781',
            }}
          >
            {timestamp}
          </span>
          {isUser && (
            <svg width="16" height="11" viewBox="0 0 16 11" fill="#53bdeb">
              <path d="M11.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-2.405-2.272a.463.463 0 00-.336-.146.47.47 0 00-.343.146l-.311.31a.445.445 0 00-.14.337c0 .136.047.25.14.343l2.996 2.996a.724.724 0 00.508.203.697.697 0 00.546-.266l6.646-8.417a.497.497 0 00.108-.299.441.441 0 00-.14-.305l-.394-.342z" />
              <path d="M15.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-2.405-2.272a.463.463 0 00-.336-.146.47.47 0 00-.343.146l-.311.31a.445.445 0 00-.14.337c0 .136.047.25.14.343l2.996 2.996a.724.724 0 00.508.203.697.697 0 00.546-.266l6.646-8.417a.497.497 0 00.108-.299.441.441 0 00-.14-.305l-.394-.342z" />
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
