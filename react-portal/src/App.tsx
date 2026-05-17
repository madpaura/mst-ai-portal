import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

const BETA_TAG = import.meta.env.VITE_BETA_TAG as string | undefined;
const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || 'open';
import { AuthProvider, useAuth } from './api/auth';
import { ThemeProvider } from './context/theme';
import { AdminLayout } from './components/AdminLayout';

const Solutions        = React.lazy(() => import('./pages/Solutions').then(m => ({ default: m.Solutions })));
const Marketplace      = React.lazy(() => import('./pages/Marketplace').then(m => ({ default: m.Marketplace })));
const Ignite           = React.lazy(() => import('./pages/Ignite').then(m => ({ default: m.Ignite })));
const Howto            = React.lazy(() => import('./pages/Howto').then(m => ({ default: m.Howto })));
const Login            = React.lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const AdminVideos      = React.lazy(() => import('./pages/AdminVideos').then(m => ({ default: m.AdminVideos })));
const AdminMarketplace = React.lazy(() => import('./pages/AdminMarketplace').then(m => ({ default: m.AdminMarketplace })));
const AdminSolutions   = React.lazy(() => import('./pages/AdminSolutions').then(m => ({ default: m.AdminSolutions })));
const AdminSettings    = React.lazy(() => import('./pages/AdminSettings').then(m => ({ default: m.AdminSettings })));
const AdminAnalytics   = React.lazy(() => import('./pages/AdminAnalytics').then(m => ({ default: m.AdminAnalytics })));
const AdminDigest      = React.lazy(() => import('./pages/AdminDigest').then(m => ({ default: m.AdminDigest })));
const SolutionDetail   = React.lazy(() => import('./pages/SolutionDetail').then(m => ({ default: m.SolutionDetail })));
const News             = React.lazy(() => import('./pages/News').then(m => ({ default: m.News })));
const NewsArticle      = React.lazy(() => import('./pages/NewsArticle').then(m => ({ default: m.NewsArticle })));
const MarketplaceHowTo = React.lazy(() => import('./pages/MarketplaceHowTo').then(m => ({ default: m.MarketplaceHowTo })));
const Articles         = React.lazy(() => import('./pages/Articles').then(m => ({ default: m.Articles })));
const ArticleDetail    = React.lazy(() => import('./pages/ArticleDetail').then(m => ({ default: m.ArticleDetail })));
const ArticleEditor    = React.lazy(() => import('./pages/ArticleEditor').then(m => ({ default: m.ArticleEditor })));
const AdminArticles    = React.lazy(() => import('./pages/AdminArticles').then(m => ({ default: m.AdminArticles })));
const Memes            = React.lazy(() => import('./pages/Memes').then(m => ({ default: m.Memes })));
const AdminMemes       = React.lazy(() => import('./pages/AdminMemes').then(m => ({ default: m.AdminMemes })));
const ContributeRequest  = React.lazy(() => import('./pages/ContributeRequest').then(m => ({ default: m.ContributeRequest })));
const AdminContributions = React.lazy(() => import('./pages/AdminContributions').then(m => ({ default: m.AdminContributions })));
const AdminAuditLog    = React.lazy(() => import('./pages/AdminAuditLog').then(m => ({ default: m.AdminAuditLog })));
const Contact          = React.lazy(() => import('./pages/Contact').then(m => ({ default: m.Contact })));
const AdminContacts    = React.lazy(() => import('./pages/AdminContacts').then(m => ({ default: m.AdminContacts })));
const AdminHtmlMailer  = React.lazy(() => import('./pages/AdminHtmlMailer').then(m => ({ default: m.AdminHtmlMailer })));
const Search           = React.lazy(() => import('./pages/Search').then(m => ({ default: m.Search })));

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
        <Suspense fallback={null}>
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
            <Route path="artifacts" element={<Navigate to="/admin/marketplace" replace />} />
            <Route path="html-mailer" element={<AdminHtmlMailer />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </SamlGuard>
      </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
