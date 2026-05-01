import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/theme';
import { PortalLogo } from './PortalLogo';

interface IgniteHeaderProps {
  notesTaken?: number;
}

export const IgniteHeader: React.FC<IgniteHeaderProps> = ({
  notesTaken = 0,
}) => {
  const { theme, toggleTheme } = useTheme();

  const handleProfileClick = () => {};

  return (
    <header className="h-20 bg-sidebar-light dark:bg-sidebar-dark border-b border-slate-200 dark:border-white/5 flex items-center justify-between px-6 z-50 shrink-0 font-sans">
      <div className="flex items-center gap-12">
        <Link to="/ignite" className="flex items-center gap-3">
          <PortalLogo size={38} />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-none">MST AI — Learn</h1>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase tracking-wider">Internal Training Series</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6 pl-8 border-l border-slate-200 dark:border-white/5">
          <Link
            to="/"
            className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-primary transition-colors"
          >
            Solutions
          </Link>
          <Link
            to="/marketplace"
            className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-primary transition-colors"
          >
            Marketplace
          </Link>
          <Link
            to="/articles"
            className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-primary transition-colors"
          >
            Articles
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Notes counter hidden — feature disabled for now */}
        {false && <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5">
          <span className="material-symbols-outlined text-yellow-400 text-sm">edit_note</span>
          <span className="text-xs font-bold">{notesTaken} Notes taken</span>
        </div>}
        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-primary transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span className="material-symbols-outlined text-[20px]">
            {theme === 'dark' ? 'light_mode' : 'dark_mode'}
          </span>
        </button>
        <button
          onClick={handleProfileClick}
          className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-purple-500 flex items-center justify-center font-bold text-xs text-white border border-white/20"
        >
          JD
        </button>
      </div>
    </header>
  );
};
