import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        suwappu: {
          // Sakura spectrum
          'sakura-light': 'var(--suwappu-sakura-light, #ffd1dc)',
          'sakura-mid': 'var(--suwappu-sakura-mid, #ffb7c5)',
          'sakura-deep': '#f7a4b8',
          rose: 'var(--suwappu-rose, #f8a5c2)',
          'rose-muted': '#f0c4d4',

          // Magenta / accent
          magenta: 'var(--suwappu-magenta, #e91e8c)',
          'magenta-mid': 'var(--suwappu-magenta-mid, #c44569)',
          'magenta-light': '#f472b6',

          // Purple spectrum
          purple: 'var(--suwappu-purple, #6c3483)',
          'purple-deep': 'var(--suwappu-purple-deep, #4a235a)',
          'purple-light': '#9b59b6',
          'purple-muted': '#8e6ba5',

          // Backgrounds & surfaces
          bg: 'var(--suwappu-bg, #fffbfc)',
          cream: '#fff8f0',
          'cream-mid': '#fff0e5',
          blush: '#fff5f7',
          surface: '#fafafa',
          'surface-elevated': '#ffffff',

          // Dark tones
          ocean: '#0d1b4c',
          navy: '#1a237e',
          midnight: '#0f0a1a',

          // Dark mode surfaces
          'dark-bg': '#0a0a0f',
          'dark-surface': '#13131a',
          'dark-surface-elevated': '#1a1a24',
          'dark-border': 'rgba(255, 255, 255, 0.05)',
          'dark-border-hover': 'rgba(255, 255, 255, 0.1)',

          // Text
          text: 'var(--suwappu-text, #2c3e50)',
          'text-secondary': 'var(--suwappu-text-secondary, #6c7a89)',
          'text-muted': '#a0aab4',

          // Dark mode text
          'dark-text': '#f0f0f5',
          'dark-text-secondary': '#8a8a9a',
          'dark-text-muted': '#5a5a6a',

          // Functional
          cyan: '#b3e5fc',
          success: '#a8e6a3',
          'success-dark': '#66bb6a',
          warning: '#ffe4a0',
          error: '#ef5350',
        },
      },

      fontFamily: {
        heading: ['Quicksand', 'Nunito', 'Poppins', 'sans-serif'],
        body: ['Nunito', 'Open Sans', 'Lato', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      borderRadius: {
        'suwappu-pill': '50px',
        'suwappu-xl': '20px',
        'suwappu-2xl': '24px',
        'suwappu-3xl': '32px',
      },

      backdropBlur: {
        xs: '2px',
        'glass-sm': '8px',
        glass: '16px',
        'glass-lg': '24px',
        'glass-xl': '40px',
      },

      boxShadow: {
        'suwappu-button':
          '0 4px 15px rgba(196,69,105,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        'suwappu-button-hover':
          '0 8px 25px rgba(196,69,105,0.45), 0 0 20px rgba(255,183,197,0.3)',
        'suwappu-glow':
          '0 0 20px rgba(255,183,197,0.4), 0 0 40px rgba(196,69,105,0.2), 0 0 60px rgba(108,52,131,0.1)',
        'suwappu-glow-sm':
          '0 0 10px rgba(255,183,197,0.3), 0 0 20px rgba(196,69,105,0.15)',
        'suwappu-glow-lg':
          '0 0 30px rgba(255,183,197,0.5), 0 0 60px rgba(196,69,105,0.25), 0 0 100px rgba(108,52,131,0.15)',
        'suwappu-glow-magenta-light':
          '0 0 20px rgba(233,30,140,0.4), 0 0 40px rgba(233,30,140,0.2)',
        'suwappu-glow-purple-light':
          '0 0 20px rgba(108,52,131,0.3), 0 0 40px rgba(108,52,131,0.15)',
        'suwappu-card':
          '0 4px 20px rgba(108,52,131,0.08), 0 1px 3px rgba(0,0,0,0.04)',
        'suwappu-card-hover':
          '0 12px 40px rgba(108,52,131,0.12), 0 4px 12px rgba(0,0,0,0.06)',
        'suwappu-card-elevated':
          '0 20px 60px rgba(108,52,131,0.15), 0 8px 20px rgba(0,0,0,0.08)',
        'suwappu-card-dark':
          '0 2px 16px 0 rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
        'suwappu-card-dark-hover':
          '0 8px 32px 0 rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)',
        'suwappu-glow-magenta':
          '0 0 40px rgba(233,30,140,0.15)',
        'suwappu-glow-purple':
          '0 0 40px rgba(108,52,131,0.15)',
        'suwappu-glass-inner':
          'inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -1px 0 rgba(0,0,0,0.03)',
      },

      backgroundImage: {
        'suwappu-gradient':
          'linear-gradient(135deg, #ffb7c5, #c44569 35%, #6c3483 70%, #4a235a)',
        'suwappu-gradient-soft':
          'linear-gradient(135deg, #ffd1dc, #ffb7c5 40%, #f8a5c2)',
        'suwappu-gradient-vivid':
          'linear-gradient(135deg, #e91e8c, #c44569 50%, #6c3483)',
        'suwappu-gradient-dark':
          'linear-gradient(135deg, #e91e8c 20%, #6c3483 60%, #4a235a)',
        'suwappu-gradient-radial':
          'radial-gradient(ellipse at center, rgba(255,183,197,0.3), transparent 70%)',
        'suwappu-mesh':
          'radial-gradient(at 20% 20%, rgba(255,209,220,0.4) 0, transparent 50%), radial-gradient(at 80% 20%, rgba(108,52,131,0.15) 0, transparent 50%), radial-gradient(at 50% 80%, rgba(233,30,140,0.1) 0, transparent 50%)',
      },

      keyframes: {
        'scale-in': {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },

      animation: {
        'scale-in': 'scale-in 0.4s ease-out',
        'slide-up': 'slide-up 0.5s ease-out',
        'slide-down': 'slide-down 0.5s ease-out',
      },

      transitionTimingFunction: {
        'suwappu-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'suwappu-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'suwappu-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1)',
      },

      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
        '800': '800ms',
        '1200': '1200ms',
      },
    },
  },
  plugins: [],
};

export default config;
