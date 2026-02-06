import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, spring, random } from 'remotion'
import { PhoneFrame } from '../components/PhoneFrame'
import { SpringSlide, SpringScale, StaggeredSlide } from '../components/SpringSlide'
import { ScreenSlide } from '../components/BlurTransition'
import { SakuraConfetti } from '../components/Confetti'
import { GradientSpinner } from '../components/LoadingSpinner'
import { TapRipple, GlowPulse } from '../components/TapRipple'

interface SparklineProps {
  data: number[]
  width: number
  height: number
  color: string
  enterFrame: number
}

const Sparkline: React.FC<SparklineProps> = ({ data, width, height, color, enterFrame }) => {
  const frame = useCurrentFrame()

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  // Animate the line drawing
  const progress = interpolate(localFrame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - ((value - min) / range) * height
    return `${x},${y}`
  })

  const pathLength = width * 2 // Approximate path length

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={pathLength}
        strokeDashoffset={pathLength * (1 - progress)}
      />
    </svg>
  )
}

interface TabBarProps {
  activeIndex: number
  enterFrame: number
}

const TabBar: React.FC<TabBarProps> = ({ activeIndex, enterFrame }) => {
  const frame = useCurrentFrame()
  const fps = 30

  const tabs = [
    { icon: '🏠', label: 'Home' },
    { icon: '🔍', label: 'Discover' },
    { icon: '💱', label: 'Swap' },
    { icon: '📊', label: 'Portfolio' },
    { icon: '⚙️', label: 'Settings' },
  ]

  // Tab indicator animation
  const indicatorX = spring({
    frame: Math.max(0, frame - enterFrame),
    fps,
    config: { damping: 15, stiffness: 150 },
    from: activeIndex * 68,
    to: activeIndex * 68,
  })

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 85,
        backgroundColor: '#fff',
        borderTop: '1px solid rgba(255,183,197,0.2)',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'flex-start',
        paddingTop: 10,
      }}
    >
      {/* Active tab indicator */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: `calc(${indicatorX}px + 10%)`,
          width: 40,
          height: 3,
          backgroundColor: '#E91E8C',
          borderRadius: 2,
          transform: 'translateX(-50%)',
        }}
      />

      {tabs.map((tab, index) => (
        <div
          key={tab.label}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            width: 60,
          }}
        >
          <span style={{ fontSize: 22 }}>{tab.icon}</span>
          <span
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 10,
              color: index === activeIndex ? '#E91E8C' : '#6C7A89',
              fontWeight: index === activeIndex ? 600 : 400,
            }}
          >
            {tab.label}
          </span>
        </div>
      ))}
    </div>
  )
}

interface PushNotificationProps {
  enterFrame: number
  exitFrame?: number
  title: string
  body: string
  icon?: string
}

const PushNotification: React.FC<PushNotificationProps> = ({
  enterFrame,
  exitFrame,
  title,
  body,
  icon = '🌸',
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null
  if (exitFrame && frame >= exitFrame) return null

  const localFrame = frame - enterFrame

  // Slide down with spring
  const slideProgress = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 80 },
  })

  const translateY = (1 - slideProgress) * -100

  // Subtle bounce at the end
  const bounce = localFrame > 15
    ? interpolate(localFrame - 15, [0, 10, 20], [0, -3, 0], {
        extrapolateRight: 'clamp',
      })
    : 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 54,
        left: 12,
        right: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(20px)',
        borderRadius: 16,
        padding: 14,
        boxShadow: '0 10px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
        transform: `translateY(${translateY + bounce}px)`,
        zIndex: 200,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            boxShadow: '0 2px 8px rgba(233, 30, 140, 0.2)',
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                color: '#2C3E50',
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 12,
                color: '#6C7A89',
              }}
            >
              now
            </div>
          </div>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 13,
              color: '#6C7A89',
              marginTop: 2,
            }}
          >
            {body}
          </div>
        </div>
      </div>
    </div>
  )
}

const DiscoveryScreen: React.FC<{ enterFrame: number }> = ({ enterFrame }) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const opacity = interpolate(localFrame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const trendingTokens = [
    { symbol: 'PEPE', name: 'Pepe', change: '+24.5%', price: '$0.000012', data: [5, 8, 12, 9, 15, 18, 22] },
    { symbol: 'ARB', name: 'Arbitrum', change: '+8.2%', price: '$1.23', data: [10, 11, 9, 12, 13, 14, 15] },
    { symbol: 'OP', name: 'Optimism', change: '+5.7%', price: '$2.45', data: [8, 9, 7, 10, 11, 10, 12] },
  ]

  const networks = ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism', 'Base', 'BSC', 'Solana']

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#FFFBFC' }}>
      {/* Header */}
      <SpringSlide enterFrame={enterFrame} direction="down" distance={20}>
        <div
          style={{
            padding: '55px 20px 15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'Pacifico, cursive',
              fontSize: 28,
              background: 'linear-gradient(135deg, #E91E8C 0%, #6C3483 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Discover
          </div>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: '#f5f5f5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            🔔
          </div>
        </div>
      </SpringSlide>

      {/* Search Bar */}
      <SpringSlide enterFrame={enterFrame + 8} direction="up" distance={20}>
        <div style={{ padding: '0 20px 16px' }}>
          <div
            style={{
              height: 44,
              backgroundColor: '#f5f5f5',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 18 }}>🔍</span>
            <span
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 15,
                color: '#999',
              }}
            >
              Search tokens, chains...
            </span>
          </div>
        </div>
      </SpringSlide>

      {/* Trending Section */}
      <div style={{ padding: '0 20px' }}>
        <SpringSlide enterFrame={enterFrame + 12} direction="up" distance={20}>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 16,
              fontWeight: 600,
              color: '#2C3E50',
              marginBottom: 12,
            }}
          >
            🔥 Trending Now
          </div>
        </SpringSlide>

        {trendingTokens.map((token, index) => (
          <SpringSlide
            key={token.symbol}
            enterFrame={enterFrame + 20 + index * 8}
            direction="up"
            distance={25}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '14px',
                marginBottom: 8,
                backgroundColor: '#fff',
                borderRadius: 16,
                boxShadow: '0 2px 8px rgba(106,27,154,0.06)',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 14,
                  color: '#fff',
                  marginRight: 12,
                }}
              >
                {token.symbol.slice(0, 2)}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: '-apple-system, sans-serif',
                    fontSize: 15,
                    fontWeight: 600,
                    color: '#2C3E50',
                  }}
                >
                  {token.symbol}
                </div>
                <div
                  style={{
                    fontFamily: '-apple-system, sans-serif',
                    fontSize: 13,
                    color: '#6C7A89',
                  }}
                >
                  {token.name}
                </div>
              </div>
              {/* Sparkline Chart */}
              <div style={{ marginRight: 12 }}>
                <Sparkline
                  data={token.data}
                  width={50}
                  height={24}
                  color="#22c55e"
                  enterFrame={enterFrame + 30 + index * 8}
                />
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontFamily: '-apple-system, sans-serif',
                    fontSize: 15,
                    fontWeight: 500,
                    color: '#2C3E50',
                  }}
                >
                  {token.price}
                </div>
                <div
                  style={{
                    fontFamily: '-apple-system, sans-serif',
                    fontSize: 13,
                    color: '#22c55e',
                  }}
                >
                  {token.change}
                </div>
              </div>
            </div>
          </SpringSlide>
        ))}
      </div>

      {/* Network Section */}
      <SpringSlide enterFrame={enterFrame + 50} direction="up" distance={20}>
        <div style={{ padding: '20px' }}>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 16,
              fontWeight: 600,
              color: '#2C3E50',
              marginBottom: 12,
            }}
          >
            ⛓️ Supported Networks
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {networks.map((network, index) => {
              const networkDelay = index * 3
              const networkFrame = Math.max(0, localFrame - 55 - networkDelay)
              const networkScale = spring({
                frame: networkFrame,
                fps,
                config: { damping: 12, stiffness: 150 },
                from: 0.8,
                to: 1,
              })

              return (
                <div
                  key={network}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#f5f5f5',
                    borderRadius: 20,
                    fontFamily: '-apple-system, sans-serif',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#2C3E50',
                    transform: `scale(${networkScale})`,
                  }}
                >
                  {network}
                </div>
              )
            })}
          </div>
        </div>
      </SpringSlide>
    </AbsoluteFill>
  )
}

const SwapScreen: React.FC<{ enterFrame: number; tapButtonFrame?: number }> = ({
  enterFrame,
  tapButtonFrame,
}) => {
  const frame = useCurrentFrame()
  const fps = 30

  const localFrame = frame - enterFrame
  if (localFrame < 0) return null

  const opacity = interpolate(localFrame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const buttonPulse = interpolate(
    localFrame % 60,
    [0, 30, 60],
    [1, 1.02, 1],
    { extrapolateRight: 'clamp' }
  )

  const isButtonTapped = tapButtonFrame && frame >= tapButtonFrame

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#FFFBFC' }}>
      {/* Header */}
      <SpringSlide enterFrame={enterFrame} direction="down" distance={20}>
        <div
          style={{
            padding: '55px 20px 15px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 18,
              fontWeight: 600,
              color: '#2C3E50',
            }}
          >
            Swap
          </div>
        </div>
      </SpringSlide>

      {/* Swap Interface */}
      <div style={{ padding: '10px 20px' }}>
        {/* From Token */}
        <SpringSlide enterFrame={enterFrame + 8} direction="up" distance={25}>
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 20,
              padding: 16,
              boxShadow: '0 4px 15px rgba(106,27,154,0.08)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>From</span>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>Balance: 2,500 USDC</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: '#2C3E50',
                }}
              >
                1,000
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: 25,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: '#2775ca',
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: 16 }}>USDC</span>
                <span>▼</span>
              </div>
            </div>
          </div>
        </SpringSlide>

        {/* Swap Direction Button */}
        <SpringScale enterFrame={enterFrame + 15} initialScale={0} damping={10} stiffness={120}>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-14px 0', zIndex: 10, position: 'relative' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                background: 'linear-gradient(135deg, #E91E8C 0%, #C44569 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                color: '#fff',
                boxShadow: '0 4px 15px rgba(233,30,140,0.3)',
                border: '3px solid #FFFBFC',
              }}
            >
              ↕
            </div>
          </div>
        </SpringScale>

        {/* To Token */}
        <SpringSlide enterFrame={enterFrame + 12} direction="up" distance={25}>
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 20,
              padding: 16,
              boxShadow: '0 4px 15px rgba(106,27,154,0.08)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>To</span>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>Balance: 0.5 ETH</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: '#2C3E50',
                }}
              >
                0.412
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: 25,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: '#627eea',
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: 16 }}>ETH</span>
                <span>▼</span>
              </div>
            </div>
            <div style={{ color: '#22c55e', fontSize: 14, marginTop: 4 }}>
              ≈ $1,000.07 • Best rate via Li.Fi
            </div>
          </div>
        </SpringSlide>

        {/* Swap Details */}
        <SpringSlide enterFrame={enterFrame + 20} direction="up" distance={20}>
          <div style={{ marginTop: 16, backgroundColor: 'rgba(255,183,197,0.1)', borderRadius: 16, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>Rate</span>
              <span style={{ color: '#2C3E50', fontSize: 14, fontWeight: 500 }}>1 ETH = 2,427.18 USDC</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>Slippage</span>
              <span style={{ color: '#2C3E50', fontSize: 14, fontWeight: 500 }}>0.5%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>Network Fee</span>
              <span style={{ color: '#2C3E50', fontSize: 14, fontWeight: 500 }}>~$4.50</span>
            </div>
          </div>
        </SpringSlide>

        {/* Swap Button */}
        <SpringSlide enterFrame={enterFrame + 28} direction="up" distance={20}>
          <div
            style={{
              marginTop: 24,
              padding: '18px',
              background: isButtonTapped
                ? 'linear-gradient(135deg, #C44569 0%, #E91E8C 50%, #FFB7C5 100%)'
                : 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 50%, #C44569 100%)',
              borderRadius: 20,
              textAlign: 'center',
              fontFamily: '-apple-system, sans-serif',
              fontSize: 17,
              fontWeight: 600,
              color: '#fff',
              boxShadow: isButtonTapped
                ? '0 2px 10px rgba(196,69,105,0.3)'
                : '0 6px 20px rgba(196,69,105,0.35)',
              transform: `scale(${isButtonTapped ? 0.97 : buttonPulse})`,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {isButtonTapped && frame < (tapButtonFrame || 0) + 30 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <GradientSpinner size={20} strokeWidth={2} />
                <span>Processing...</span>
              </div>
            ) : (
              'Swap Now'
            )}
            {isButtonTapped && tapButtonFrame && (
              <TapRipple
                triggerFrame={tapButtonFrame}
                duration={25}
                color="rgba(255, 255, 255, 0.3)"
              />
            )}
          </div>
        </SpringSlide>
      </div>
    </AbsoluteFill>
  )
}

const SuccessScreen: React.FC<{ enterFrame: number }> = ({ enterFrame }) => {
  const frame = useCurrentFrame()
  const fps = 30
  const localFrame = frame - enterFrame

  if (localFrame < 0) return null

  const opacity = interpolate(localFrame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const checkScale = spring({
    frame: localFrame,
    fps,
    config: { damping: 10, stiffness: 100 },
  })

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#FFFBFC' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: 40,
        }}
      >
        <GlowPulse
          triggerFrame={enterFrame + 10}
          duration={50}
          color="rgba(168, 230, 163, 0.5)"
          intensity={30}
          style={{
            width: 100,
            height: 100,
            borderRadius: 50,
            background: 'linear-gradient(135deg, #A8E6A3 0%, #22c55e 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 50,
            marginBottom: 24,
            transform: `scale(${checkScale})`,
            boxShadow: '0 10px 30px rgba(34,197,94,0.3)',
          }}
        >
          ✓
        </GlowPulse>

        <SpringSlide enterFrame={enterFrame + 15} direction="up" distance={20}>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 22,
              fontWeight: 700,
              color: '#22c55e',
              marginBottom: 8,
            }}
          >
            Transaction Complete
          </div>
        </SpringSlide>

        <SpringSlide enterFrame={enterFrame + 22} direction="up" distance={20}>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 15,
              color: '#2C3E50',
              textAlign: 'center',
            }}
          >
            1,000 USDC → 0.412 ETH
          </div>
        </SpringSlide>
      </div>

      {/* Confetti */}
      <SakuraConfetti triggerFrame={enterFrame + 20} duration={100} petalCount={50} />
    </AbsoluteFill>
  )
}

export const MobileAppDemo: React.FC = () => {
  const frame = useCurrentFrame()

  // Timeline:
  // 0-300: Discovery screen with sparklines
  // 300-600: Swap screen with button tap at 520
  // 520-620: Push notification slides down
  // 620-900: Success screen

  const showDiscovery = frame < 300
  const showSwap = frame >= 300 && frame < 620
  const showSuccess = frame >= 620
  const showNotification = frame >= 520 && frame < 700

  // Determine active tab
  const activeTabIndex = frame < 300 ? 1 : 2

  return (
    <PhoneFrame showStatusBar={true} statusBarStyle="dark" time="9:41">
      <AbsoluteFill style={{ backgroundColor: '#FFFBFC' }}>
        {/* Scene 1: Discovery Screen */}
        {showDiscovery && <DiscoveryScreen enterFrame={0} />}

        {/* Scene 2: Swap Screen with slide transition */}
        {showSwap && (
          <ScreenSlide enterFrame={300} duration={15} direction="left">
            <SwapScreen enterFrame={300} tapButtonFrame={520} />
          </ScreenSlide>
        )}

        {/* Scene 3: Success Screen */}
        {showSuccess && <SuccessScreen enterFrame={620} />}

        {/* Push Notification */}
        {showNotification && (
          <PushNotification
            enterFrame={550}
            exitFrame={700}
            title="Swap Successful!"
            body="You received 0.412 ETH • View transaction"
          />
        )}

        {/* Tab Bar */}
        <TabBar activeIndex={activeTabIndex} enterFrame={frame >= 300 ? 300 : 0} />
      </AbsoluteFill>
    </PhoneFrame>
  )
}
