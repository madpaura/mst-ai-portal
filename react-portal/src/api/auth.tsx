import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken, isLoggedIn } from './client';

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
  login: (username: string, password: string) => Promise<void>;
  loginWithSamlToken: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  login: async () => {},
  loginWithSamlToken: async () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }
    try {
      const u = await api.get<User>('/auth/me');
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

  const login = async (username: string, password: string) => {
    const res = await api.post<{ access_token: string }>('/auth/login', { username, password });
    setToken(res.access_token);
    await fetchUser();
  };

  const loginWithSamlToken = async (token: string) => {
    setToken(token);
    await fetchUser();
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin: user?.role === 'admin', login, loginWithSamlToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
