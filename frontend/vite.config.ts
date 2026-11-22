import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em desenvolvimento (npm run dev) o Vite roda em http://localhost:5173 e repassa /api
// para o back-end em 127.0.0.1:8765. Em uso normal, o back-end serve a pasta dist/.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8765', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
