import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useTheme } from '../context/theme';
import type { PortalTheme } from '../context/theme';

export const AdminSettings: React.FC = () => {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Ollama configuration
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaSaved, setOllamaSaved] = useState({ url: '', model: '' });
  const [ollamaSaving, setOllamaSaving] = useState(false);
  const [ollamaTesting, setOllamaTesting] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null);

  // Transcript service
  const [transcriptForm, setTranscriptForm] = useState({ url: '', api_key: '', model: 'large-v3' });
  const [transcriptTesting, setTranscriptTesting] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [transcriptTestResult, setTranscriptTestResult] = useState<{ ok: boolean; detail: any } | null>(null);
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);

  // Contact email
  const [contactEmail, setContactEmail] = useState('');
  const [contactEmailSaved, setContactEmailSaved] = useState('');
  const [contactEmailSaving, setContactEmailSaving] = useState(false);

  // SMTP
  const [smtpConfig, setSmtpConfig] = useState<Record<string, string> | null>(null);
  const [showSmtpModal, setShowSmtpModal] = useState(false);
  const [smtpForm, setSmtpForm] = useState({
    smtp_server: '', smtp_port: '1025', smtp_user: '', smtp_password: '',
    smtp_from_email: '', smtp_from_name: '', test_recipient: '',
  });
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [smtpProbing, setSmtpProbing] = useState(false);
  const [smtpProbeResult, setSmtpProbeResult] = useState<{ steps: { step: string; ok: boolean; detail: string }[]; reachable: boolean; hint?: string } | null>(null);

  // Redis cache
  const [cacheStats, setCacheStats] = useState<Record<string, any> | null>(null);
  const [cacheFlushing, setCacheFlushing] = useState(false);

  // Portal theme
  const { portalTheme, applyPortalTheme } = useTheme();
  const [themeSaving, setThemeSaving] = useState(false);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleThemeSave = async (theme: PortalTheme) => {
    setThemeSaving(true);
    try {
      await api.put('/settings/admin/portal_theme', { value: theme });
      applyPortalTheme(theme);
      showMsg('success', `Theme set to "${theme}"`);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setThemeSaving(false);
    }
  };

  const fetchTranscriptConfig = useCallback(async () => {
    try {
      const cfg = await api.get<{ url?: string; api_key?: string; model?: string } | null>('/settings/transcript_config');
      if (cfg) {
        setTranscriptForm({ url: cfg.url || '', api_key: '', model: cfg.model || 'large-v3' });
      }
    } catch { }
  }, []);

  const fetchContactEmail = useCallback(async () => {
    try {
      const data = await api.get<string | null>('/settings/contact_email');
      if (data) { setContactEmail(data); setContactEmailSaved(data); }
    } catch { }
  }, []);

  const fetchSmtpSettings = useCallback(async () => {
    try {
      const data = await api.get<Record<string, string> | null>('/settings/smtp_config');
      setSmtpConfig(data);
      if (data) {
        setSmtpForm(f => ({
          ...f,
          smtp_server: data.smtp_server || '',
          smtp_port: data.smtp_port || '1025',
          smtp_user: data.smtp_user || '',
          smtp_password: '',
          smtp_from_email: data.smtp_from_email || '',
          smtp_from_name: data.smtp_from_name || '',
        }));
      }
    } catch { }
  }, []);

  const fetchCacheStats = useCallback(async () => {
    try {
      const data = await api.get<Record<string, any>>('/admin/cache/stats');
      setCacheStats(data);
    } catch { }
  }, []);

  const fetchOllamaConfig = useCallback(async () => {
    try {
      const data = await api.get<{ base_url: string; model?: string } | null>('/settings/ollama_config');
      if (data?.base_url) {
        setOllamaUrl(data.base_url);
        setOllamaModel(data.model || '');
        setOllamaSaved({ url: data.base_url, model: data.model || '' });
      }
    } catch { }
  }, []);

  useEffect(() => {
    fetchSmtpSettings();
    fetchTranscriptConfig();
    fetchContactEmail();
    fetchCacheStats();
    fetchOllamaConfig();
  }, [fetchSmtpSettings, fetchTranscriptConfig, fetchContactEmail, fetchCacheStats, fetchOllamaConfig]);

  const handleOllamaSave = async () => {
    setOllamaSaving(true);
    try {
      await api.put('/settings/admin/ollama_config', { value: { base_url: ollamaUrl.trim(), model: ollamaModel } });
      setOllamaSaved({ url: ollamaUrl.trim(), model: ollamaModel });
      showMsg('success', 'Ollama configuration saved');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setOllamaSaving(false);
    }
  };

  const handleOllamaTest = async () => {
    setOllamaTesting(true);
    setOllamaTestResult(null);
    setOllamaModels([]);
    try {
      const res = await api.post<{ ok: boolean; models?: string[]; error?: string }>('/admin/test-ollama', {
        base_url: ollamaUrl.trim(),
      });
      setOllamaTestResult(res);
      if (res.ok && res.models) {
        setOllamaModels(res.models);
        if (!ollamaModel || !res.models.includes(ollamaModel)) {
          setOllamaModel(res.models[0] || '');
        }
      }
    } catch (err: any) {
      setOllamaTestResult({ ok: false, error: err.message });
    } finally {
      setOllamaTesting(false);
    }
  };

  const handleContactEmailSave = async () => {
    setContactEmailSaving(true);
    try {
      await api.put('/settings/admin/contact_email', { value: contactEmail });
      setContactEmailSaved(contactEmail);
      showMsg('success', 'Contact email saved');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setContactEmailSaving(false);
    }
  };

  const handleCacheFlush = async (namespace?: string) => {
    setCacheFlushing(true);
    try {
      if (namespace) {
        await api.post(`/admin/cache/flush/${namespace}`, {});
        showMsg('success', `Cache flushed: ${namespace}`);
      } else {
        await api.post('/admin/cache/flush', {});
        showMsg('success', 'All caches flushed');
      }
      await fetchCacheStats();
    } catch (err: any) {
      showMsg('error', err.message);
    } finally { setCacheFlushing(false); }
  };

  const handleTranscriptSave = async () => {
    setTranscriptSaving(true);
    try {
      const payload: any = { url: transcriptForm.url || null, model: transcriptForm.model };
      if (transcriptForm.api_key) payload.api_key = transcriptForm.api_key;
      await api.put('/settings/admin/transcript_config', { value: payload });
      showMsg('success', 'Transcript service settings saved');
      setTranscriptForm(f => ({ ...f, api_key: '' }));
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setTranscriptSaving(false);
    }
  };

  const handleTranscriptTest = async () => {
    if (!transcriptForm.url) { showMsg('error', 'Enter the service URL first'); return; }
    setTranscriptTesting(true);
    setTranscriptTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; detail: any }>('/admin/transcript-service/test', {
        url: transcriptForm.url,
        api_key: transcriptForm.api_key,
      });
      setTranscriptTestResult(res);
    } catch (err: any) {
      setTranscriptTestResult({ ok: false, detail: err.message });
    } finally {
      setTranscriptTesting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Toast */}
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Admin Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Portal configuration — email, theme, transcription, and caching</p>
      </div>

      {/* ── Ollama Configuration ───────────────────────────────────── */}
      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-100 dark:border-white/5 p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-primary">psychology</span>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Ollama Configuration</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Global Ollama endpoint — used by video Auto Mode and article AI features</p>
          </div>
        </div>
        <div className="space-y-4">
          {/* URL + Test */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Base URL</label>
            <div className="flex gap-3">
              <input
                type="url"
                value={ollamaUrl}
                onChange={e => { setOllamaUrl(e.target.value); setOllamaTestResult(null); setOllamaModels([]); }}
                placeholder="http://localhost:11434"
                className="flex-1 px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm font-mono focus:border-primary outline-none"
              />
              <button
                onClick={handleOllamaTest}
                disabled={ollamaTesting || !ollamaUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-muted-light dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40 text-slate-700 dark:text-slate-200 text-sm font-bold rounded-lg transition-colors border border-slate-300 dark:border-white/10"
              >
                <span className={`material-symbols-outlined text-sm ${ollamaTesting ? 'animate-spin' : ''}`}>
                  {ollamaTesting ? 'progress_activity' : 'wifi_tethering'}
                </span>
                {ollamaTesting ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
          </div>

          {/* Test result */}
          {ollamaTestResult && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${ollamaTestResult.ok
              ? 'bg-green-500/10 text-green-400 border-green-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}>
              <span className="material-symbols-outlined text-base">{ollamaTestResult.ok ? 'check_circle' : 'error'}</span>
              {ollamaTestResult.ok
                ? `Connected — ${ollamaTestResult.models?.length ?? 0} model(s) available`
                : ollamaTestResult.error}
            </div>
          )}

          {/* Model selection — shown once models are loaded */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Model</label>
            {ollamaModels.length > 0 ? (
              <select
                value={ollamaModel}
                onChange={e => setOllamaModel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
              >
                {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100/50 dark:bg-slate-900/50 border border-slate-100 dark:border-white/5">
                {ollamaSaved.model ? (
                  <span className="text-sm text-slate-300 font-mono">{ollamaSaved.model}</span>
                ) : (
                  <span className="text-sm text-slate-500">Test connection to load available models</span>
                )}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleOllamaSave}
              disabled={ollamaSaving || (ollamaUrl.trim() === ollamaSaved.url && ollamaModel === ollamaSaved.model)}
              className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              {ollamaSaving ? 'Saving…' : 'Save'}
            </button>
            {ollamaSaved.url && (
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px] text-green-400">check_circle</span>
                <span className="font-mono text-slate-400">{ollamaSaved.url}</span>
                {ollamaSaved.model && <span className="ml-1 text-slate-500">· {ollamaSaved.model}</span>}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Contact Email ──────────────────────────────────────────── */}
      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-100 dark:border-white/5 p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-primary">contact_mail</span>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Contact Email</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Email address shown when users click "Contact" in the navigation</p>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <input
            type="email"
            value={contactEmail}
            onChange={e => setContactEmail(e.target.value)}
            placeholder="ai-tools@mst.internal"
            className="flex-1 px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
          />
          <button
            onClick={handleContactEmailSave}
            disabled={contactEmailSaving || contactEmail === contactEmailSaved}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            {contactEmailSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {contactEmailSaved && (
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px] text-green-400">check_circle</span>
            Currently set to <span className="text-slate-400 font-mono ml-1">{contactEmailSaved}</span>
          </p>
        )}
      </div>

      {/* ── Portal Theme ───────────────────────────────────────────── */}
      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-100 dark:border-white/5 p-6 mb-8">
        <div className="flex items-center gap-3 mb-5">
          <span className="material-symbols-outlined text-primary">palette</span>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Portal Theme</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Choose the visual style applied portal-wide to all users</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => handleThemeSave('default')}
            disabled={themeSaving || portalTheme === 'default'}
            className={`relative flex flex-col gap-3 p-4 rounded-xl border-2 text-left transition-all ${
              portalTheme === 'default' ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-slate-100/50 dark:bg-slate-900/50'
            }`}
          >
            {portalTheme === 'default' && (
              <span className="absolute top-3 right-3 material-symbols-outlined text-primary text-[18px]">check_circle</span>
            )}
            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-panel-light dark:bg-background-dark p-2">
              <div className="h-2 w-16 rounded bg-[#258cf4]/30 mb-1.5" />
              <div className="flex gap-1.5">
                <div className="flex-1 h-10 rounded bg-[#258cf4]/10 border border-[#258cf4]/20" style={{ boxShadow: '0 0 8px rgba(37,140,244,0.15)' }} />
                <div className="flex-1 h-10 rounded bg-[#258cf4]/10 border border-[#258cf4]/20" style={{ boxShadow: '0 0 8px rgba(37,140,244,0.15)' }} />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Default</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Blue glass cards, neon glow, circuit background</p>
            </div>
          </button>

          <button
            onClick={() => handleThemeSave('simple')}
            disabled={themeSaving || portalTheme === 'simple'}
            className={`relative flex flex-col gap-3 p-4 rounded-xl border-2 text-left transition-all ${
              portalTheme === 'simple' ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-slate-100/50 dark:bg-slate-900/50'
            }`}
          >
            {portalTheme === 'simple' && (
              <span className="absolute top-3 right-3 material-symbols-outlined text-primary text-[18px]">check_circle</span>
            )}
            <div className="rounded-lg overflow-hidden border border-[#30363d] flex">
              <div className="flex-1 bg-[#ffffff] p-2">
                <div className="h-1.5 w-8 rounded bg-[#d0d7de] mb-1.5" />
                <div className="h-8 rounded bg-[#f6f8fa] border border-[#d0d7de]" />
              </div>
              <div className="flex-1 bg-[#0d1117] p-2">
                <div className="h-1.5 w-8 rounded bg-[#30363d] mb-1.5" />
                <div className="h-8 rounded bg-[#161b22] border border-[#30363d]" />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Simple</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">GitHub-inspired flat cards, clean borders — supports light &amp; dark toggle</p>
            </div>
          </button>
        </div>
        {themeSaving && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
            Applying theme…
          </p>
        )}
      </div>

      {/* ── Transcript Service ─────────────────────────────────────── */}
      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-100 dark:border-white/5 p-6 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">mic</span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Transcript Service</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Configure the remote speech-to-text service for Auto Mode video processing</p>
            </div>
          </div>
          <button
            onClick={() => setShowTranscriptModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-sm">settings</span>
            Configure
          </button>
        </div>
        {transcriptForm.url && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">link</span>{transcriptForm.url}</span>
              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">model_training</span>Model: {transcriptForm.model}</span>
            </div>
          </div>
        )}
      </div>

      {/* Transcript Modal */}
      {showTranscriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowTranscriptModal(false)} />
          <div className="relative w-full max-w-md bg-white dark:bg-background-dark border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Transcript Service</h2>
              <button onClick={() => setShowTranscriptModal(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Service URL</label>
                <input
                  value={transcriptForm.url}
                  onChange={e => setTranscriptForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="http://transcript-service:9100"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Same machine (Docker): <button type="button" className="text-primary hover:underline font-mono" onClick={() => setTranscriptForm(f => ({ ...f, url: 'http://transcript-service:9100' }))}>http://transcript-service:9100</button>
                  {' · '}External: <span className="font-mono">http://&lt;host-ip&gt;:9100</span>
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">API Key</label>
                <input
                  type="password"
                  value={transcriptForm.api_key}
                  onChange={e => setTranscriptForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder="(leave blank to keep existing)"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Whisper Model</label>
                <select
                  value={transcriptForm.model}
                  onChange={e => setTranscriptForm(f => ({ ...f, model: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                >
                  <option value="large-v3">large-v3 (best quality, needs ≥10 GB VRAM)</option>
                  <option value="medium">medium (good quality, ~5 GB VRAM)</option>
                  <option value="small">small (fast, ~2 GB VRAM)</option>
                  <option value="base">base (fastest, ~1 GB VRAM)</option>
                </select>
              </div>
              {transcriptTestResult && (
                <div className={`p-3 rounded-lg text-xs border ${transcriptTestResult.ok ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                  {transcriptTestResult.ok ? '✓ Connected — ' : '✗ Failed — '}
                  {typeof transcriptTestResult.detail === 'object' ? JSON.stringify(transcriptTestResult.detail) : String(transcriptTestResult.detail)}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleTranscriptTest}
                  disabled={transcriptTesting || !transcriptForm.url}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-muted-light dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40 text-slate-700 dark:text-slate-200 text-sm font-bold rounded-lg transition-colors border border-slate-300 dark:border-white/10"
                >
                  <span className="material-symbols-outlined text-sm">{transcriptTesting ? 'autorenew' : 'wifi_tethering'}</span>
                  {transcriptTesting ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  onClick={async () => { await handleTranscriptSave(); setShowTranscriptModal(false); }}
                  disabled={transcriptSaving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">save</span>
                  {transcriptSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SMTP Email ─────────────────────────────────────────────── */}
      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-100 dark:border-white/5 p-6 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">mail</span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">SMTP Email Configuration</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Configure outgoing email server for newsletters</p>
            </div>
          </div>
          <button
            onClick={() => setShowSmtpModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-sm">settings</span>
            {smtpConfig ? 'Configure' : 'Set Up'}
          </button>
        </div>
        {smtpConfig && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">server</span>{smtpConfig.smtp_server}:{smtpConfig.smtp_port}</span>
              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">email</span>From: {smtpConfig.smtp_from_email}</span>
              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">verified_user</span>Auth: {smtpConfig.smtp_user ? 'Yes' : 'No'}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Redis Cache ────────────────────────────────────────────── */}
      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-100 dark:border-white/5 p-6 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">memory</span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Redis Cache</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Version-based invalidation for hot public endpoints</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchCacheStats} className="flex items-center gap-2 px-3 py-1.5 bg-muted-light dark:bg-muted-dark hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors border border-slate-300 dark:border-white/10">
              <span className="material-symbols-outlined text-xs">refresh</span>Refresh
            </button>
            <button onClick={() => handleCacheFlush()} disabled={cacheFlushing} className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-colors border border-red-500/20 disabled:opacity-50">
              <span className="material-symbols-outlined text-xs">delete_sweep</span>{cacheFlushing ? 'Flushing…' : 'Flush All'}
            </button>
          </div>
        </div>
        {cacheStats && (
          <div className="mt-4 pt-4 border-t border-white/5">
            {cacheStats.enabled === false ? (
              <p className="text-sm text-slate-500">Redis is disabled. Set <code className="text-xs bg-panel-light dark:bg-panel-dark px-1 rounded">REDIS_ENABLED=true</code> to enable caching.</p>
            ) : !cacheStats.connected ? (
              <p className="text-sm text-amber-400">Redis enabled but not reachable. Check <code className="text-xs bg-panel-light dark:bg-panel-dark px-1 rounded">REDIS_URL</code> and ensure the redis container is running.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Memory Used', value: cacheStats.used_memory_human },
                    { label: 'Peak Memory', value: cacheStats.used_memory_peak_human },
                    { label: 'Cache Hits', value: (cacheStats.keyspace_hits ?? 0).toLocaleString() },
                    { label: 'Cache Misses', value: (cacheStats.keyspace_misses ?? 0).toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-100/50 dark:bg-slate-900/50 rounded-lg p-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                      <p className="text-sm font-bold text-white mt-0.5">{value ?? '—'}</p>
                    </div>
                  ))}
                </div>
                {cacheStats.namespace_versions && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Namespace Versions</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(cacheStats.namespace_versions as Record<string, number>).map(([ns, ver]) => (
                        <div key={ns} className="flex items-center gap-1.5 bg-slate-100/50 dark:bg-slate-900/50 rounded-lg px-3 py-1.5">
                          <span className="text-xs text-slate-500 dark:text-slate-400">{ns}</span>
                          <span className="text-xs font-mono text-primary">v{ver}</span>
                          <button onClick={() => handleCacheFlush(ns)} disabled={cacheFlushing} className="ml-1 text-slate-500 hover:text-red-400 transition-colors" title={`Flush ${ns}`}>
                            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>close</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SMTP Modal */}
      {showSmtpModal && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSmtpModal(false)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-background-dark border-l border-slate-200 dark:border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">SMTP Email Configuration</h2>
              <button onClick={() => setShowSmtpModal(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">SMTP Server</label>
                <input value={smtpForm.smtp_server} onChange={e => setSmtpForm(f => ({ ...f, smtp_server: e.target.value }))}
                  placeholder="smtp.gmail.com"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                <p className="text-xs text-slate-500 mt-1">Common: smtp.gmail.com, smtp.office365.com, smtp.sendgrid.net</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">SMTP Port</label>
                <input value={smtpForm.smtp_port} onChange={e => setSmtpForm(f => ({ ...f, smtp_port: e.target.value }))}
                  placeholder="587"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                <p className="text-xs text-slate-500 mt-1">587 (STARTTLS) · 465 (SSL) · 25 (unencrypted)</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Username</label>
                <input value={smtpForm.smtp_user} onChange={e => setSmtpForm(f => ({ ...f, smtp_user: e.target.value }))}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Password</label>
                <input type="password" value={smtpForm.smtp_password} onChange={e => setSmtpForm(f => ({ ...f, smtp_password: e.target.value }))}
                  placeholder="(leave blank to keep existing)"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                <p className="text-xs text-slate-500 mt-1">Gmail: Use App Password, not regular password</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">From Email</label>
                <input value={smtpForm.smtp_from_email} onChange={e => setSmtpForm(f => ({ ...f, smtp_from_email: e.target.value }))}
                  placeholder="noreply@company.com"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">From Name</label>
                <input value={smtpForm.smtp_from_name} onChange={e => setSmtpForm(f => ({ ...f, smtp_from_name: e.target.value }))}
                  placeholder="MST AI Portal"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Test Recipient Email</label>
                <input value={smtpForm.test_recipient} onChange={e => setSmtpForm(f => ({ ...f, test_recipient: e.target.value }))}
                  placeholder="test@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              {smtpProbeResult && (
                <div className="rounded-lg border border-white/10 overflow-hidden">
                  <div className={`flex items-center gap-2 px-3 py-2 text-xs font-bold ${smtpProbeResult.reachable ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    <span className="material-symbols-outlined text-sm">{smtpProbeResult.reachable ? 'check_circle' : 'error'}</span>
                    {smtpProbeResult.reachable ? 'Server reachable' : 'Server not reachable'}
                    <button onClick={() => setSmtpProbeResult(null)} className="ml-auto text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white">
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                  {smtpProbeResult.hint && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-amber-500/10 border-b border-white/5 text-xs text-amber-300">
                      <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">tips_and_updates</span>
                      {smtpProbeResult.hint}
                    </div>
                  )}
                  <div className="divide-y divide-white/5">
                    {smtpProbeResult.steps.map(s => (
                      <div key={s.step} className="flex items-start gap-3 px-3 py-2 bg-slate-100/40 dark:bg-slate-900/40">
                        <span className={`material-symbols-outlined text-sm mt-0.5 ${s.ok ? 'text-green-400' : 'text-red-400'}`}>{s.ok ? 'check' : 'close'}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-bold text-slate-300">{s.step}</span>
                          <p className="text-[11px] text-slate-500 truncate">{s.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {smtpTestResult && (
                <div className={`p-3 rounded-lg border text-sm ${smtpTestResult.success
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
                }`}>
                  <span className="material-symbols-outlined text-sm align-text-bottom mr-1">
                    {smtpTestResult.success ? 'check_circle' : 'error'}
                  </span>
                  {smtpTestResult.message}
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-white/5">
                <button
                  onClick={async () => {
                    if (!smtpForm.smtp_server) { showMsg('error', 'Enter SMTP server first'); return; }
                    setSmtpProbing(true); setSmtpProbeResult(null);
                    try {
                      const res = await api.post<{ steps: { step: string; ok: boolean; detail: string }[]; reachable: boolean }>('/admin/probe-smtp', {
                        smtp_server: smtpForm.smtp_server,
                        smtp_port: parseInt(smtpForm.smtp_port) || 587,
                      });
                      setSmtpProbeResult(res);
                    } catch (err: any) {
                      showMsg('error', `Probe failed: ${err.message}`);
                    } finally { setSmtpProbing(false); }
                  }}
                  disabled={smtpProbing}
                  className="flex items-center gap-2 px-4 py-2 bg-muted-light dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-bold rounded-lg transition-colors border border-slate-300 dark:border-white/10 disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-sm ${smtpProbing ? 'animate-spin' : ''}`}>{smtpProbing ? 'progress_activity' : 'network_check'}</span>
                  {smtpProbing ? 'Probing...' : 'Check Connectivity'}
                </button>
                <button
                  onClick={async () => {
                    if (!smtpForm.smtp_server || !smtpForm.test_recipient) {
                      showMsg('error', 'Enter SMTP server and test recipient'); return;
                    }
                    setSmtpTesting(true); setSmtpTestResult(null);
                    try {
                      const res = await api.post<{ success: boolean; message: string }>('/admin/test-smtp', {
                        smtp_server: smtpForm.smtp_server,
                        smtp_port: parseInt(smtpForm.smtp_port) || 587,
                        smtp_user: smtpForm.smtp_user,
                        smtp_password: smtpForm.smtp_password,
                        smtp_from_email: smtpForm.smtp_from_email,
                        test_recipient: smtpForm.test_recipient,
                      });
                      setSmtpTestResult(res);
                    } catch (err: any) {
                      setSmtpTestResult({ success: false, message: err.message });
                    } finally { setSmtpTesting(false); }
                  }}
                  disabled={smtpTesting}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-sm font-bold rounded-lg transition-colors border border-amber-500/20 disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-sm ${smtpTesting ? 'animate-spin' : ''}`}>{smtpTesting ? 'progress_activity' : 'send'}</span>
                  {smtpTesting ? 'Testing...' : 'Send Test'}
                </button>
                <button
                  onClick={async () => {
                    setSmtpSaving(true);
                    try {
                      const payload: Record<string, string> = {
                        smtp_server: smtpForm.smtp_server,
                        smtp_port: smtpForm.smtp_port,
                        smtp_user: smtpForm.smtp_user,
                        smtp_from_email: smtpForm.smtp_from_email,
                        smtp_from_name: smtpForm.smtp_from_name,
                      };
                      if (smtpForm.smtp_password) payload.smtp_password = smtpForm.smtp_password;
                      await api.put('/settings/admin/smtp_config', { value: payload });
                      showMsg('success', 'SMTP settings saved');
                      await fetchSmtpSettings();
                      setShowSmtpModal(false);
                    } catch (err: any) {
                      showMsg('error', err.message);
                    } finally { setSmtpSaving(false); }
                  }}
                  disabled={smtpSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-sm">save</span>
                  {smtpSaving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setShowSmtpModal(false)} className="px-6 py-2.5 bg-muted-light dark:bg-muted-dark hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
