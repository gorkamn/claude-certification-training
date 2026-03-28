import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  // In dev mode, proxy /api to the Lambda Function URL
  // Set VITE_API_URL in .env.local for local dev
  server: {
    port: 5173,
  },
})
