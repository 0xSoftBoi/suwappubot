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
    extend: {},
  },
  plugins: [],
}
