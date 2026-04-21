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
