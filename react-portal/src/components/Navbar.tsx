import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { useTheme } from '../context/theme';

interface NavbarProps {
  variant?: 'solutions' | 'marketplace' | 'ignite';
}

export const Navbar: React.FC<NavbarProps> = ({ variant = 'solutions' }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const handleSignIn = () => navigate('/login');
  const handleAdmin = () => navigate('/admin/videos');
  const handleLogout = () => { logout(); navigate('/'); };

  const isActive = (path: string) => location.pathname === path;

  if (variant === 'solutions') {
    return (
      <nav className="fixed top-0 w-full z-50 border-b border-slate-200 dark:border-primary/10 bg-white/80 dark:bg-background-dark/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-primary">
              <span className="material-symbols-outlined text-3xl font-bold">memory</span>
            </div>
            <Link to="/" className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">MST AI Portal</Link>
          </div>
          <div className="hidden md:flex items-center gap-10">
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/') ? 'text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-primary'}`}
              to="/"
            >
              Solutions
            </Link>
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/marketplace') ? 'text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-primary'}`}
              to="/marketplace"
            >
              Marketplace
            </Link>
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/news') ? 'text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-primary'}`}
              to="/news"
            >
              News
            </Link>
            <Link
              className={`text-sm font-medium transition-colors ${isActive('/ignite') ? 'text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-primary'}`}
              to="/ignite"
            >
              Learn
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-primary transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="material-symbols-outlined text-[20px]">
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
            {user ? (
              <>
                {isAdmin && (
                  <button
                    onClick={handleAdmin}
                    className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-5 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(37,140,244,0.3)]"
                  >
                    Admin Panel
                  </button>
                )}
                <span className="text-sm text-slate-600 dark:text-slate-300">{user.display_name}</span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-slate-500 dark:text-slate-400 hover:text-red-400 transition-colors"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button
                onClick={handleSignIn}
                className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-5 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(37,140,244,0.3)]"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </nav>
    );
  }

  return null;
};
