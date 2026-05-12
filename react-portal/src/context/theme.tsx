import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
export type PortalTheme = 'default' | 'simple';

const API_BASE = (import.meta.env.VITE_API_URL as string) || '';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  portalTheme: PortalTheme;
  applyPortalTheme: (t: PortalTheme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
  portalTheme: 'default',
  applyPortalTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('mst_theme') as Theme | null;
    return saved || 'light';
  });
  const [portalTheme, setPortalTheme] = useState<PortalTheme>('default');

  const applyPortalTheme = (pt: PortalTheme) => {
    setPortalTheme(pt);
    const root = document.documentElement;
    if (pt === 'simple') {
      root.classList.add('theme-simple');
    } else {
      root.classList.remove('theme-simple');
    }
  };

  // Fetch portal theme from backend on mount
  useEffect(() => {
    fetch(`${API_BASE}/settings/portal_theme`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((val: string | null) => {
        if (val === 'simple') applyPortalTheme('simple');
      })
      .catch(() => {});
  }, []);

  // Apply dark/light class
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('mst_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, portalTheme, applyPortalTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
