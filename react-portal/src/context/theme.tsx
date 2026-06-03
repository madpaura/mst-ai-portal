import React, { createContext, useContext, useEffect, useState } from 'react';
import { resolveTheme, applyResolvedTheme, type ThemeName } from './themeRegistry';

type Theme = 'light' | 'dark';
// PortalTheme is the set of valid theme names, sourced from the registry.
export type PortalTheme = ThemeName;

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

  // Route theme selection through the pure resolver. Unknown/empty/invalid
  // names fall back to the default theme. Dark/light is handled separately
  // below and stays strictly orthogonal — never touched here.
  const applyPortalTheme = (pt: string | null | undefined) => {
    const resolved = resolveTheme(pt);
    setPortalTheme(resolved.name);
    applyResolvedTheme(document.documentElement, resolved);
  };

  // Fetch portal theme from backend on mount
  useEffect(() => {
    fetch(`${API_BASE}/settings/portal_theme`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((val: string | null) => {
        // Resolver tolerates any value (incl. future themes) and is safe on
        // unknown ones, so we always route through it.
        applyPortalTheme(val);
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
