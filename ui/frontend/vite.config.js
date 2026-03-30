import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  // Set VITE_SINGLE_AGENT_API_URL / VITE_MULTI_AGENT_API_URL in .env.local for local dev
  server: {
    port: 5173,
  },
})
