import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  server: {
    proxy: {
      '/admin': 'http://localhost:8000',
      '/v1': 'http://localhost:8000',
    },
  },
})
