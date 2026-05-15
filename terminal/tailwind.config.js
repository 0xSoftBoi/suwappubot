import { professionalPreset } from '@suwappu/design-tokens/tailwind'

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
          bg: '#edfaff',
          'bg-secondary': '#f3fcff',
          'bg-tertiary': '#dff5fb',
          panel: '#f8fdff',
          border: '#b9dfe9',
          'border-active': '#42b8d7',
          text: '#12384f',
          'text-secondary': '#426a7c',
          'text-muted': '#7899a8',
        },
        sakura: {
          50: '#effcff',
          100: '#dff7ff',
          200: '#bcefff',
          300: '#86ddf6',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
      borderRadius: {
        'suwappu-md': '10px',
        'suwappu-lg': '14px',
        'suwappu-xl': '16px',
        'suwappu-xxl': '18px',
        'suwappu-xxxl': '22px',
        'suwappu-pill': '18px',
      },
    },
  },
  plugins: [],
}
