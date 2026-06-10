import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts — served from the hashed asset bundle instead of
// render-blocking Google Fonts requests (intranet deployments may not
// reach external CDNs at all).
import 'material-symbols/outlined.css'
import '@fontsource/space-grotesk/300.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import './index.css'
import './App.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// Surface unhandled promise rejections so they appear in monitoring
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
