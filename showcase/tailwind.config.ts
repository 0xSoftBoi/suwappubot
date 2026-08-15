import type { Config } from 'tailwindcss';
import { warmPreset } from '@suwappu/design-tokens';

const config: Config = {
  presets: [warmPreset],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // Colours come from @suwappu/design-tokens now. They were defined inline
      // here, which made the public marketing site the only surface not
      // consuming the token package — and left the repo with two live design
      // systems that disagreed. Same values, one definition.
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
        'button': '0 2px 8px rgba(244,114,182,0.25)',
        'button-hover': '0 4px 16px rgba(244,114,182,0.35)',
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
