import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './api/auth';
import { ThemeProvider } from './context/theme';
import { Solutions } from './pages/Solutions';
import { Marketplace } from './pages/Marketplace';
import { Ignite } from './pages/Ignite';
import { Howto } from './pages/Howto';
import { Login } from './pages/Login';
import { AdminLayout } from './components/AdminLayout';
import { AdminVideos } from './pages/AdminVideos';
import { AdminMarketplace } from './pages/AdminMarketplace';

function App() {
  return (
    <ThemeProvider>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public pages */}
          <Route path="/" element={<Solutions />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/ignite" element={<Ignite />} />
          <Route path="/howto" element={<Howto />} />
          <Route path="/login" element={<Login />} />

          {/* Admin pages (protected by AdminLayout) */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/videos" replace />} />
            <Route path="videos" element={<AdminVideos />} />
            <Route path="marketplace" element={<AdminMarketplace />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
