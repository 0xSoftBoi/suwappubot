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
        // Terminal dark theme
        terminal: {
          bg: '#0a0a0f',
          'bg-secondary': '#12121a',
          'bg-tertiary': '#1a1a2e',
          panel: '#0f0f18',
          border: '#1e1e30',
          'border-active': '#2a2a45',
          text: '#e2e2f0',
          'text-secondary': '#8888a0',
          'text-muted': '#55556a',
        },
        // Suwappu sakura accent (carried from webapp)
        sakura: {
          50: '#FFF5F7',
          100: '#FFEBEF',
          200: '#FFD1DC',
          300: '#FFB7C5',
          400: '#FF9DB0',
          500: '#FF839B',
          600: '#E66D85',
          700: '#CC576F',
          800: '#B34159',
          900: '#992B43',
        },
        // Trading colors
        bull: '#22c55e',
        bear: '#ef4444',
        'bull-dim': '#16351f',
        'bear-dim': '#351616',
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
