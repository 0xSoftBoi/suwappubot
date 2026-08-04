import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Phase 1 dark / monochrome + single-accent system.
        canvas: {
          0: '#0A0B0D', // base
          1: '#111318', // raised surface
          2: '#1A1D23', // card
        },
        ink: {
          0: '#F5F6F7', // primary text
          1: '#8B92A0', // muted text
        },
        accent: {
          DEFAULT: '#E58D2B', // persimmon — the one accent
          hover: '#F2A04A',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      spacing: {
        // Real 8px-based scale.
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
        24: '96px',
        32: '128px',
      },
      borderRadius: {
        control: '6px',
        card: '10px',
        panel: '16px',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s ease-out forwards',
      },
    },
  },
  plugins: [],
};

export default config;
