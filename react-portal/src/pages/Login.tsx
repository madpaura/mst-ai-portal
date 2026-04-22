import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../api/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';
const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || 'open';

export const Login: React.FC = () => {
  const { login, loginWithSamlToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isSamlMode = AUTH_MODE === 'saml';

  // SAML mode: auto-redirect to IdP unless we're handling the callback
  useEffect(() => {
    if (!isSamlMode) return;
    const samlCode = searchParams.get('saml_code');
    if (samlCode) {
      // Callback path — exchange code for JWT
      setLoading(true);
      fetch(`${API_BASE}/saml/callback?saml_code=${encodeURIComponent(samlCode)}`)
        .then((res) => {
          if (!res.ok) throw new Error('SAML code exchange failed');
          return res.json();
        })
        .then(async (data) => {
          await loginWithSamlToken(data.access_token);
          navigate('/admin/videos', { replace: true });
        })
        .catch((err) => {
          setError(err.message || 'SSO login failed');
          setLoading(false);
        });
    } else {
      // No callback code — redirect immediately to IdP
      const next = encodeURIComponent(window.location.origin + '/login');
      window.location.href = `${API_BASE}/saml/login?next=${next}`;
    }
  }, [isSamlMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(username, password);
      navigate(user.role === 'admin' || user.role === 'content' ? '/admin/videos' : '/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  // SAML mode: show a redirecting spinner while the browser navigates to the IdP
  if (isSamlMode) {
    return (
      <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center">
        <div className="absolute inset-0 circuit-bg opacity-30" />
        <div className="relative w-full max-w-md p-8">
          <div className="bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/10 rounded-2xl p-8 shadow-2xl text-center">
            <div className="inline-flex items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary text-xl">smart_toy</span>
              </div>
              <span className="text-xl font-bold text-slate-900 dark:text-white">MST AI</span>
            </div>

            {error ? (
              <>
                <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
                <button
                  onClick={() => {
                    const next = encodeURIComponent(window.location.origin + '/login');
                    window.location.href = `${API_BASE}/saml/login?next=${next}`;
                  }}
                  className="w-full py-3 flex items-center justify-center gap-3 bg-[#0078d4] hover:bg-[#106ebe] text-white font-bold rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                    <rect x="12" y="1" width="10" height="10" fill="#7fba00"/>
                    <rect x="1" y="12" width="10" height="10" fill="#00a4ef"/>
                    <rect x="12" y="12" width="10" height="10" fill="#ffb900"/>
                  </svg>
                  Retry SSO Login
                </button>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-4xl text-primary animate-spin mb-4 block">
                  progress_activity
                </span>
                <p className="text-slate-400 text-sm">
                  {searchParams.get('saml_code') ? 'Completing SSO login…' : 'Redirecting to corporate SSO…'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Local / open auth mode
  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center">
      <div className="absolute inset-0 circuit-bg opacity-30" />
      <div className="relative w-full max-w-md p-8">
        <div className="bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary text-xl">smart_toy</span>
              </div>
              <span className="text-xl font-bold text-slate-900 dark:text-white">MST AI</span>
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Sign in to access the portal</p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-500 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-500 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors neon-glow"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-slate-500 text-xs">
              Dev mode: use <span className="text-primary font-mono">admin</span> / <span className="text-primary font-mono">admin</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
