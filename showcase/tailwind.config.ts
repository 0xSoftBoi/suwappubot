import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Suwappu UI Design System
        suwappu: {
          // Primary palette
          'sakura-light': '#FFD1DC',
          'sakura-mid': '#FFB7C5',
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
        'suwappu-petal': 'suwappu-petal-float 8s ease-in-out infinite',
        'suwappu-bounce': 'suwappu-bounce 1.4s ease-in-out infinite',
        'suwappu-shimmer': 'suwappu-shimmer 1.5s infinite',
        'sakura-fall': 'sakura-fall 10s linear infinite',
        'sakura-sway': 'sakura-sway 3s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.6s ease-out forwards',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        'suwappu-petal-float': {
          '0%': { transform: 'translateY(0) translateX(0) rotate(0deg)', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { transform: 'translateY(100vh) translateX(100px) rotate(360deg)', opacity: '0' },
        },
        'suwappu-bounce': {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-12px)' },
        },
        'suwappu-shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'sakura-fall': {
          '0%': { transform: 'translateY(-10vh) translateX(0) rotate(0deg)', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { transform: 'translateY(110vh) translateX(20vw) rotate(720deg)', opacity: '0' },
        },
        'sakura-sway': {
          '0%, 100%': { transform: 'translateX(0) rotate(0deg)' },
          '25%': { transform: 'translateX(15px) rotate(5deg)' },
          '75%': { transform: 'translateX(-15px) rotate(-5deg)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
