import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['terminal.suwappu.bot'],
    proxy: {
      '/terminal': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/public': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/webapp': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Passkey/Turnkey auth is python too — without this, /auth/* 404s in local dev.
      '/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split heavy vendors into separately-cacheable chunks instead of one giant
        // bundle, so first paint isn't blocked on charts + the whole web3 stack.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('lightweight-charts')) return 'charts'
          if (/wagmi|@rainbow-me|viem|@walletconnect|@reown|@coinbase\/wallet/.test(id)) return 'web3'
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('gsap')) return 'anim'
          if (/[\\/]react(-dom)?[\\/]|[\\/]scheduler[\\/]/.test(id)) return 'react'
          return 'vendor'
        },
      },
    },
  },
  preview: {
    allowedHosts: ['terminal.suwappu.bot'],
  },
})
