const persimmonScale = {
  50: '#FFFCF7',
  100: '#FFF6EA',
  200: '#FCE6C2',
  300: '#F6CF85',
  400: '#EDA650',
  500: '#E58D2B',
  600: '#D37322',
  700: '#B75D21',
  800: '#864521',
  900: '#5B3A24',
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Bright studio terminal theme
        terminal: {
          bg: '#FFFDF9',
          'bg-secondary': '#FFF8EE',
          'bg-tertiary': '#F7EEDA',
          panel: '#FFFFFF',
          border: '#E6D9C3',
          'border-active': '#D8BE90',
          text: '#2F221A',
          'text-secondary': '#7B6A57',
          'text-muted': '#AD987E',
        },
        // Persimmon brand accent; `sakura` remains as a compatibility alias.
        persimmon: persimmonScale,
        sakura: persimmonScale,
        // Trading colors
        bull: '#22c55e',
        bear: '#ef4444',
        'bull-dim': '#EAF8EF',
        'bear-dim': '#FCEDEA',
        // Chain brand colors
        chain: {
          ethereum: '#627EEA',
          bsc: '#F0B90B',
          polygon: '#8247E5',
          arbitrum: '#28A0F0',
          optimism: '#FF0420',
          base: '#0052FF',
          avalanche: '#E84142',
          solana: '#9945FF',
          sui: '#6FBCF0',
        },
        // Provider brand colors
        provider: {
          cow: '#EC4612',
          jupiter: '#C7F284',
          socket: '#7B3FE4',
          across: '#6CF9D8',
          wormhole: '#A45EFF',
          lifi: '#EF49A0',
        },
        // Price impact severity
        impact: {
          negligible: '#4ADE80',
          low: '#22C55E',
          medium: '#FACC15',
          high: '#F97316',
          severe: '#EF4444',
        },
        // Transaction states
        'tx-state': {
          pending: '#F59E0B',
          confirming: '#3B82F6',
          bridging: '#8B5CF6',
          success: '#22C55E',
          failed: '#EF4444',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'price-up': 'price-tick-up 300ms ease',
        'price-down': 'price-tick-down 300ms ease',
        shimmer: 'shimmer 1.5s infinite',
      },
      keyframes: {
        'price-tick-up': {
          '0%': { color: 'inherit' },
          '50%': { color: '#22c55e' },
          '100%': { color: 'inherit' },
        },
        'price-tick-down': {
          '0%': { color: 'inherit' },
          '50%': { color: '#ef4444' },
          '100%': { color: 'inherit' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}
