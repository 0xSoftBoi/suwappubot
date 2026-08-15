import { professionalPreset } from '@suwappu/design-tokens/tailwind'
import { designTokens } from '@suwappu/design-tokens'

const radii = designTokens.borderRadius

/**
 * Every terminal/sakura/bull/bear colour resolves through a per-theme CSS
 * variable channel triplet (`--terminal-c-*`, e.g. "8 9 12") defined in
 * `src/theme/TerminalThemeScope.tsx` and defaulted (institutional / dark) in
 * `src/index.css`. The `rgb(... / <alpha-value>)` form keeps Tailwind opacity
 * modifiers working — the codebase relies on them heavily
 * (`bg-terminal-bg-tertiary/50`, `border-terminal-border/50`,
 * `bg-sakura-500/10`, `bg-bull/15`, `ring-sakura-500/40`, …).
 */
const channel = (name) => `rgb(var(--terminal-c-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  presets: [professionalPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        terminal: {
          // Canvas ladder
          canvas: channel('canvas'),
          bg: channel('bg'),
          'bg-secondary': channel('bg-secondary'),
          'bg-tertiary': channel('bg-tertiary'),
          panel: channel('panel'),
          // Structure
          border: channel('border'),
          'border-active': channel('border-active'),
          hairline: 'rgb(var(--terminal-c-text) / 0.07)',
          'hairline-strong': 'rgb(var(--terminal-c-text) / 0.13)',
          // Ink
          text: channel('text'),
          'text-secondary': channel('text-secondary'),
          'text-muted': channel('text-muted'),
          // Accent (persimmon — the only interactive accent)
          accent: channel('accent'),
          'accent-bright': channel('accent-bright'),
          'accent-deep': channel('accent-deep'),
          'on-accent': channel('on-accent'),
          // Semantic (PnL / direction only)
          up: channel('up'),
          down: channel('down'),
          warn: channel('warn'),
        },
        // Legacy alias scale — repointed from sky blue to the persimmon family.
        // 50-300 are warm washes (near-black in the institutional register),
        // 400-700 the persimmon accents, 800-900 deep persimmon.
        sakura: {
          50: channel('sakura-50'),
          100: channel('sakura-100'),
          200: channel('sakura-200'),
          300: channel('sakura-300'),
          400: channel('sakura-400'),
          500: channel('sakura-500'),
          600: channel('sakura-600'),
          700: channel('sakura-700'),
          800: channel('sakura-800'),
          900: channel('sakura-900'),
        },
        // PnL / direction — same source of truth as terminal.up / terminal.down
        bull: channel('up'),
        bear: channel('down'),
        'bull-dim': channel('up-dim'),
        'bear-dim': channel('down-dim'),
      },
      fontFamily: {
        // Overrides the preset's Inter stack — Geist is the terminal UI face.
        sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'monospace'],
        japanese: ['Noto Sans JP', 'Geist', 'sans-serif'],
      },
      borderRadius: {
        'suwappu-md': `${radii.sm}px`,
        'suwappu-lg': `${radii.md}px`,
        'suwappu-xl': `${radii.lg}px`,
        'suwappu-xxl': `${radii.xl}px`,
        'suwappu-xxxl': `${radii.xxl}px`,
        'suwappu-pill': `${radii.md}px`,
        // Theme-aware radii (prefer these over hardcoded rounded-* values)
        'terminal-panel': 'var(--terminal-radius-panel)',
        'terminal-inset': 'var(--terminal-radius-inset)',
        'terminal-card': 'var(--terminal-radius-card)',
        'terminal-control': 'var(--terminal-radius-control)',
        'terminal-pill': 'var(--terminal-radius-pill)',
      },
      boxShadow: {
        // Institutional register: panels are hairline-only. The single real
        // shadow is for overlays (modals, command palette, dropdowns).
        'terminal-overlay': 'var(--terminal-shadow-overlay)',
        'terminal-hairline': '0 0 0 1px var(--terminal-hairline)',
        'terminal-hairline-strong': '0 0 0 1px var(--terminal-hairline-strong)',
      },
      animation: {
        // The preset ships the `shimmer` keyframes but no animation binding.
        shimmer: 'shimmer 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
