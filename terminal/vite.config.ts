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
        // Only split true "sink" libraries — ones that import nothing from other
        // chunks — into separate cacheable bundles. The web3/query/anim stacks
        // cross-import vendor deps (and vice-versa), so giving them their own
        // chunks created a circular chunk (vendor <-> web3) that crashed startup
        // with a TDZ ("Cannot access … before initialization"). Keeping them in
        // the single `vendor` chunk eliminates the cycle. react + charts are
        // leaves, so they stay split safely.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('lightweight-charts')) return 'charts'
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
