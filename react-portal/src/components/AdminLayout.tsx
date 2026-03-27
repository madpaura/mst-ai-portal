import React from 'react';
import { Link, useLocation, Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../api/auth';

export const AdminLayout: React.FC = () => {
  const { user, isAdmin, loading, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="dark min-h-screen bg-background-dark flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/login" replace />;
  }

  const navItems = [
    { path: '/admin/videos', label: 'Videos', icon: 'videocam' },
    { path: '/admin/marketplace', label: 'Marketplace', icon: 'storefront' },
    { path: '/admin/articles', label: 'Articles', icon: 'article' },
    { path: '/admin/solutions', label: 'Solutions', icon: 'dashboard' },
    { path: '/admin/analytics', label: 'Analytics', icon: 'analytics' },
    { path: '/admin/settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <div className="dark min-h-screen bg-background-dark text-slate-100 flex flex-col">
      {/* Admin Header */}
      <header className="h-16 bg-sidebar-dark border-b border-white/10 flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-lg">smart_toy</span>
            </div>
            <span className="text-white font-bold text-sm">MST AI Admin</span>
          </Link>

          <div className="h-6 w-px bg-white/10" />

          <span className="text-xs font-bold uppercase tracking-widest text-primary/70">Admin</span>

          <nav className="flex items-center gap-1 ml-4">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${location.pathname.startsWith(item.path)
                  ? 'bg-primary/10 text-white border border-primary/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
              >
                <span className="material-symbols-outlined text-base">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Back to Portal
          </Link>
          <div className="h-6 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary text-xs font-bold">
              {user.initials || user.display_name.charAt(0)}
            </div>
            <span className="text-sm text-slate-300">{user.display_name}</span>
          </div>
          <button
            onClick={logout}
            className="text-xs text-slate-500 hover:text-red-400 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
};
