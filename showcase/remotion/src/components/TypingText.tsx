import React from 'react'
import { useCurrentFrame, interpolate } from 'remotion'

interface TypingTextProps {
  text: string
  enterFrame: number
  msPerChar?: number
  style?: React.CSSProperties
  showCursor?: boolean
  cursorColor?: string
}

/**
 * Character-by-character text reveal animation with optional blinking cursor.
 * Default typing speed is ~40ms per character (1.2 frames at 30fps).
 */
export const TypingText: React.FC<TypingTextProps> = ({
  text,
  enterFrame,
  msPerChar = 40,
  style,
  showCursor = true,
  cursorColor = '#E91E8C',
}) => {
  const frame = useCurrentFrame()
  const fps = 30
  const framesPerChar = Math.max(1, Math.round((msPerChar / 1000) * fps))

  const localFrame = frame - enterFrame

  if (localFrame < 0) return null

  // Calculate how many characters should be visible
  const charsVisible = Math.min(
    text.length,
    Math.floor(localFrame / framesPerChar)
  )

  const displayText = text.slice(0, charsVisible)
  const isTypingComplete = charsVisible >= text.length

  // Blinking cursor animation (blinks every 15 frames / 500ms)
  const cursorOpacity = isTypingComplete
    ? interpolate(frame % 30, [0, 15, 16, 30], [1, 1, 0, 0])
    : 1

  return (
    <span style={{ ...style, display: 'inline' }}>
      {displayText}
      {showCursor && (
        <span
          style={{
            display: 'inline-block',
            width: 2,
            height: '1em',
            backgroundColor: cursorColor,
            marginLeft: 1,
            opacity: cursorOpacity,
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </span>
  )
}

interface TypingTextBlockProps {
  text: string
  enterFrame: number
  msPerChar?: number
  style?: React.CSSProperties
  showCursor?: boolean
  cursorColor?: string
}

/**
 * Block-level typing text component for multi-line or standalone text blocks.
 */
export const TypingTextBlock: React.FC<TypingTextBlockProps> = ({
  text,
  enterFrame,
  msPerChar = 40,
  style,
  showCursor = true,
  cursorColor = '#E91E8C',
}) => {
  const frame = useCurrentFrame()
  const fps = 30
  const framesPerChar = Math.max(1, Math.round((msPerChar / 1000) * fps))

  const localFrame = frame - enterFrame

  if (localFrame < 0) return null

  const charsVisible = Math.min(
    text.length,
    Math.floor(localFrame / framesPerChar)
  )

  const displayText = text.slice(0, charsVisible)
  const isTypingComplete = charsVisible >= text.length

  const cursorOpacity = isTypingComplete
    ? interpolate(frame % 30, [0, 15, 16, 30], [1, 1, 0, 0])
    : 1

  return (
    <div style={{ ...style, display: 'block' }}>
      {displayText}
      {showCursor && (
        <span
          style={{
            display: 'inline-block',
            width: 2,
            height: '1em',
            backgroundColor: cursorColor,
            marginLeft: 1,
            opacity: cursorOpacity,
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </div>
  )
}

/**
 * Calculate total duration in frames for typing animation
 */
export const getTypingDuration = (text: string, msPerChar: number = 40, fps: number = 30): number => {
  const framesPerChar = Math.max(1, Math.round((msPerChar / 1000) * fps))
  return text.length * framesPerChar
}
