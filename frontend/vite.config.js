import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// In development the Vite server proxies /api to the Flask backend, so the browser
// only ever talks to one origin (no CORS surprises, same URLs as production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:5000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
})
