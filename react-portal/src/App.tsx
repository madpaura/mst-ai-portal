import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

const BETA_TAG = import.meta.env.VITE_BETA_TAG as string | undefined;
const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || 'open';
import { AuthProvider, useAuth } from './api/auth';
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
import { AdminDigest } from './pages/AdminDigest';
import { SolutionDetail } from './pages/SolutionDetail';
import { News } from './pages/News';
import { NewsArticle } from './pages/NewsArticle';
import { MarketplaceHowTo } from './pages/MarketplaceHowTo';
import { Articles } from './pages/Articles';
import { ArticleDetail } from './pages/ArticleDetail';
import { ArticleEditor } from './pages/ArticleEditor';
import { AdminArticles } from './pages/AdminArticles';
import { Memes } from './pages/Memes';
import { AdminMemes } from './pages/AdminMemes';
import { ContributeRequest } from './pages/ContributeRequest';
import { AdminContributions } from './pages/AdminContributions';
import { AdminAuditLog } from './pages/AdminAuditLog';
import { Contact } from './pages/Contact';
import { AdminContacts } from './pages/AdminContacts';
import { AdminArtifacts } from './pages/AdminArtifacts';
import { Search } from './pages/Search';

function SamlGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (AUTH_MODE === 'saml' && !loading && !user && location.pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  useEffect(() => {
    if (BETA_TAG) document.title = `MST AI Portal [${BETA_TAG.toUpperCase()}]`;
  }, []);

  return (
    <ThemeProvider>
    <BrowserRouter>
      <AuthProvider>
        <SamlGuard>
        <Routes>
          {/* Public pages */}
          <Route path="/" element={<Solutions />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/ignite" element={<Ignite />} />
          <Route path="/ignite/:videoSlug" element={<Ignite />} />
          <Route path="/howto" element={<Howto />} />
          <Route path="/solutions/:cardId" element={<SolutionDetail />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:newsId" element={<NewsArticle />} />
          <Route path="/marketplace/:slug/howto" element={<MarketplaceHowTo />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/new" element={<ArticleEditor />} />
          <Route path="/articles/edit/:articleId" element={<ArticleEditor />} />
          <Route path="/articles/:articleSlug" element={<ArticleDetail />} />
          <Route path="/memes" element={<Memes />} />
          <Route path="/login" element={<Login />} />
          <Route path="/contribute" element={<ContributeRequest />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/search" element={<Search />} />

          {/* Admin pages (protected by AdminLayout) */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/videos" replace />} />
            <Route path="videos" element={<AdminVideos />} />
            <Route path="marketplace" element={<AdminMarketplace />} />
            <Route path="solutions" element={<AdminSolutions />} />
            <Route path="articles" element={<AdminArticles />} />
            <Route path="digest" element={<AdminDigest />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="contributions" element={<AdminContributions />} />
            <Route path="audit-log" element={<AdminAuditLog />} />
            <Route path="contacts" element={<AdminContacts />} />
            <Route path="memes" element={<AdminMemes />} />
            <Route path="artifacts" element={<AdminArtifacts />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </SamlGuard>
      </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
