import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        warm: {
          bg: '#faf8f4',
          surface: '#ffffff',
          'surface-2': '#f5f0ea',
          border: '#e5e0d8',
          'border-2': '#d4cec4',
          text: '#1a1a1a',
          'text-2': '#6b6560',
          'text-3': '#9a9590',
          accent: '#ff6b2b',
          'accent-hover': '#e85a1e',
          'accent-light': '#fff0e8',
          green: '#1a5c38',
          'green-light': '#e8f5ee',
          dark: '#1a1a1a',
          'dark-surface': '#222222',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        'pill': '50px',
        'xl': '20px',
        '2xl': '24px',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.03)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.04)',
        'button': '0 2px 8px rgba(255,107,43,0.25)',
        'button-hover': '0 4px 16px rgba(255,107,43,0.35)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'wiggle': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-3deg)' },
          '75%': { transform: 'rotate(3deg)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s ease-out forwards',
        'bounce-subtle': 'bounce-subtle 3s ease-in-out infinite',
        'wiggle': 'wiggle 0.5s ease-in-out',
      },
    },
  },
  plugins: [],
};

export default config;
