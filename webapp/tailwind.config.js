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
        'suwappu-petal': 'suwappu-petal-float 8s ease-in-out infinite, suwappu-petal-sway 3s ease-in-out infinite',
        'suwappu-bounce': 'suwappu-bounce 1.4s ease-in-out infinite',
        'suwappu-shimmer': 'suwappu-shimmer 1.5s infinite',
        'suwappu-heart': 'suwappu-heart-burst 0.6s ease-in-out',
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
