import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { useTheme } from '../context/theme';
import { PortalLogo } from './PortalLogo';
import { SearchBar } from './SearchBar';
import { useVisibleCatalogTypes } from '../hooks/useCatalogTypes';
const BETA_TAG = import.meta.env.VITE_BETA_TAG as string | undefined;

interface NavbarProps {
  variant?: 'solutions' | 'marketplace' | 'ignite';
}

export const Navbar: React.FC<NavbarProps> = ({ variant = 'solutions' }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const discoverRef = useRef<HTMLDivElement>(null);
  const [logoAnim, setLogoAnim] = useState(false);
  const [showVmg, setShowVmg] = useState(false);

  const handleLogoClick = () => {
    // Let the <Link to="/"> navigate home; just play the spin/VMG easter-egg
    // animation alongside it (skip re-triggering while one is already running).
    if (logoAnim) return;
    setLogoAnim(true);
    setShowVmg(false);
    setTimeout(() => setShowVmg(true), 400);
    setTimeout(() => setShowVmg(false), 900);
    setTimeout(() => setLogoAnim(false), 1100);
  };

  const handleAdmin = () => navigate('/admin/videos');

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');
  const isDiscoverActive = location.pathname.startsWith('/memes') || location.pathname.startsWith('/news');
  // The catalog (Agents / Skills / MCP) shares one page, filtered by ?type=.
  // Sections under construction are dropped from the nav.
  const catalogTypes = useVisibleCatalogTypes();
  const catalogType = new URLSearchParams(location.search).get('type') || '';
  const isCatalog = (type: string) => location.pathname.startsWith('/marketplace') && catalogType === type;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (discoverRef.current && !discoverRef.current.contains(e.target as Node)) {
        setDiscoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <style>{`
        @keyframes logoSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes logoGlow { 0%,100%{filter:none} 50%{filter:drop-shadow(0 0 8px #258CF4) drop-shadow(0 0 18px #258CF466)} }
        @keyframes vmgPop  { 0%{opacity:0;transform:scale(0.7)} 60%{opacity:1;transform:scale(1.1)} 100%{opacity:1;transform:scale(1)} }
        .logo-spin { animation: logoSpin 0.5s ease-in-out, logoGlow 0.5s ease-in-out; }
        .vmg-pop   { animation: vmgPop 0.18s ease forwards; }
      `}</style>
      {variant === 'solutions' && (
      <nav className="fixed top-0 w-full z-50 border-b border-slate-200 dark:border-primary/10 bg-white/80 dark:bg-background-dark/80 backdrop-blur-md font-sans">
        <div className="max-w-screen-2xl mx-auto w-full px-6 h-16 flex items-center gap-4">
          <div className="flex items-center gap-3 flex-none">
            <Link to="/" className="flex items-center gap-2.5" onClick={handleLogoClick}>
              <span className={logoAnim ? 'logo-spin' : ''} style={{display:'inline-flex'}}>
                <PortalLogo size={34} />
              </span>
              <span className="text-xl font-bold tracking-tight w-[4rem] inline-block">
                {showVmg
                  ? <span className="vmg-pop text-[#258CF4]">VMG</span>
                  : <span className="text-text-strong">MST AI</span>
                }
              </span>
            </Link>
            {BETA_TAG && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-400/15 text-amber-500 border border-amber-400/30">
                {BETA_TAG}
              </span>
            )}
          </div>
          <div className="hidden md:flex flex-1 items-center justify-center gap-6">
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/') ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
              to="/"
            >
              Solutions
            </Link>
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/ignite') ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
              to="/ignite"
            >
              Learn
            </Link>
            {catalogTypes.map(t => (
              <Link
                key={t.key}
                className={`text-sm font-medium transition-colors ${isCatalog(t.key) ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
                to={`/marketplace?type=${t.key}`}
              >
                {t.label}
              </Link>
            ))}
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/articles') ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
              to="/articles"
            >
              Articles
            </Link>
            <div className="relative" ref={discoverRef}>
              <button
                onClick={() => setDiscoverOpen((o) => !o)}
                className={`flex items-center gap-1 text-sm font-medium transition-colors ${isDiscoverActive ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
              >
                Discover
                <span className="material-symbols-outlined text-[16px]">{discoverOpen ? 'expand_less' : 'expand_more'}</span>
              </button>
              {discoverOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-40 bg-white dark:bg-slate-900 border border-border-base rounded-xl shadow-lg py-1 z-50">
                  <Link to="/memes" onClick={() => setDiscoverOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-primary hover:bg-surface-muted transition-colors">
                    <span className="material-symbols-outlined text-[16px]">collections</span>Memes
                  </Link>
                  <Link to="/news" onClick={() => setDiscoverOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-primary hover:bg-surface-muted transition-colors">
                    <span className="material-symbols-outlined text-[16px]">newspaper</span>News
                  </Link>
                </div>
              )}
            </div>
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/contact') ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
              to="/contact"
            >
              Contact
            </Link>
          </div>
          <div className="flex items-center gap-3 flex-none">
          <SearchBar />
            <button
              onClick={toggleTheme}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-border-base bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-primary transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="material-symbols-outlined text-[20px]">
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
            {user && (
              <>
                {user.role === 'user' && (
                  <Link
                    to="/contribute"
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 text-sm font-medium transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">volunteer_activism</span>
                    Contribute
                  </Link>
                )}
                {(isAdmin || user?.role === 'content') && (
                  <button
                    onClick={handleAdmin}
                    className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-5 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(37,140,244,0.3)]"
                  >
                    {isAdmin ? 'Admin Panel' : 'Creator Panel'}
                  </button>
                )}
                <div className="relative group">
                  <span className="text-sm text-slate-600 dark:text-slate-300 cursor-default select-none">
                    {user.display_name}
                  </span>
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-slate-800 border border-border-base rounded-xl shadow-xl p-4 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50 pointer-events-none">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{user.display_name}</p>
                    {user.dept_name_en && (
                      <p className="text-xs text-primary mt-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">corporate_fare</span>
                        {user.dept_name_en}
                      </p>
                    )}
                    {user.email && (
                      <p className="text-xs text-text-muted mt-1 flex items-center gap-1 truncate">
                        <span className="material-symbols-outlined text-[14px]">mail</span>
                        {user.email}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>
      )}
    </>
  );
};
