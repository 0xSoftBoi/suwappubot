import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Production API selection is intentionally NOT a Vite build-time concern.
  // The browser always uses same-origin paths; terminal nginx routes those paths
  // to api-ts over Railway private networking at runtime.
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['terminal.suwappu.bot', 'www.terminal.suwappu.bot'],
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
      '/v1': {
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
        // Keep only proven sink libraries in manual chunks. Secondary workspaces
        // are loaded with React.lazy; forcing every node_module into one `vendor`
        // chunk would pull their dependencies back onto the initial path. Let
        // Rollup place every other dependency according to the actual dynamic
        // import graph. This also avoids the old hand-split web3/query circular
        // chunks that caused a startup TDZ.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('lightweight-charts')) return 'charts'
          if (/[\\/]react(-dom)?[\\/]|[\\/]scheduler[\\/]/.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
  preview: {
    allowedHosts: ['terminal.suwappu.bot', 'www.terminal.suwappu.bot'],
  },
})
