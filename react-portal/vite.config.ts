import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '..'),
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor';
            }
            if (id.includes('hls.js')) {
              return 'hls';
            }
            if (id.includes('dompurify')) {
              return 'dompurify';
            }
            return 'vendor';
          }
          if (id.includes('/pages/Admin')) {
            return 'admin';
          }
        },
      },
    },
  },
})
