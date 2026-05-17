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
            // Keep react, react-dom, react-router AND scheduler in one chunk.
            // Splitting scheduler from react-dom causes "Cannot set properties of
            // undefined (setting 'unstable_now')" because react-dom writes to the
            // scheduler module object at startup — they must share the same scope.
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router') ||
              id.includes('/scheduler/')
            ) {
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
