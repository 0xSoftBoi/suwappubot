import type { Config } from 'tailwindcss';
import { suwappuPreset } from '@suwappu/design-tokens/tailwind'

const config: Config = {
  presets: [suwappuPreset],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        suwappu: {
          // Keep showcase-specific colors not in shared tokens
          cream: '#fff8f0',
          'cream-mid': '#fff0e5',
          blush: '#fff5f7',
          surface: '#fafafa',
          'dark-bg': '#0a0a14',
          'dark-surface': '#12121e',
          'dark-surface-elevated': '#1a1a2e',
          'dark-text': '#e8e8f0',
          'dark-text-secondary': '#9a9ab0',
          'dark-text-muted': '#5a5a70',
        },
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'marquee-reverse': {
          '0%': { transform: 'translateX(-50%)' },
          '100%': { transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-8px) rotate(3deg)' },
        },
        'petal-fall': {
          '0%': { transform: 'translateY(-10vh) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(110vh) rotate(720deg)', opacity: '0' },
        },
      },
      animation: {
        marquee: 'marquee 30s linear infinite',
        'marquee-reverse': 'marquee-reverse 30s linear infinite',
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float-slow 8s ease-in-out infinite',
        'petal-fall': 'petal-fall 12s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
