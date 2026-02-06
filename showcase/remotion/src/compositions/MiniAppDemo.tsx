import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, spring } from 'remotion'
import { PhoneFrame } from '../components/PhoneFrame'
import { CountingNumber } from '../components/ProgressBar'
import { SpringSlide, SpringScale, StaggeredSlide } from '../components/SpringSlide'
import { ScreenSlide } from '../components/BlurTransition'
import { SakuraConfetti, ConfettiBurst } from '../components/Confetti'
import { LoadingSpinner, GradientSpinner } from '../components/LoadingSpinner'
import { TapRipple, GlowPulse } from '../components/TapRipple'

interface SkeletonProps {
  width: number | string
  height: number
  borderRadius?: number
}

const Skeleton: React.FC<SkeletonProps> = ({ width, height, borderRadius = 8 }) => {
  const frame = useCurrentFrame()

  // Shimmer animation
  const shimmerPosition = interpolate(frame % 60, [0, 60], [-100, 200], {
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: '#e8e8e8',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '50%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
          transform: `translateX(${shimmerPosition}%)`,
        }}
      />
    </div>
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
    { icon: '📊', label: 'Portfolio' },
    { icon: '💱', label: 'Swap' },
    { icon: '🔔', label: 'Alerts' },
    { icon: '⚙️', label: 'Settings' },
  ]

  // Tab indicator animation
  const indicatorX = spring({
    frame: Math.max(0, frame - enterFrame),
    fps,
    config: { damping: 15, stiffness: 150 },
    from: 0,
    to: activeIndex * 85,
  })

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 80,
        backgroundColor: '#fff',
        borderTop: '1px solid rgba(255,183,197,0.2)',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingBottom: 20,
      }}
    >
      {/* Active tab indicator */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: `calc(${indicatorX}px + 12.5%)`,
          width: 50,
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
          }}
        >
          <span style={{ fontSize: 22 }}>{tab.icon}</span>
          <span
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 11,
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

const PortfolioScreenSkeleton: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#FFFBFC' }}>
      {/* Header */}
      <div
        style={{
          padding: '55px 20px 20px',
          background: 'linear-gradient(180deg, #E91E8C 0%, #C44569 100%)',
        }}
      >
        <Skeleton width={120} height={32} borderRadius={8} />
        <div style={{ marginTop: 8 }}>
          <Skeleton width={180} height={16} borderRadius={4} />
        </div>
      </div>

      {/* Portfolio Card Skeleton */}
      <div style={{ padding: '20px' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 20,
            padding: 20,
            boxShadow: '0 4px 12px rgba(106,27,154,0.08)',
          }}
        >
          <Skeleton width={100} height={14} borderRadius={4} />
          <div style={{ marginTop: 12 }}>
            <Skeleton width={180} height={36} borderRadius={8} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width={140} height={16} borderRadius={4} />
          </div>
        </div>
      </div>

      {/* Token List Skeleton */}
      <div style={{ padding: '0 20px' }}>
        <Skeleton width={100} height={18} borderRadius={4} />
        <div style={{ marginTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 0',
                gap: 12,
              }}
            >
              <Skeleton width={40} height={40} borderRadius={20} />
              <div style={{ flex: 1 }}>
                <Skeleton width={60} height={16} borderRadius={4} />
                <div style={{ marginTop: 4 }}>
                  <Skeleton width={80} height={12} borderRadius={4} />
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Skeleton width={70} height={16} borderRadius={4} />
                <div style={{ marginTop: 4 }}>
                  <Skeleton width={50} height={12} borderRadius={4} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  )
}

const PortfolioScreen: React.FC<{ enterFrame: number }> = ({ enterFrame }) => {
  const frame = useCurrentFrame()
  const fps = 30

  if (frame < enterFrame) return null

  const localFrame = frame - enterFrame

  const opacity = interpolate(localFrame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  })

  const tokens = [
    { symbol: 'ETH', name: 'Ethereum', balance: '2.5', value: '$6,067.95', change: '+2.1%' },
    { symbol: 'USDC', name: 'USD Coin', balance: '5,000', value: '$5,000.00', change: '0.0%' },
    { symbol: 'MATIC', name: 'Polygon', balance: '2,100', value: '$1,779.37', change: '+5.2%' },
  ]

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Header */}
      <div
        style={{
          padding: '55px 20px 20px',
          background: 'linear-gradient(180deg, #E91E8C 0%, #C44569 100%)',
        }}
      >
        <div
          style={{
            fontFamily: 'Pacifico, cursive',
            fontSize: 28,
            color: '#fff',
            marginBottom: 8,
          }}
        >
          Suwappu
        </div>
        <div
          style={{
            fontFamily: '-apple-system, sans-serif',
            fontSize: 14,
            color: 'rgba(255,255,255,0.8)',
          }}
        >
          Good morning, Trader!
        </div>
      </div>

      {/* Portfolio Card */}
      <SpringSlide enterFrame={enterFrame + 10} direction="up" distance={30}>
        <div style={{ padding: '20px' }}>
          <div
            style={{
              background: 'linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,215,220,0.3) 100%)',
              borderRadius: 20,
              padding: 20,
              boxShadow: '0 10px 25px rgba(106,27,154,0.12)',
            }}
          >
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 14,
                color: '#6C7A89',
                marginBottom: 4,
              }}
            >
              Total Balance
            </div>
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 32,
                fontWeight: 700,
                color: '#2C3E50',
                marginBottom: 8,
              }}
            >
              <CountingNumber
                enterFrame={enterFrame + 20}
                duration={45}
                startValue={0}
                endValue={12847.32}
                prefix="$"
                decimals={2}
              />
            </div>
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 14,
                color: '#22c55e',
              }}
            >
              +$423.18 (3.4%) today
            </div>
          </div>
        </div>
      </SpringSlide>

      {/* Token List */}
      <div style={{ padding: '0 20px' }}>
        <SpringSlide enterFrame={enterFrame + 25} direction="up" distance={20}>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 16,
              fontWeight: 600,
              color: '#2C3E50',
              marginBottom: 12,
            }}
          >
            Your Tokens
          </div>
        </SpringSlide>

        {tokens.map((token, index) => (
          <SpringSlide
            key={token.symbol}
            enterFrame={enterFrame + 35 + index * 8}
            direction="up"
            distance={20}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: index < tokens.length - 1 ? '1px solid rgba(255,183,197,0.2)' : 'none',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  background: 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
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
                  {token.balance} {token.symbol}
                </div>
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
                  {token.value}
                </div>
                <div
                  style={{
                    fontFamily: '-apple-system, sans-serif',
                    fontSize: 13,
                    color: token.change.startsWith('+') ? '#22c55e' : '#6C7A89',
                  }}
                >
                  {token.change}
                </div>
              </div>
            </div>
          </SpringSlide>
        ))}
      </div>
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
            padding: '55px 20px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
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

      {/* Swap Card */}
      <div style={{ padding: '20px' }}>
        {/* From */}
        <SpringSlide enterFrame={enterFrame + 8} direction="up" distance={25}>
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 16,
              boxShadow: '0 4px 12px rgba(106,27,154,0.08)',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 13,
                color: '#6C7A89',
                marginBottom: 8,
              }}
            >
              From
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{
                  fontFamily: '-apple-system, sans-serif',
                  fontSize: 28,
                  fontWeight: 600,
                  color: '#2C3E50',
                }}
              >
                500
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: 20,
                }}
              >
                <span style={{ fontWeight: 600 }}>USDC</span>
                <span>▼</span>
              </div>
            </div>
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 13,
                color: '#6C7A89',
                marginTop: 4,
              }}
            >
              Balance: 5,000 USDC
            </div>
          </div>
        </SpringSlide>

        {/* Swap Icon */}
        <SpringScale enterFrame={enterFrame + 15} initialScale={0} damping={10} stiffness={120}>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-12px 0', zIndex: 10, position: 'relative' }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                background: 'linear-gradient(135deg, #E91E8C 0%, #C44569 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                color: '#fff',
                boxShadow: '0 4px 12px rgba(233,30,140,0.3)',
              }}
            >
              ↕
            </div>
          </div>
        </SpringScale>

        {/* To */}
        <SpringSlide enterFrame={enterFrame + 12} direction="up" distance={25}>
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 16,
              boxShadow: '0 4px 12px rgba(106,27,154,0.08)',
            }}
          >
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 13,
                color: '#6C7A89',
                marginBottom: 8,
              }}
            >
              To
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{
                  fontFamily: '-apple-system, sans-serif',
                  fontSize: 28,
                  fontWeight: 600,
                  color: '#2C3E50',
                }}
              >
                0.206
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: 20,
                }}
              >
                <span style={{ fontWeight: 600 }}>ETH</span>
                <span>▼</span>
              </div>
            </div>
            <div
              style={{
                fontFamily: '-apple-system, sans-serif',
                fontSize: 13,
                color: '#22c55e',
                marginTop: 4,
              }}
            >
              ≈ $500.12 @ $2,427.18
            </div>
          </div>
        </SpringSlide>

        {/* Rate Info */}
        <SpringSlide enterFrame={enterFrame + 20} direction="up" distance={20}>
          <div style={{ marginTop: 16, padding: '12px', backgroundColor: 'rgba(255,183,197,0.1)', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>Rate</span>
              <span style={{ color: '#2C3E50', fontSize: 14, fontWeight: 500 }}>1 ETH = 2,427.18 USDC</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6C7A89', fontSize: 14 }}>Network Fee</span>
              <span style={{ color: '#2C3E50', fontSize: 14, fontWeight: 500 }}>~$2.50</span>
            </div>
          </div>
        </SpringSlide>

        {/* Swap Button */}
        <SpringSlide enterFrame={enterFrame + 28} direction="up" distance={20}>
          <div
            style={{
              marginTop: 24,
              padding: '16px',
              background: isButtonTapped
                ? 'linear-gradient(135deg, #C44569 0%, #E91E8C 50%, #FFB7C5 100%)'
                : 'linear-gradient(135deg, #FFB7C5 0%, #E91E8C 50%, #C44569 100%)',
              borderRadius: 16,
              textAlign: 'center',
              fontFamily: '-apple-system, sans-serif',
              fontSize: 16,
              fontWeight: 600,
              color: '#fff',
              boxShadow: isButtonTapped
                ? '0 2px 8px rgba(196,69,105,0.3)'
                : '0 4px 15px rgba(196,69,105,0.35)',
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
            width: 120,
            height: 120,
            borderRadius: 60,
            background: 'linear-gradient(135deg, #A8E6A3 0%, #22c55e 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 60,
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
              fontSize: 24,
              fontWeight: 700,
              color: '#22c55e',
              marginBottom: 12,
            }}
          >
            Swap Successful!
          </div>
        </SpringSlide>

        <SpringSlide enterFrame={enterFrame + 22} direction="up" distance={20}>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 16,
              color: '#2C3E50',
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            You swapped 500 USDC for 0.206 ETH
          </div>
        </SpringSlide>

        <SpringSlide enterFrame={enterFrame + 28} direction="up" distance={20}>
          <div
            style={{
              fontFamily: '-apple-system, sans-serif',
              fontSize: 14,
              color: '#6C7A89',
            }}
          >
            Tx: 0x7a3b...f291
          </div>
        </SpringSlide>
      </div>

      {/* Confetti */}
      <SakuraConfetti triggerFrame={enterFrame + 20} duration={100} petalCount={60} />
    </AbsoluteFill>
  )
}

export const MiniAppDemo: React.FC = () => {
  const frame = useCurrentFrame()

  // Timeline:
  // 0-60: Skeleton loading state
  // 60-300: Portfolio screen with animations
  // 300-320: Tab switch animation
  // 320-580: Swap screen with button tap at 540
  // 580-900: Success screen with confetti

  const showSkeleton = frame < 60
  const showPortfolio = frame >= 60 && frame < 300
  const showSwap = frame >= 300 && frame < 580
  const showSuccess = frame >= 580

  // Determine active tab
  const activeTabIndex = frame < 300 ? 0 : 1

  return (
    <PhoneFrame showStatusBar={true} statusBarStyle="dark" time="9:41">
      <AbsoluteFill style={{ backgroundColor: '#FFFBFC' }}>
        {/* Scene 1: Skeleton Loading */}
        {showSkeleton && <PortfolioScreenSkeleton />}

        {/* Scene 2: Portfolio Screen */}
        {showPortfolio && <PortfolioScreen enterFrame={60} />}

        {/* Scene 3: Swap Screen with slide transition */}
        {showSwap && (
          <ScreenSlide enterFrame={300} duration={15} direction="left">
            <SwapScreen enterFrame={300} tapButtonFrame={540} />
          </ScreenSlide>
        )}

        {/* Scene 4: Success Screen */}
        {showSuccess && <SuccessScreen enterFrame={580} />}

        {/* Tab Bar - always visible */}
        <TabBar activeIndex={activeTabIndex} enterFrame={frame >= 300 ? 300 : 0} />
      </AbsoluteFill>
    </PhoneFrame>
  )
}
