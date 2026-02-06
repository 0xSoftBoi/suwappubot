import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'

interface PhoneFrameProps {
  children: React.ReactNode
  variant?: 'iphone' | 'iphone-mini' | 'android'
  showStatusBar?: boolean
  statusBarStyle?: 'light' | 'dark'
  showHomeIndicator?: boolean
  showReflection?: boolean
  time?: string
}

/**
 * Realistic iPhone 15 Pro frame with Dynamic Island, status bar, and home indicator.
 * Premium phone mockup for video demos.
 */
export const PhoneFrame: React.FC<PhoneFrameProps> = ({
  children,
  variant = 'iphone',
  showStatusBar = true,
  statusBarStyle = 'dark',
  showHomeIndicator = true,
  showReflection = true,
  time = '9:41',
}) => {
  const frame = useCurrentFrame()

  // Frame dimensions (iPhone 15 Pro proportions)
  const frameWidth = variant === 'iphone-mini' ? 320 : 360
  const frameHeight = variant === 'iphone-mini' ? 693 : 780
  const borderRadius = variant === 'iphone-mini' ? 44 : 50
  const screenBorderRadius = variant === 'iphone-mini' ? 38 : 44

  // Dynamic Island dimensions (iPhone 15 Pro style)
  const dynamicIslandWidth = variant === 'iphone-mini' ? 108 : 126
  const dynamicIslandHeight = variant === 'iphone-mini' ? 32 : 37

  // Status bar colors
  const statusBarColor = statusBarStyle === 'light' ? '#fff' : '#000'
  const statusBarTextColor = statusBarStyle === 'light' ? '#fff' : '#000'

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Phone body - titanium frame */}
      <div
        style={{
          width: frameWidth,
          height: frameHeight,
          backgroundColor: '#2d2d2d',
          borderRadius,
          padding: 10,
          boxShadow: `
            0 25px 60px rgba(0,0,0,0.5),
            0 10px 20px rgba(0,0,0,0.3),
            inset 0 1px 0 rgba(255,255,255,0.15),
            inset 0 -1px 0 rgba(0,0,0,0.3)
          `,
          position: 'relative',
        }}
      >
        {/* Side buttons - volume */}
        <div
          style={{
            position: 'absolute',
            left: -3,
            top: 120,
            width: 3,
            height: 32,
            backgroundColor: '#3d3d3d',
            borderRadius: '2px 0 0 2px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: -3,
            top: 165,
            width: 3,
            height: 50,
            backgroundColor: '#3d3d3d',
            borderRadius: '2px 0 0 2px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: -3,
            top: 225,
            width: 3,
            height: 50,
            backgroundColor: '#3d3d3d',
            borderRadius: '2px 0 0 2px',
          }}
        />

        {/* Side button - power */}
        <div
          style={{
            position: 'absolute',
            right: -3,
            top: 180,
            width: 3,
            height: 70,
            backgroundColor: '#3d3d3d',
            borderRadius: '0 2px 2px 0',
          }}
        />

        {/* Screen container */}
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#000',
            borderRadius: screenBorderRadius,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Screen content */}
          <div style={{ position: 'absolute', inset: 0 }}>
            {children}
          </div>

          {/* Dynamic Island */}
          {variant !== 'android' && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                width: dynamicIslandWidth,
                height: dynamicIslandHeight,
                backgroundColor: '#000',
                borderRadius: dynamicIslandHeight / 2,
                zIndex: 100,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
              }}
            >
              {/* Front camera lens */}
              <div
                style={{
                  position: 'absolute',
                  right: 20,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: '#1a1a2e',
                  boxShadow: 'inset 0 0 3px rgba(0,0,0,0.5)',
                }}
              >
                {/* Lens reflection */}
                <div
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: 2,
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Status bar */}
          {showStatusBar && variant !== 'android' && (
            <StatusBar
              time={time}
              textColor={statusBarTextColor}
              dynamicIslandWidth={dynamicIslandWidth}
            />
          )}

          {/* Android status bar */}
          {showStatusBar && variant === 'android' && (
            <AndroidStatusBar time={time} />
          )}

          {/* Home indicator */}
          {showHomeIndicator && variant !== 'android' && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 134,
                height: 5,
                backgroundColor: 'rgba(255,255,255,0.3)',
                borderRadius: 3,
                zIndex: 100,
              }}
            />
          )}

          {/* Android navigation bar */}
          {variant === 'android' && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: 50,
                zIndex: 100,
              }}
            >
              <div style={{ width: 16, height: 16, borderRadius: 2, border: '2px solid rgba(255,255,255,0.3)' }} />
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)' }} />
              <div style={{ width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '14px solid rgba(255,255,255,0.3)' }} />
            </div>
          )}

          {/* Screen reflection/glare overlay */}
          {showReflection && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 50%, transparent 100%)',
                pointerEvents: 'none',
                zIndex: 90,
              }}
            />
          )}
        </div>
      </div>
    </AbsoluteFill>
  )
}

interface StatusBarProps {
  time: string
  textColor: string
  dynamicIslandWidth: number
}

/**
 * iOS-style status bar with time, signal, WiFi, and battery.
 */
const StatusBar: React.FC<StatusBarProps> = ({ time, textColor, dynamicIslandWidth }) => {
  const sideWidth = (340 - dynamicIslandWidth) / 2 - 12

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 54,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        padding: '14px 20px 0',
        zIndex: 99,
      }}
    >
      {/* Left side - Time */}
      <div
        style={{
          width: sideWidth,
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, sans-serif',
          fontSize: 15,
          fontWeight: 600,
          color: textColor,
          letterSpacing: '-0.3px',
        }}
      >
        {time}
      </div>

      {/* Right side - Icons */}
      <div
        style={{
          width: sideWidth,
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {/* Cellular signal */}
        <svg width="17" height="12" viewBox="0 0 17 12" fill={textColor}>
          <rect x="0" y="8" width="3" height="4" rx="0.5" />
          <rect x="4.5" y="5" width="3" height="7" rx="0.5" />
          <rect x="9" y="2" width="3" height="10" rx="0.5" />
          <rect x="13.5" y="0" width="3" height="12" rx="0.5" />
        </svg>

        {/* WiFi */}
        <svg width="16" height="12" viewBox="0 0 16 12" fill={textColor}>
          <path d="M8 2.4c2.5 0 4.8 1 6.5 2.6.3.3.3.8 0 1.1-.3.3-.8.3-1.1 0C12 4.8 10.1 4 8 4S4 4.8 2.6 6.1c-.3.3-.8.3-1.1 0-.3-.3-.3-.8 0-1.1C3.2 3.4 5.5 2.4 8 2.4z" />
          <path d="M8 5.6c1.7 0 3.3.7 4.4 1.8.3.3.3.8 0 1.1-.3.3-.8.3-1.1 0-.8-.8-2-1.3-3.3-1.3s-2.5.5-3.3 1.3c-.3.3-.8.3-1.1 0-.3-.3-.3-.8 0-1.1C4.7 6.3 6.3 5.6 8 5.6z" />
          <circle cx="8" cy="10.5" r="1.5" />
        </svg>

        {/* Battery */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 24,
              height: 12,
              border: `1px solid ${textColor}`,
              borderRadius: 3,
              padding: 1.5,
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: textColor,
                borderRadius: 1,
              }}
            />
          </div>
          <div
            style={{
              width: 2,
              height: 5,
              backgroundColor: textColor,
              borderRadius: '0 1px 1px 0',
              marginLeft: 0.5,
            }}
          />
        </div>
      </div>
    </div>
  )
}

interface AndroidStatusBarProps {
  time: string
}

/**
 * Android-style status bar.
 */
const AndroidStatusBar: React.FC<AndroidStatusBarProps> = ({ time }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      backgroundColor: 'rgba(0,0,0,0.1)',
      zIndex: 99,
    }}
  >
    <div
      style={{
        fontFamily: 'Roboto, sans-serif',
        fontSize: 14,
        color: '#fff',
      }}
    >
      {time}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* WiFi */}
      <svg width="14" height="12" viewBox="0 0 14 12" fill="#fff">
        <path d="M7 4c1.9 0 3.6.8 4.8 2l-1.4 1.4C9.5 6.5 8.3 6 7 6s-2.5.5-3.4 1.4L2.2 6C3.4 4.8 5.1 4 7 4zm0-4c3 0 5.8 1.2 7.8 3.2l-1.4 1.4C11.8 3 9.5 2 7 2S2.2 3 .6 4.6L-.8 3.2C1.2 1.2 4 0 7 0z" />
        <circle cx="7" cy="10" r="2" />
      </svg>
      {/* Battery */}
      <svg width="20" height="12" viewBox="0 0 20 12" fill="#fff">
        <rect x="0" y="1" width="18" height="10" rx="2" fill="none" stroke="#fff" strokeWidth="1.5" />
        <rect x="2" y="3" width="14" height="6" rx="1" />
        <rect x="18" y="4" width="2" height="4" rx="0.5" />
      </svg>
    </div>
  </div>
)

/**
 * Minimal phone frame without extra chrome.
 * Use when you need more screen real estate.
 */
export const MinimalPhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: '#1a1a1a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        width: 360,
        height: 780,
        backgroundColor: '#000',
        borderRadius: 44,
        overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        position: 'relative',
      }}
    >
      {children}
    </div>
  </AbsoluteFill>
)
