import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'

interface ButtonMessageProps {
  header?: string
  body: string
  footer?: string
  buttons: string[]
  enterFrame: number
  highlightFrame?: number
  highlightIndex?: number
}

export const ButtonMessage: React.FC<ButtonMessageProps> = ({
  header,
  body,
  footer,
  buttons,
  enterFrame,
  highlightFrame,
  highlightIndex,
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

  const isHighlighted = (index: number) => {
    return highlightFrame && highlightIndex !== undefined && frame >= highlightFrame && index === highlightIndex
  }

  return (
    <div
      style={{
        padding: '2px 12px',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          backgroundColor: '#fff',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
        }}
      >
        {/* Content */}
        <div style={{ padding: '8px 12px' }}>
          {header && (
            <div
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                color: '#000',
                marginBottom: 4,
              }}
            >
              {header}
            </div>
          )}
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 14,
              color: '#000',
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
            }}
          >
            {body}
          </div>
          {footer && (
            <div
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: 12,
                color: '#667781',
                marginTop: 4,
              }}
            >
              {footer}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{ borderTop: '1px solid #e5e5e5' }}>
          {buttons.map((button, index) => (
            <div
              key={index}
              style={{
                padding: '12px',
                textAlign: 'center',
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: 14,
                color: isHighlighted(index) ? '#fff' : '#00a884',
                backgroundColor: isHighlighted(index) ? '#00a884' : 'transparent',
                fontWeight: 500,
                borderTop: index > 0 ? '1px solid #e5e5e5' : 'none',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
            >
              {button}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
