import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate, spring } from 'remotion'
import { PhoneFrame } from '../components/PhoneFrame'
import { TypingText, getTypingDuration } from '../components/TypingText'
import { TypingIndicatorMessage } from '../components/TypingIndicator'
import { TapRipple, GlowPulse } from '../components/TapRipple'
import { SpringSlide, StaggeredSlide } from '../components/SpringSlide'
import { SakuraConfetti } from '../components/Confetti'

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
    ? (1 - springProgress) * 30
    : (1 - springProgress) * -30

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '3px 10px',
        opacity,
        transform: `translateX(${translateX}px)`,
      }}
    >
      {children}
    </div>
  )
}

interface UserBubbleProps {
  text: string
  time: string
  enterFrame: number
  showTyping?: boolean
}

const UserBubble: React.FC<UserBubbleProps> = ({ text, time, enterFrame, showTyping = true }) => {
  const frame = useCurrentFrame()

  return (
    <div
      style={{
        maxWidth: '75%',
        padding: '8px 12px',
        borderRadius: '18px 18px 4px 18px',
        backgroundColor: '#EFFDDE',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 15,
        color: '#000',
        boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
      }}
    >
      {showTyping ? (
        <TypingText
          text={text}
          enterFrame={enterFrame}
          msPerChar={45}
          showCursor={true}
          cursorColor="#0088cc"
        />
      ) : (
        text
      )}
      <div style={{ fontSize: 11, color: '#777', textAlign: 'right', marginTop: 2 }}>
        {time} ✓✓
      </div>
    </div>
  )
}

interface BotBubbleProps {
  children: React.ReactNode
  enterFrame: number
}

const BotBubble: React.FC<BotBubbleProps> = ({ children, enterFrame }) => {
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
        maxWidth: '85%',
        backgroundColor: '#fff',
        borderRadius: '4px 18px 18px 18px',
        overflow: 'hidden',
        boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
        transform: `scale(${scale})`,
        transformOrigin: 'left center',
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
        <span
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            color: '#E91E8C',
          }}
        >
          Suwappu Bot
        </span>
      </div>
      <div
        style={{
          padding: '8px 12px 10px',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: 15,
          lineHeight: 1.4,
          color: '#000',
        }}
      >
        {children}
      </div>
    </div>
  )
}

interface KeyboardProps {
  buttons: string[][]
  enterFrame: number
  highlightButton?: { row: number; col: number }
  highlightFrame?: number
}

const InlineKeyboard: React.FC<KeyboardProps> = ({
  buttons,
  enterFrame,
  highlightButton,
  highlightFrame,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const isHighlighted = (row: number, col: number) => {
    if (!highlightFrame || !highlightButton) return false
    return frame >= highlightFrame && row === highlightButton.row && col === highlightButton.col
  }

  const isRippling = (row: number, col: number) => {
    if (!highlightFrame || !highlightButton) return false
    return (
      frame >= highlightFrame &&
      frame < highlightFrame + 20 &&
      row === highlightButton.row &&
      col === highlightButton.col
    )
  }

  return (
    <div style={{ padding: '3px 10px', opacity }}>
      <div
        style={{
          maxWidth: '85%',
          backgroundColor: '#fff',
          borderRadius: 12,
          padding: 6,
          boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
        }}
      >
        {buttons.map((row, rowIdx) => (
          <div key={rowIdx} style={{ display: 'flex', gap: 4, marginTop: rowIdx > 0 ? 4 : 0 }}>
            {row.map((btn, colIdx) => {
              // Staggered button animation
              const buttonDelay = rowIdx * 3 + colIdx * 2
              const buttonFrame = Math.max(0, localFrame - buttonDelay)
              const buttonScale = spring({
                frame: buttonFrame,
                fps,
                config: { damping: 12, stiffness: 150 },
                from: 0.8,
                to: 1,
              })

              const highlighted = isHighlighted(rowIdx, colIdx)
              const rippling = isRippling(rowIdx, colIdx)

              return (
                <div
                  key={colIdx}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    borderRadius: 8,
                    backgroundColor: highlighted ? '#E91E8C' : '#f5f5f5',
                    color: highlighted ? '#fff' : '#0088cc',
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                    fontSize: 14,
                    fontWeight: 500,
                    textAlign: 'center',
                    transform: `scale(${buttonScale})`,
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: highlighted
                      ? '0 0 15px rgba(233, 30, 140, 0.3)'
                      : undefined,
                  }}
                >
                  {btn}
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
        ))}
      </div>
    </div>
  )
}

interface SuccessMessageProps {
  enterFrame: number
}

const SuccessMessage: React.FC<SuccessMessageProps> = ({ enterFrame }) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const checkScale = spring({
    frame: localFrame - 5,
    fps,
    config: { damping: 8, stiffness: 100 },
  })

  const textOpacity = interpolate(localFrame, [15, 25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <Message enterFrame={enterFrame}>
      <GlowPulse
        triggerFrame={enterFrame + 10}
        duration={40}
        color="rgba(168, 230, 163, 0.4)"
        intensity={25}
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
          <span
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              color: '#E91E8C',
            }}
          >
            Suwappu Bot
          </span>
        </div>
        <div
          style={{
            padding: '16px 12px 14px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 40,
              marginBottom: 8,
              transform: `scale(${checkScale})`,
            }}
          >
            🎉
          </div>
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 16,
              fontWeight: 600,
              color: '#22c55e',
              marginBottom: 6,
              opacity: textOpacity,
            }}
          >
            Swap Successful!
          </div>
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 15,
              color: '#000',
              marginBottom: 6,
              opacity: textOpacity,
            }}
          >
            You received <strong>0.0412 ETH</strong>
          </div>
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 12,
              color: '#666',
              opacity: textOpacity,
            }}
          >
            Tx: 0x7a3b...f291
          </div>
        </div>
      </GlowPulse>
    </Message>
  )
}

export const TelegramBotDemo: React.FC = () => {
  const frame = useCurrentFrame()

  // Timeline:
  // 0-40: User types /start
  // 40-70: Bot typing indicator
  // 70-130: Welcome message appears
  // 130-180: Menu buttons appear (staggered)
  // 180-260: User types swap command
  // 260-300: Bot typing indicator
  // 300-400: Quote message appears
  // 400-450: Confirm buttons appear
  // 450-490: User taps confirm (ripple effect)
  // 490-530: Bot typing indicator
  // 530-650: Success message with confetti

  const userTypingDuration = getTypingDuration('/start', 45)

  return (
    <PhoneFrame showStatusBar={true} statusBarStyle="light" time="12:00">
      <AbsoluteFill style={{ backgroundColor: '#E8DFD8' }}>
        {/* Header */}
        <div
          style={{
            height: 88,
            backgroundColor: '#0088cc',
            display: 'flex',
            alignItems: 'flex-end',
            padding: '0 12px 10px',
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
              Suwappu Bot
            </div>
            <div
              style={{
                color: 'rgba(255,255,255,0.7)',
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: 13,
              }}
            >
              bot
            </div>
          </div>
          <div style={{ fontSize: 20, color: '#fff' }}>⋮</div>
        </div>

        {/* Chat Area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 12,
            paddingBottom: 8,
            overflowY: 'hidden',
          }}
        >
          {/* User: /start with typing animation */}
          <Message isUser enterFrame={10}>
            <UserBubble text="/start" time="12:00" enterFrame={10} showTyping={true} />
          </Message>

          {/* Bot typing indicator */}
          <TypingIndicatorMessage
            enterFrame={50}
            exitFrame={90}
            botName="Suwappu Bot"
            variant="telegram"
          />

          {/* Bot: Welcome message */}
          <Message enterFrame={90}>
            <BotBubble enterFrame={90}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>🌸 Welcome to Suwappu!</div>
              <div>Cross-chain swaps made simple.</div>
              <div style={{ marginTop: 4 }}>Trade tokens across 7+ chains directly from Telegram.</div>
            </BotBubble>
          </Message>

          {/* Menu buttons with staggered animation */}
          <InlineKeyboard
            enterFrame={130}
            buttons={[
              ['💱 Swap', '💼 Portfolio'],
              ['⚙️ Settings', '❓ Help'],
            ]}
          />

          {/* User: swap command with typing */}
          <Message isUser enterFrame={200}>
            <UserBubble text="/s 100 USDC ETH" time="12:01" enterFrame={200} showTyping={true} />
          </Message>

          {/* Bot typing indicator */}
          <TypingIndicatorMessage
            enterFrame={280}
            exitFrame={330}
            botName="Suwappu Bot"
            variant="telegram"
          />

          {/* Bot: Quote */}
          <Message enterFrame={330}>
            <BotBubble enterFrame={330}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>💱 Swap Quote</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#666' }}>From:</span>
                <span style={{ fontWeight: 500 }}>100 USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#666' }}>To:</span>
                <span style={{ fontWeight: 500 }}>0.0412 ETH</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#666' }}>Rate:</span>
                <span style={{ color: '#22c55e', fontWeight: 500 }}>$2,427.18/ETH</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Network:</span>
                <span>Ethereum</span>
              </div>
            </BotBubble>
          </Message>

          {/* Confirm buttons with tap highlight */}
          <InlineKeyboard
            enterFrame={400}
            buttons={[['✅ Confirm Swap'], ['❌ Cancel']]}
            highlightButton={{ row: 0, col: 0 }}
            highlightFrame={490}
          />

          {/* Bot typing indicator before success */}
          <TypingIndicatorMessage
            enterFrame={520}
            exitFrame={560}
            botName="Suwappu Bot"
            variant="telegram"
          />

          {/* Success message */}
          <SuccessMessage enterFrame={560} />

          {/* Confetti celebration */}
          <SakuraConfetti triggerFrame={580} duration={120} petalCount={50} />
        </div>

        {/* Input Area */}
        <div
          style={{
            height: 52,
            backgroundColor: '#F6F6F6',
            borderTop: '1px solid #ddd',
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 22 }}>📎</div>
          <div
            style={{
              flex: 1,
              height: 36,
              backgroundColor: '#fff',
              borderRadius: 18,
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: 15,
              color: '#999',
              border: '1px solid #e0e0e0',
            }}
          >
            Message
          </div>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: '#0088cc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            🎤
          </div>
        </div>
      </AbsoluteFill>
    </PhoneFrame>
  )
}
