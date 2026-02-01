import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        suwappu: {
          'sakura-light': '#FFD1DC',
          'sakura-mid': '#FFB7C5',
          'magenta': '#E91E8C',
          'rose': '#F8A5C2',
          'magenta-mid': '#C44569',
          'purple': '#6C3483',
          'purple-deep': '#4A235A',
          'sky': '#E8F4FD',
          'cyan': '#B3E5FC',
          'blue': '#87CEEB',
          'navy': '#1A237E',
          'ocean': '#0D1B4C',
          'success': '#A8E6A3',
          'warning': '#FFE4A0',
          'error': '#F8A0A0',
          'info': '#90CAF9',
          'bg': '#FFFBFC',
          'text': '#2C3E50',
          'text-secondary': '#6C7A89',
        },
        dark: {
          bg: '#1A1625',
          surface: '#2D2640',
          text: '#F8F4FB',
          border: '#3D3450',
        },
      },
      fontFamily: {
        heading: ['Quicksand', 'Nunito', 'Poppins', 'sans-serif'],
        body: ['Nunito', 'Open Sans', 'Lato', 'sans-serif'],
      },
      borderRadius: {
        'suwappu-md': '12px',
        'suwappu-lg': '16px',
        'suwappu-xl': '20px',
        'suwappu-pill': '50px',
      },
      boxShadow: {
        'suwappu-1': '0 1px 3px rgba(106,27,154,0.06), 0 1px 2px rgba(255,183,197,0.08)',
        'suwappu-2': '0 4px 6px rgba(106,27,154,0.08), 0 2px 4px rgba(255,183,197,0.1), 0 0 0 1px rgba(255,183,197,0.05)',
        'suwappu-3': '0 10px 25px rgba(106,27,154,0.12), 0 6px 10px rgba(255,183,197,0.15), 0 0 40px rgba(255,209,220,0.1)',
        'suwappu-4': '0 15px 35px rgba(106,27,154,0.15), 0 10px 20px rgba(196,69,105,0.1), 0 0 60px rgba(255,183,197,0.15)',
      },
      backgroundImage: {
        'suwappu-gradient': 'linear-gradient(135deg, #FFB7C5 0%, #C44569 35%, #6C3483 70%, #4A235A 100%)',
        'suwappu-glass': 'linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,215,220,0.4) 50%, rgba(232,244,253,0.6) 100%)',
      },
    },
  },
  plugins: [],
} satisfies Config
