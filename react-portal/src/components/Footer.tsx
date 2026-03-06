import React from 'react';

export const Footer: React.FC = () => {
  const handleFooterLink = (label: string) => {
    console.log(`[Footer] Clicked: ${label}`);
    alert(`${label} — coming soon!`);
  };

  return (
    <footer className="border-t border-slate-200 dark:border-primary/10 py-12 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-3 opacity-50">
          <span className="material-symbols-outlined text-xl">memory</span>
          <span className="text-sm font-bold tracking-tight">MST AI Suite</span>
        </div>
        <div className="flex gap-8 text-xs font-semibold text-slate-500 uppercase tracking-widest">
          <button onClick={() => handleFooterLink('System Status')} className="hover:text-primary transition-colors">
            System Status
          </button>
          <button onClick={() => handleFooterLink('Privacy Policy')} className="hover:text-primary transition-colors">
            Privacy Policy
          </button>
          <button onClick={() => handleFooterLink('Internal Support')} className="hover:text-primary transition-colors">
            Internal Support
          </button>
        </div>
        <p className="text-slate-500 dark:text-slate-600 text-xs">
          &copy; 2024 MST Corp. Internal Use Only.
        </p>
      </div>
    </footer>
  );
};
