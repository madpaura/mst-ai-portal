import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken } from './client';

interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  initials: string | null;
  role: string;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<User>;
  loginWithSamlToken: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  login: async () => { throw new Error('Not initialized'); },
  loginWithSamlToken: async () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    // Always attempt /auth/me — the httpOnly cookie will authenticate
    // automatically if present, even after a page reload.
    try {
      const u = await api.get<User>('/auth/me');
      setToken('');      // mark in-memory flag as logged in
      setUser(u);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (username: string, password: string): Promise<User> => {
    const res = await api.post<{ access_token: string }>('/auth/login', { username, password });
    setToken(res.access_token);
    await fetchUser();
    const u = await api.get<User>('/auth/me');
    return u;
  };

  const loginWithSamlToken = async (token: string) => {
    setToken(token);
    await fetchUser();
  };

  const logout = () => {
    api.post('/auth/logout').catch(() => {});  // clears httpOnly cookie server-side
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin: user?.role === 'admin', login, loginWithSamlToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
