import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate, spring } from 'remotion'
import { PhoneFrame } from '../components/PhoneFrame'
import { TypingText } from '../components/TypingText'
import { TypingIndicator } from '../components/TypingIndicator'
import { TapRipple, GlowPulse } from '../components/TapRipple'
import { SakuraConfetti } from '../components/Confetti'
import { LoadingSpinner } from '../components/LoadingSpinner'

interface MessageProps {
  children: React.ReactNode
  isUser?: boolean
  enterFrame: number
}

const Message: React.FC<MessageProps> = ({ children, isUser = false, enterFrame }) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  // Spring animation for smooth entry
  const springProgress = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 120 },
  })

  const translateX = isUser
    ? (1 - springProgress) * 25
    : (1 - springProgress) * -25

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '2px 12px',
        opacity,
        transform: `translateX(${translateX}px)`,
      }}
    >
      {children}
    </div>
  )
}

interface BlueTicks {
  showDouble: boolean
  frame: number
  triggerFrame: number
}

const BlueTicksIcon: React.FC<BlueTicks> = ({ showDouble, frame, triggerFrame }) => {
  const localFrame = frame - triggerFrame

  // Animate from single to double tick
  const showBothTicks = showDouble && localFrame > 15
  const ticksColor = showBothTicks ? '#53bdeb' : '#999'

  const secondTickOpacity = showBothTicks
    ? interpolate(localFrame - 15, [0, 8], [0, 1], { extrapolateRight: 'clamp' })
    : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <svg width="16" height="11" viewBox="0 0 16 11" fill={ticksColor}>
        <path d="M11.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-2.405-2.272a.463.463 0 00-.336-.146.47.47 0 00-.343.146l-.311.31a.445.445 0 00-.14.337c0 .136.047.25.14.343l2.996 2.996a.724.724 0 00.508.203.697.697 0 00.546-.266l6.646-8.417a.497.497 0 00.108-.299.441.441 0 00-.14-.305l-.394-.342z" />
      </svg>
      {showDouble && (
        <svg
          width="10"
          height="11"
          viewBox="0 0 10 11"
          fill={ticksColor}
          style={{ marginLeft: -6, opacity: secondTickOpacity }}
        >
          <path d="M7.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178L.196 8.365l.393.342c.096.082.178.12.284.12a.697.697 0 00.546-.266l6.646-8.417a.497.497 0 00.108-.299.441.441 0 00-.14-.305l-.394-.342z" />
        </svg>
      )}
    </div>
  )
}

interface UserBubbleProps {
  text: string
  time: string
  enterFrame: number
  showTyping?: boolean
}

const UserBubble: React.FC<UserBubbleProps> = ({ text, time, enterFrame, showTyping = false }) => {
  const frame = useCurrentFrame()

  return (
    <div
      style={{
        maxWidth: '75%',
        padding: '6px 12px 4px',
        borderRadius: '8px 8px 0 8px',
        backgroundColor: '#DCF8C6',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 15,
        color: '#000',
        boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
        position: 'relative',
      }}
    >
      {showTyping ? (
        <TypingText
          text={text}
          enterFrame={enterFrame}
          msPerChar={50}
          showCursor={true}
          cursorColor="#00a884"
        />
      ) : (
        text
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <span style={{ fontSize: 11, color: '#667781' }}>{time}</span>
        <BlueTicksIcon showDouble={true} frame={frame} triggerFrame={enterFrame + 20} />
      </div>
    </div>
  )
}

interface BotBubbleProps {
  children: React.ReactNode
  time?: string
  enterFrame: number
}

const BotBubble: React.FC<BotBubbleProps> = ({ children, time = '12:00 PM', enterFrame }) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const scale = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 140 },
    from: 0.9,
    to: 1,
  })

  return (
    <div
      style={{
        maxWidth: '80%',
        padding: '6px 12px 4px',
        borderRadius: '8px 8px 8px 0',
        backgroundColor: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 15,
        color: '#000',
        boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
        lineHeight: 1.4,
        transform: `scale(${scale})`,
        transformOrigin: 'left center',
      }}
    >
      {children}
      <div style={{ fontSize: 11, color: '#667781', textAlign: 'right', marginTop: 2 }}>
        {time}
      </div>
    </div>
  )
}

interface ButtonMessageProps {
  header?: string
  body: string
  footer?: string
  buttons: string[]
  enterFrame: number
  highlightIndex?: number
  highlightFrame?: number
}

const ButtonMessage: React.FC<ButtonMessageProps> = ({
  header,
  body,
  footer,
  buttons,
  enterFrame,
  highlightIndex,
  highlightFrame,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const scale = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 140 },
    from: 0.9,
    to: 1,
  })

  const isHighlighted = (index: number) => {
    return highlightFrame !== undefined && highlightIndex !== undefined && frame >= highlightFrame && index === highlightIndex
  }

  const isRippling = (index: number) => {
    return (
      highlightFrame !== undefined &&
      highlightIndex !== undefined &&
      frame >= highlightFrame &&
      frame < highlightFrame + 20 &&
      index === highlightIndex
    )
  }

  return (
    <div
      style={{
        padding: '2px 12px',
        opacity,
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          backgroundColor: '#fff',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
          transform: `scale(${scale})`,
          transformOrigin: 'left center',
        }}
      >
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

        <div style={{ borderTop: '1px solid #e5e5e5' }}>
          {buttons.map((button, index) => {
            // Staggered button animation
            const buttonDelay = index * 3
            const buttonFrame = Math.max(0, localFrame - buttonDelay - 10)
            const buttonScale = spring({
              frame: buttonFrame,
              fps,
              config: { damping: 12, stiffness: 150 },
              from: 0.9,
              to: 1,
            })

            const highlighted = isHighlighted(index)
            const rippling = isRippling(index)

            return (
              <div
                key={index}
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                  fontSize: 14,
                  color: highlighted ? '#fff' : '#00a884',
                  backgroundColor: highlighted ? '#00a884' : 'transparent',
                  fontWeight: 500,
                  borderTop: index > 0 ? '1px solid #e5e5e5' : 'none',
                  transform: `scale(${buttonScale})`,
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: highlighted ? '0 0 12px rgba(0, 168, 132, 0.3)' : undefined,
                }}
              >
                {button}
                {rippling && highlightFrame && (
                  <TapRipple
                    triggerFrame={highlightFrame}
                    duration={20}
                    color="rgba(255, 255, 255, 0.4)"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface OnlineStatusProps {
  enterFrame: number
}

const OnlineStatusDot: React.FC<OnlineStatusProps> = ({ enterFrame }) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  // Pulsing animation
  const pulse = interpolate(localFrame % 60, [0, 30, 60], [1, 1.3, 1], {
    extrapolateRight: 'clamp',
  })

  const pulseOpacity = interpolate(localFrame % 60, [0, 30, 60], [1, 0.6, 1], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: '#00a884',
        transform: `scale(${pulse})`,
        opacity: pulseOpacity,
        marginLeft: 4,
      }}
    />
  )
}

interface WhatsAppTypingIndicatorProps {
  enterFrame: number
  exitFrame?: number
}

const WhatsAppTypingIndicator: React.FC<WhatsAppTypingIndicatorProps> = ({ enterFrame, exitFrame }) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null
  if (exitFrame && frame >= exitFrame) return null

  const localFrame = frame - enterFrame

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const translateY = interpolate(localFrame, [0, 8], [10, 0], {
    extrapolateRight: 'clamp',
  })

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
          backgroundColor: '#fff',
          borderRadius: '8px 8px 8px 0',
          padding: '10px 14px',
          boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
          display: 'inline-block',
        }}
      >
        <TypingIndicator
          enterFrame={enterFrame}
          exitFrame={exitFrame}
          dotColor="#667781"
          backgroundColor="transparent"
        />
      </div>
    </div>
  )
}

export const WhatsAppDemo: React.FC = () => {
  const frame = useCurrentFrame()

  // Timeline:
  // 0-80: Welcome buttons appear (staggered)
  // 80-120: User selects Swap + blue tick animation
  // 120-160: Bot typing indicator
  // 160-240: Token selection buttons
  // 240-280: User selects USDC
  // 280-320: Bot typing indicator
  // 320-380: Amount prompt appears
  // 380-440: User types "200"
  // 440-480: Bot typing indicator
  // 480-560: Confirmation card appears
  // 560-600: User taps Confirm (ripple + loading)

  return (
    <PhoneFrame showStatusBar={true} statusBarStyle="light" time="12:00">
      <AbsoluteFill style={{ backgroundColor: '#ECE5DD' }}>
        {/* WhatsApp Header */}
        <div
          style={{
            height: 88,
            backgroundColor: '#075E54',
            display: 'flex',
            alignItems: 'flex-end',
            padding: '0 10px 10px',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 22, color: '#fff' }}>‹</div>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            🌸
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                color: '#fff',
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              Suwappu
            </div>
            <div
              style={{
                color: 'rgba(255,255,255,0.7)',
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              online
              <OnlineStatusDot enterFrame={0} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, color: '#fff', fontSize: 20 }}>
            <span>📹</span>
            <span>📞</span>
            <span>⋮</span>
          </div>
        </div>

        {/* Chat Area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 12,
            paddingBottom: 8,
            background: `#ECE5DD url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAMAAAANIilAAAABaFBMVEUAAADh4eHi4uLf39/g4ODg4ODf39/g4ODg4ODf39/g4ODg4ODf39/g4ODf39/g4ODf39/g4ODg4ODf39/g4ODf39/g4ODg4ODg4ODf39/g4ODf39/g4ODg4ODf39/g4ODf39/g4ODg4ODf39/g4ODf39/g4ODf39/g4ODf39/f39/g4ODf39/g4ODg4ODf39/g4ODf39/g4ODg4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/g4ODf39/f39/g4ODf39/g4ODf39/g4ODg4ODf39/g4OCWq1GYAAAAeHRSTlMAAQIDBAUGBwgJCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicpKissLS4vMDEyMzU2ODk6Ozw9P0BBQkNERUdISUpLTU5QUVJTVFVXWFlaW1xdXl9gYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1+gIGCAOu91+AAAAC8SURBVHjaYhhmgBGqwcSEQ52JgYEJpxoWZgamIaiGGZeNzCwMLGC1nOwsUKUgwMLKygpSC9TAysrGzs7BAuZzANWC7OTgBHE4QWrB3GAWMJ+bm4eFjQWsmYWbB2QJMxMTLy8fC9hsLh4+sBIBPgF+Ln6oPh5BYQERYT4mJhYR0b/q/lMlJCYuISUpLSMrJy+voCAmqKikrKKqpq6hoaWtLaagq6dvYGhkbGJqZm5haWVtY2tHNAAAQ2ISwygqcNUAAAAASUVORK5CYII=")`,
            backgroundSize: '412px auto',
          }}
        >
          {/* Welcome message with buttons */}
          <ButtonMessage
            enterFrame={20}
            header="🌸 Suwappu"
            body="Welcome to Suwappu! I can help you swap tokens across 7+ blockchains. What would you like to do?"
            footer="Powered by Suwappu"
            buttons={['💱 Swap Tokens', '💼 Check Balance', '📊 Portfolio']}
          />

          {/* User selects Swap */}
          <Message isUser enterFrame={100}>
            <UserBubble text="💱 Swap Tokens" time="12:00 PM" enterFrame={100} />
          </Message>

          {/* Bot typing indicator */}
          <WhatsAppTypingIndicator enterFrame={140} exitFrame={180} />

          {/* Token selection */}
          <ButtonMessage
            enterFrame={180}
            body="Great! Which token would you like to swap FROM?"
            buttons={['USDC', 'ETH', 'MATIC', 'More...']}
            highlightIndex={0}
            highlightFrame={260}
          />

          {/* User confirms USDC */}
          <Message isUser enterFrame={290}>
            <UserBubble text="USDC" time="12:01 PM" enterFrame={290} />
          </Message>

          {/* Bot typing indicator */}
          <WhatsAppTypingIndicator enterFrame={320} exitFrame={360} />

          {/* Amount prompt */}
          <Message enterFrame={360}>
            <BotBubble time="12:01 PM" enterFrame={360}>
              How much USDC would you like to swap? Reply with an amount.
            </BotBubble>
          </Message>

          {/* User enters amount with typing animation */}
          <Message isUser enterFrame={400}>
            <UserBubble text="200" time="12:01 PM" enterFrame={400} showTyping={true} />
          </Message>

          {/* Bot typing indicator */}
          <WhatsAppTypingIndicator enterFrame={440} exitFrame={490} />

          {/* Confirm swap with buttons */}
          <ButtonMessage
            enterFrame={490}
            header="💱 Confirm Swap"
            body={`You're swapping:\n\n200 USDC → 0.0824 ETH\nRate: $2,427.18/ETH\nFee: $1.50`}
            footer="Tap to confirm"
            buttons={['✅ Confirm', '❌ Cancel']}
            highlightIndex={0}
            highlightFrame={560}
          />
        </div>

        {/* Input Area */}
        <div
          style={{
            height: 54,
            backgroundColor: '#f0f0f0',
            display: 'flex',
            alignItems: 'center',
            padding: '0 6px',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 24, padding: '0 4px' }}>😊</div>
          <div
            style={{
              flex: 1,
              height: 40,
              backgroundColor: '#fff',
              borderRadius: 21,
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 15,
              color: '#667781',
            }}
          >
            Type a message
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '0 4px' }}>
            <span style={{ fontSize: 22 }}>📎</span>
            <span style={{ fontSize: 22 }}>📷</span>
          </div>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              backgroundColor: '#00a884',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              color: '#fff',
            }}
          >
            🎤
          </div>
        </div>
      </AbsoluteFill>
    </PhoneFrame>
  )
}
