import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/theme';

interface IgniteHeaderProps {
  completedVideos?: number;
  totalVideos?: number;
  notesTaken?: number;
}

export const IgniteHeader: React.FC<IgniteHeaderProps> = ({
  completedVideos = 0,
  totalVideos = 6,
  notesTaken = 0,
}) => {
  const progressPercent = totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0;
  const { theme, toggleTheme } = useTheme();

  const handleProfileClick = () => {};

  return (
    <header className="h-20 bg-sidebar-light dark:bg-sidebar-dark border-b border-slate-200 dark:border-white/5 flex items-center justify-between px-6 z-50 shrink-0 font-sans">
      <div className="flex items-center gap-12">
        <Link to="/ignite" className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 shadow-lg shadow-primary/20">
            <span className="material-symbols-outlined text-white text-2xl">school</span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-none">Learn</h1>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase tracking-wider">Internal Training Series</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-4 pl-8 border-l border-slate-200 dark:border-white/5">
          <div className="flex flex-col gap-1 w-48">
            <div className="flex justify-between text-[10px] uppercase font-bold text-slate-400">
              <span>Overall Progress</span>
              <span className="text-slate-900 dark:text-white">{progressPercent}% ({completedVideos}/{totalVideos} Videos)</span>
            </div>
            <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.max(progressPercent, 5)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-2">
          {[
            { label: 'Code-mate', done: 0, total: 3 },
            { label: 'RAG', done: 0, total: 1 },
            { label: 'Agents', done: 0, total: 1 },
            { label: 'Deep Dive', done: 0, total: 1 },
          ].map((cat) => (
            <div key={cat.label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-white/5">
              <span className="flex items-center justify-center w-5 h-5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-bold">
                {cat.done}/{cat.total}
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-300">{cat.label}</span>
            </div>
          ))}
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
