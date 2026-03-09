/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./.storybook/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        'desktop': '1024px',
      },
      colors: {
        // Telegram theme colors
        tg: {
          bg: 'var(--tg-theme-bg-color, #ffffff)',
          text: 'var(--tg-theme-text-color, #000000)',
          hint: 'var(--tg-theme-hint-color, #999999)',
          link: 'var(--tg-theme-link-color, #2481cc)',
          button: 'var(--tg-theme-button-color, #2481cc)',
          'button-text': 'var(--tg-theme-button-text-color, #ffffff)',
          secondary: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
        },
        // Suwappu UI Design System
        suwappu: {
          // Sakura palette (expanded)
          'sakura-50': '#FFF5F7',
          'sakura-100': '#FFEBEF',
          'sakura-200': '#FFD1DC',
          'sakura-300': '#FFB7C5',
          'sakura-400': '#FF9DB0',
          'sakura-500': '#FF839B',
          'sakura-600': '#E66D85',
          'sakura-700': '#CC576F',
          'sakura-800': '#B34159',
          'sakura-900': '#992B43',
          // Legacy aliases
          'sakura-light': '#FFD1DC',
          'sakura-mid': '#FFB7C5',
          // Primary palette
          'magenta': '#E91E8C',
          'rose': '#F8A5C2',
          'magenta-mid': '#C44569',
          'purple': '#6C3483',
          'purple-deep': '#4A235A',
          // Secondary palette
          'sky': '#E8F4FD',
          'cyan': '#B3E5FC',
          'blue': '#87CEEB',
          'navy': '#1A237E',
          'ocean': '#0D1B4C',
          // Semantic
          'success': '#A8E6A3',
          'warning': '#FFE4A0',
          'error': '#F8A0A0',
          'info': '#90CAF9',
          // Neutral
          'bg': '#FFFBFC',
          'text': '#2C3E50',
          'text-secondary': '#6C7A89',
          'text-muted': '#9A9AB0',
          'magenta-dark': '#B8185C',
        },
        // Price impact severity scale
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
          expired: '#6B7280',
        },
        // Chain brand colors
        chain: {
          ethereum: '#627EEA',
          bsc: '#F0B90B',
          polygon: '#8247E5',
          arbitrum: '#28A0F0',
          optimism: '#FF0420',
          base: '#0052FF',
          avalanche: '#E84142',
          fantom: '#1969FF',
          linea: '#121212',
          mantle: '#000000',
          gnosis: '#04795B',
          scroll: '#FFEEDA',
          solana: '#9945FF',
          sui: '#6FBCF0',
          ton: '#0098EA',
        },
        // Provider brand colors
        provider: {
          cow: '#EC4612',
          jupiter: '#C7F284',
          socket: '#7B3FE4',
          cctp: '#3B6EAE',
          across: '#6CF9D8',
          wormhole: '#A45EFF',
          lifi: '#EF49A0',
          layerzero: '#1E1E1E',
          ccip: '#375BD2',
        },
      },
      fontFamily: {
        'display': ['Pacifico', 'Dancing Script', 'Satisfy', 'cursive'],
        'heading': ['Quicksand', 'Nunito', 'Poppins', 'sans-serif'],
        'body': ['Nunito', 'Open Sans', 'Lato', 'sans-serif'],
      },
      borderRadius: {
        'suwappu-sm': '8px',
        'suwappu-md': '12px',
        'suwappu-lg': '16px',
        'suwappu-xl': '20px',
        'suwappu-xxl': '24px',
        'suwappu-xxxl': '28px',
        'suwappu-pill': '50px',
      },
      boxShadow: {
        'suwappu-1': '0 1px 3px rgba(106,27,154,0.06), 0 1px 2px rgba(255,183,197,0.08)',
        'suwappu-2': '0 4px 6px rgba(106,27,154,0.08), 0 2px 4px rgba(255,183,197,0.1), 0 0 0 1px rgba(255,183,197,0.05)',
        'suwappu-3': '0 10px 25px rgba(106,27,154,0.12), 0 6px 10px rgba(255,183,197,0.15), 0 0 40px rgba(255,209,220,0.1)',
        'suwappu-4': '0 15px 35px rgba(106,27,154,0.15), 0 10px 20px rgba(196,69,105,0.1), 0 0 60px rgba(255,183,197,0.15)',
        'suwappu-glow': '0 0 20px rgba(255,183,197,0.4), 0 0 40px rgba(196,69,105,0.2), 0 0 60px rgba(108,52,131,0.1)',
        'suwappu-button': '0 4px 15px rgba(196,69,105,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        'suwappu-button-hover': '0 8px 25px rgba(196,69,105,0.45), 0 0 20px rgba(255,183,197,0.3)',
      },
      backgroundImage: {
        'suwappu-gradient': 'linear-gradient(135deg, #FFB7C5 0%, #C44569 35%, #6C3483 70%, #4A235A 100%)',
        'suwappu-button-hover': 'linear-gradient(180deg, #F8A5C2 0%, #E91E8C 100%)',
        'suwappu-card': 'linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,215,220,0.3) 100%)',
        'suwappu-glass': 'linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,215,220,0.4) 50%, rgba(232,244,253,0.6) 100%)',
        'suwappu-petal': 'linear-gradient(135deg, #FFD1DC 0%, #FFB7C5 50%, #F8A5C2 100%)',
      },
      animation: {
        'suwappu-petal': 'suwappu-petal-float 8s ease-in-out infinite, suwappu-petal-sway 3s ease-in-out infinite',
        'suwappu-bounce': 'suwappu-bounce 1.4s ease-in-out infinite',
        'suwappu-shimmer': 'suwappu-shimmer 1.5s infinite',
        'suwappu-heart': 'suwappu-heart-burst 0.6s ease-in-out',
        'page-enter': 'page-enter 0.3s cubic-bezier(0.22, 1, 0.36, 1) both',
        'toast-enter': 'toast-enter 0.2s ease-out both',
        'toast-exit': 'toast-exit 0.2s ease-out both',
        // Swap-specific animations
        'swap-flip': 'suwappu-swap-flip 200ms ease-out',
        'price-up': 'suwappu-price-tick-up 300ms ease',
        'price-down': 'suwappu-price-tick-down 300ms ease',
        'pulse-pending': 'suwappu-pulse-pending 2s ease-in-out infinite',
        'quote-shimmer': 'suwappu-quote-shimmer 1.5s ease-in-out infinite',
        'slide-up': 'suwappu-slide-up 300ms cubic-bezier(0.175,0.885,0.32,1.275)',
        'number-spring': 'suwappu-number-spring 400ms cubic-bezier(0.175,0.885,0.32,1.275)',
      },
      keyframes: {
        'suwappu-petal-float': {
          '0%': { transform: 'translateY(0) translateX(0) rotate(0deg)', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { transform: 'translateY(100vh) translateX(100px) rotate(360deg)', opacity: '0' },
        },
        'suwappu-petal-sway': {
          '0%, 100%': { transform: 'rotate(-5deg) scale(1)' },
          '50%': { transform: 'rotate(5deg) scale(1.05)' },
        },
        'suwappu-bounce': {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-12px)' },
        },
        'suwappu-shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'suwappu-heart-burst': {
          '0%': { transform: 'scale(1)' },
          '25%': { transform: 'scale(1.3)' },
          '50%': { transform: 'scale(0.9)' },
          '75%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
