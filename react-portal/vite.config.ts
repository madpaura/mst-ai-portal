import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

// Resolve the build's short git commit hash so it can be surfaced in the UI
// footer for traceability. Falls back to 'unknown' outside a git checkout.
function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __GIT_COMMIT_HASH__: JSON.stringify(gitShortHash()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  esbuild: {
    // Strip console.log/debug calls and debugger statements in production builds.
    // console.warn and console.error are preserved.
    drop: mode === 'production' ? ['debugger'] : [],
    pure: mode === 'production' ? ['console.log', 'console.debug'] : [],
  },
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
            // Heavy libraries get their own chunks so a page that needs one
            // of them doesn't drag the others in. Buckets follow actual usage:
            // charts/pdf-export → AdminAnalytics, zip → AdminArtifacts,
            // markdown + highlight → article/howto/detail pages.
            if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) {
              return 'charts';
            }
            if (id.includes('html2pdf') || id.includes('jspdf') || id.includes('html2canvas')) {
              return 'pdf-export';
            }
            if (id.includes('jszip')) {
              return 'zip';
            }
            if (id.includes('highlight.js') || id.includes('lowlight')) {
              return 'highlight';
            }
            if (
              id.includes('react-markdown') ||
              id.includes('/remark') ||
              id.includes('/rehype') ||
              id.includes('/mdast') ||
              id.includes('/hast') ||
              id.includes('/micromark') ||
              id.includes('/unified') ||
              id.includes('/unist') ||
              id.includes('/vfile') ||
              id.includes('parse5') ||
              id.includes('turndown')
            ) {
              return 'markdown';
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
}))
