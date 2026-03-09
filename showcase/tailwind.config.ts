import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        suwappu: {
          'sakura-light': '#ffd1dc',
          'sakura-mid': '#ffb7c5',
          rose: '#f8a5c2',
          magenta: '#e91e8c',
          'magenta-mid': '#c44569',
          purple: '#6c3483',
          'purple-deep': '#4a235a',
          bg: '#fffbfc',
          cream: '#fff8f0',
          'cream-mid': '#fff0e5',
          blush: '#fff5f7',
          surface: '#fafafa',
          ocean: '#0d1b4c',
          navy: '#1a237e',
          text: '#2c3e50',
          'text-secondary': '#6c7a89',
          cyan: '#b3e5fc',
          success: '#a8e6a3',
          warning: '#ffe4a0',
          'dark-bg': '#0a0a14',
          'dark-surface': '#12121e',
          'dark-surface-elevated': '#1a1a2e',
          'dark-text': '#e8e8f0',
          'dark-text-secondary': '#9a9ab0',
          'dark-text-muted': '#5a5a70',
        },
      },
      fontFamily: {
        serif: ['"DM Serif Display"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        heading: ['"DM Serif Display"', 'Georgia', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        'suwappu-pill': '50px',
        'suwappu-xl': '20px',
      },
      boxShadow: {
        'suwappu-button':
          '0 4px 15px rgba(196,69,105,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        'suwappu-button-hover':
          '0 8px 25px rgba(196,69,105,0.45), 0 0 20px rgba(255,183,197,0.3)',
        'suwappu-glow':
          '0 0 20px rgba(255,183,197,0.4), 0 0 40px rgba(196,69,105,0.2), 0 0 60px rgba(108,52,131,0.1)',
        'suwappu-card':
          '0 4px 20px rgba(108,52,131,0.08), 0 1px 3px rgba(0,0,0,0.04)',
        'suwappu-card-hover':
          '0 12px 40px rgba(108,52,131,0.12), 0 4px 12px rgba(0,0,0,0.06)',
        'suwappu-glow-magenta':
          '0 0 20px rgba(233,30,140,0.2), 0 0 40px rgba(233,30,140,0.1)',
        'suwappu-card-dark':
          '0 4px 20px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.2)',
        'suwappu-card-dark-hover':
          '0 12px 40px rgba(0,0,0,0.4), 0 4px 12px rgba(233,30,140,0.1)',
      },
      backgroundImage: {
        'suwappu-gradient':
          'linear-gradient(135deg, #ffb7c5, #c44569 35%, #6c3483 70%, #4a235a)',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
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
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.6s ease-out forwards',
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float-slow 8s ease-in-out infinite',
        'petal-fall': 'petal-fall 12s linear infinite',
        shimmer: 'shimmer 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
