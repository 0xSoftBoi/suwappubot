'use client'

import { useState } from 'react'

interface ChainIconProps {
  chain: string
  size?: number
  className?: string
  showLabel?: boolean
}

const chainData: Record<string, { color: string; icon: JSX.Element }> = {
  Ethereum: {
    color: '#627EEA',
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M16 2l-0.1 0.3v18.4l0.1 0.1 8.5-5L16 2z" opacity="0.6" />
        <path d="M16 2L7.5 15.8l8.5 5V2z" />
        <path d="M16 22.5l-0.1 0.1v6.5l0.1 0.2 8.5-12L16 22.5z" opacity="0.6" />
        <path d="M16 29.3v-6.8l-8.5-5.2L16 29.3z" />
        <path d="M16 20.8l8.5-5L16 12.3v8.5z" opacity="0.2" />
        <path d="M7.5 15.8l8.5 5v-8.5l-8.5 3.5z" opacity="0.6" />
      </svg>
    ),
  },
  BSC: {
    color: '#F0B90B',
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M16 5l3.1 3.1-7.4 7.4L8.6 12.4 16 5zm8.9 3.1L28 11.2l-3.1 3.1-3.1-3.1 3.1-3.1zM7.1 8.1l3.1 3.1-3.1 3.1L4 11.2l3.1-3.1zM16 14.2l3.1 3.1L16 20.4l-3.1-3.1L16 14.2zm8.9-0.1l3.1 3.1-3.1 3.1-3.1-3.1 3.1-3.1zM7.1 14.1l3.1 3.1-3.1 3.1-3.1-3.1 3.1-3.1zM16 22.1l3.1 3.1L16 28.3l-3.1-3.1L16 22.1z" />
      </svg>
    ),
  },
  Polygon: {
    color: '#8247E5',
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M21.8 13.1c-0.5-0.3-1.1-0.3-1.5 0l-3.5 2.1-2.4 1.3-3.5 2.1c-0.5 0.3-1.1 0.3-1.5 0l-2.8-1.6c-0.5-0.3-0.8-0.8-0.8-1.4v-3.1c0-0.5 0.3-1.1 0.8-1.4l2.7-1.6c0.5-0.3 1.1-0.3 1.5 0l2.7 1.6c0.5 0.3 0.8 0.8 0.8 1.4v2.1l2.4-1.4v-2.1c0-0.5-0.3-1.1-0.8-1.4l-5.1-2.9c-0.5-0.3-1.1-0.3-1.5 0l-5.2 3c-0.5 0.3-0.8 0.8-0.8 1.4v5.8c0 0.5 0.3 1.1 0.8 1.4l5.1 2.9c0.5 0.3 1.1 0.3 1.5 0l3.5-2 2.4-1.4 3.5-2c0.5-0.3 1.1-0.3 1.5 0l2.7 1.6c0.5 0.3 0.8 0.8 0.8 1.4v3.1c0 0.5-0.3 1.1-0.8 1.4l-2.7 1.6c-0.5 0.3-1.1 0.3-1.5 0l-2.7-1.6c-0.5-0.3-0.8-0.8-0.8-1.4v-2l-2.4 1.4v2.1c0 0.5 0.3 1.1 0.8 1.4l5.1 2.9c0.5 0.3 1.1 0.3 1.5 0l5.1-2.9c0.5-0.3 0.8-0.8 0.8-1.4v-5.8c0-0.5-0.3-1.1-0.8-1.4l-5.2-3z" />
      </svg>
    ),
  },
  Arbitrum: {
    color: '#28A0F0',
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M16.6 18.8l2.4 6.6 3.7-2.1-4.7-12.5-1.4 8zm7.4 2.1l1.3-0.7-4.5-12.2-1.5 4 3.4 9.1 1.3-0.2zm-12.8-4l4.3 11.7 2.5-1.4-3.1-8.6-3.7-1.7zm-2.7-3.9l-1.8 1 6.1 13.8 2.2-1.3-6.5-13.5zM16 3L5 9.4v12.3L16 28l11-6.3V9.4L16 3zm8.7 16.3L16 24.5l-8.7-5.2V12.7L16 7.5l8.7 5.2v6.6z" />
      </svg>
    ),
  },
  Optimism: {
    color: '#FF0420',
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M11.3 20.4c-1.1 0-2-0.3-2.7-1-0.7-0.7-1-1.6-1-2.7 0-1.4 0.4-2.7 1.1-3.8 0.8-1.1 1.9-1.7 3.3-1.7 1.1 0 2 0.3 2.6 1 0.6 0.7 1 1.5 1 2.6 0 1.5-0.4 2.8-1.2 3.9-0.8 1.1-1.9 1.7-3.1 1.7zm0.3-2c0.5 0 0.9-0.3 1.2-0.9 0.3-0.6 0.5-1.4 0.5-2.3 0-0.6-0.1-1.1-0.4-1.4-0.2-0.3-0.6-0.5-1-0.5s-0.9 0.3-1.2 0.9c-0.3 0.6-0.5 1.3-0.5 2.2 0 0.7 0.1 1.2 0.4 1.5 0.2 0.3 0.6 0.5 1 0.5zm8.8 2c-0.8 0-1.4-0.2-1.9-0.7-0.5-0.5-0.7-1.1-0.7-1.9 0-0.6 0.1-1.2 0.3-1.8h2.2c-0.1 0.5-0.2 0.9-0.2 1.4 0 0.3 0.1 0.6 0.2 0.8s0.4 0.3 0.6 0.3c0.3 0 0.5-0.1 0.7-0.3 0.2-0.2 0.3-0.5 0.3-0.8 0-0.4-0.2-0.8-0.5-1.1l-1.5-1.7c-0.6-0.7-0.9-1.4-0.9-2.1 0-0.9 0.3-1.6 0.9-2.1 0.6-0.5 1.3-0.8 2.2-0.8 0.8 0 1.4 0.2 1.8 0.7 0.4 0.4 0.6 1 0.6 1.7 0 0.5-0.1 1-0.2 1.5h-2.1c0.1-0.4 0.1-0.8 0.1-1.2 0-0.3-0.1-0.5-0.2-0.7-0.1-0.2-0.3-0.2-0.5-0.2-0.3 0-0.5 0.1-0.6 0.3-0.2 0.2-0.2 0.4-0.2 0.7 0 0.4 0.2 0.7 0.5 1.1l1.5 1.7c0.6 0.7 0.9 1.4 0.9 2.2 0 0.9-0.3 1.6-0.9 2.2-0.7 0.5-1.5 0.8-2.4 0.8z" />
      </svg>
    ),
  },
  Base: {
    color: '#0052FF',
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M16 28c6.627 0 12-5.373 12-12S22.627 4 16 4C9.608 4 4.385 9.012 4.014 15.309h16.382v1.382H4.014C4.385 22.988 9.608 28 16 28z" />
      </svg>
    ),
  },
  Solana: {
    color: '#9945FF',
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor">
        <path d="M8.3 21.7c0.2-0.2 0.4-0.3 0.7-0.3h17.5c0.4 0 0.6 0.5 0.4 0.8l-3.2 3.2c-0.2 0.2-0.4 0.3-0.7 0.3H5.5c-0.4 0-0.6-0.5-0.4-0.8l3.2-3.2zm0-15.1c0.2-0.2 0.4-0.3 0.7-0.3h17.5c0.4 0 0.6 0.5 0.4 0.8l-3.2 3.2c-0.2 0.2-0.4 0.3-0.7 0.3H5.5c-0.4 0-0.6-0.5-0.4-0.8l3.2-3.2zm15.4 7.5c-0.2-0.2-0.4-0.3-0.7-0.3H5.5c-0.4 0-0.6 0.5-0.4 0.8l3.2 3.2c0.2 0.2 0.4 0.3 0.7 0.3h17.5c0.4 0 0.6-0.5 0.4-0.8l-3.2-3.2z" />
      </svg>
    ),
  },
}

export default function ChainIcon({ chain, size = 24, className = '', showLabel = false }: ChainIconProps) {
  const [hovered, setHovered] = useState(false)
  const data = chainData[chain]

  if (!data) return null

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-suwappu-pill glass-card cursor-default transition-all duration-200 ${className}`}
      style={{
        borderColor: hovered ? data.color : undefined,
        boxShadow: hovered ? `0 0 12px ${data.color}33` : undefined,
      }}
      title={chain}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="inline-block flex-shrink-0 transition-colors duration-200"
        style={{ width: size, height: size, color: hovered ? data.color : 'currentColor' }}
      >
        {data.icon}
      </span>
      {showLabel && (
        <span
          className="font-heading text-xs font-medium transition-colors duration-200"
          style={{ color: hovered ? data.color : undefined }}
        >
          {chain}
        </span>
      )}
    </div>
  )
}
