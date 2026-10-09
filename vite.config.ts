import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      // Forward all backend routes to FastAPI
      '/session': { target: 'http://localhost:8000', changeOrigin: true },
      '/resume':  { target: 'http://localhost:8000', changeOrigin: true },
      '/job':     { target: 'http://localhost:8000', changeOrigin: true },
      '/interview':{ target: 'http://localhost:8000', changeOrigin: true },
      '/ws':      { target: 'ws://localhost:8000',   changeOrigin: true, ws: true },
      '/health':  { target: 'http://localhost:8000', changeOrigin: true },
    }
  }
})
