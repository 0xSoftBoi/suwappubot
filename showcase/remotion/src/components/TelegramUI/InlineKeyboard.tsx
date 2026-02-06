import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'

interface Button {
  text: string
  highlighted?: boolean
}

interface InlineKeyboardProps {
  buttons: Button[][]
  enterFrame: number
  highlightFrame?: number
  highlightButton?: { row: number; col: number }
}

export const InlineKeyboard: React.FC<InlineKeyboardProps> = ({
  buttons,
  enterFrame,
  highlightFrame,
  highlightButton,
}) => {
  const frame = useCurrentFrame()

  const opacity = interpolate(frame, [enterFrame, enterFrame + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const translateY = interpolate(frame, [enterFrame, enterFrame + 10], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const isHighlighted = (rowIndex: number, colIndex: number) => {
    if (!highlightFrame || !highlightButton) return false
    return (
      frame >= highlightFrame &&
      rowIndex === highlightButton.row &&
      colIndex === highlightButton.col
    )
  }

  return (
    <div
      style={{
        padding: '8px 12px',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          backgroundColor: '#f0f0f0',
          borderRadius: 16,
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {buttons.map((row, rowIndex) => (
          <div
            key={rowIndex}
            style={{
              display: 'flex',
              gap: 6,
            }}
          >
            {row.map((button, colIndex) => (
              <button
                key={colIndex}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: 'none',
                  backgroundColor: isHighlighted(rowIndex, colIndex)
                    ? '#E91E8C'
                    : '#fff',
                  color: isHighlighted(rowIndex, colIndex)
                    ? '#fff'
                    : '#0088cc',
                  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
              >
                {button.text}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
