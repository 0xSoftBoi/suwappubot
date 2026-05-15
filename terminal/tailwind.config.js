import { designTokens } from '@suwappu/design-tokens'
import { professionalPreset } from '@suwappu/design-tokens/tailwind'

const summer = designTokens.colors.surface.summerBreeze
const radii = designTokens.borderRadius

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
          bg: summer.canvasCool,
          'bg-secondary': summer.controlCool,
          'bg-tertiary': summer.insetCool,
          panel: summer.panelCool,
          border: summer.border,
          'border-active': summer.borderActive,
          text: summer.ink,
          'text-secondary': summer.muted,
          'text-muted': '#7899a8',
        },
        sakura: {
          50: '#effcff',
          100: '#dff7ff',
          200: '#bcefff',
          300: '#86ddf6',
          400: summer.accentLight,
          500: summer.accent,
          600: summer.accentDeep,
          700: summer.accentDeepHover,
          800: '#075985',
          900: '#0c4a6e',
        },
      },
      borderRadius: {
        'suwappu-md': `${radii.sm}px`,
        'suwappu-lg': `${radii.md}px`,
        'suwappu-xl': `${radii.lg}px`,
        'suwappu-xxl': `${radii.xl}px`,
        'suwappu-xxxl': `${radii.xxl}px`,
        'suwappu-pill': `${radii.md}px`,
      },
    },
  },
  plugins: [],
}
