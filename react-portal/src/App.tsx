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
import { AdminSolutions } from './pages/AdminSolutions';
import { AdminSettings } from './pages/AdminSettings';
import { AdminAnalytics } from './pages/AdminAnalytics';
import { SolutionDetail } from './pages/SolutionDetail';
import { News } from './pages/News';
import { NewsArticle } from './pages/NewsArticle';
import { MarketplaceHowTo } from './pages/MarketplaceHowTo';

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
          <Route path="/solutions/:cardId" element={<SolutionDetail />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:newsId" element={<NewsArticle />} />
          <Route path="/marketplace/:slug/howto" element={<MarketplaceHowTo />} />
          <Route path="/login" element={<Login />} />

          {/* Admin pages (protected by AdminLayout) */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/videos" replace />} />
            <Route path="videos" element={<AdminVideos />} />
            <Route path="marketplace" element={<AdminMarketplace />} />
            <Route path="solutions" element={<AdminSolutions />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
