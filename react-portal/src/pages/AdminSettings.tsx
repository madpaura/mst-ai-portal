import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';

interface ForgeSetting {
  id: string;
  git_url: string;
  git_token: string | null;
  git_branch: string;
  scan_paths: string[];
  update_frequency: string;
  llm_provider: string;
  llm_model: string;
  llm_api_key: string | null;
  auto_update_release_tag: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SyncJob {
  id: number;
  settings_id: string;
  trigger_type: string;
  status: string;
  components_found: number;
  components_updated: number;
  components_created: number;
  error: string | null;
  log: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface SettingForm {
  git_url: string;
  git_token: string;
  git_branch: string;
  scan_paths: string;
  update_frequency: string;
  llm_provider: string;
  llm_model: string;
  llm_api_key: string;
  auto_update_release_tag: boolean;
}

const EMPTY_FORM: SettingForm = {
  git_url: '', git_token: '', git_branch: 'main',
  scan_paths: '.', update_frequency: 'nightly',
  llm_provider: 'openai', llm_model: 'gpt-4o-mini',
  llm_api_key: '', auto_update_release_tag: true,
};

export const AdminSettings: React.FC = () => {
  const [settings, setSettings] = useState<ForgeSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ForgeSetting | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<SettingForm>(EMPTY_FORM);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [selectedSettingId, setSelectedSettingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, { git: any; llm: any } | null>>({});
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Transcript service settings
  const [transcriptForm, setTranscriptForm] = useState({ url: '', api_key: '', model: 'large-v3' });
  const [transcriptTesting, setTranscriptTesting] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [transcriptTestResult, setTranscriptTestResult] = useState<{ ok: boolean; detail: any } | null>(null);
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);

  // SMTP settings
  const [smtpConfig, setSmtpConfig] = useState<Record<string, string> | null>(null);
  const [showSmtpModal, setShowSmtpModal] = useState(false);
  const [smtpForm, setSmtpForm] = useState({
    smtp_server: '', smtp_port: '1025', smtp_user: '', smtp_password: '',
    smtp_from_email: '', smtp_from_name: '', test_recipient: '',
  });
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api.get<ForgeSetting[]>('/admin/forge/settings');
      setSettings(data);
      // Pre-fill transcript settings from the first active forge setting
      const active = data.find((s) => s.is_active) || data[0];
      if (active) {
        setTranscriptForm({
          url: (active as any).transcript_service_url || '',
          api_key: '',  // never show stored key
          model: (active as any).transcript_model || 'large-v3',
        });
      }
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSmtpSettings = useCallback(async () => {
    try {
      const data = await api.get<Record<string, string> | null>('/settings/smtp_config');
      setSmtpConfig(data);
      if (data) {
        setSmtpForm((f) => ({
          ...f,
          smtp_server: data.smtp_server || '',
          smtp_port: data.smtp_port || '1025',
          smtp_user: data.smtp_user || '',
          smtp_password: '', // never show stored password
          smtp_from_email: data.smtp_from_email || '',
          smtp_from_name: data.smtp_from_name || '',
        }));
      }
    } catch { /* no saved settings yet */ }
  }, []);

  const fetchJobs = useCallback(async (settingId: string) => {
    try {
      const data = await api.get<SyncJob[]>(`/admin/forge/settings/${settingId}/jobs`);
      setJobs(data);
    } catch (err: any) {
      showMsg('error', err.message);
    }
  }, []);

  useEffect(() => { fetchSettings(); fetchSmtpSettings(); }, [fetchSettings, fetchSmtpSettings]);

  useEffect(() => {
    if (selectedSettingId) fetchJobs(selectedSettingId);
  }, [selectedSettingId, fetchJobs]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCreating(true);
  };

  const openEdit = (s: ForgeSetting) => {
    setCreating(false);
    setEditing(s);
    setForm({
      git_url: s.git_url,
      git_token: '',
      git_branch: s.git_branch,
      scan_paths: s.scan_paths.join(', '),
      update_frequency: s.update_frequency,
      llm_provider: s.llm_provider,
      llm_model: s.llm_model,
      llm_api_key: '',
      auto_update_release_tag: s.auto_update_release_tag,
    });
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    const payload: any = {
      git_url: form.git_url,
      git_branch: form.git_branch,
      scan_paths: form.scan_paths.split(',').map((s) => s.trim()).filter(Boolean),
      update_frequency: form.update_frequency,
      llm_provider: form.llm_provider,
      llm_model: form.llm_model,
      auto_update_release_tag: form.auto_update_release_tag,
    };
    if (form.git_token) payload.git_token = form.git_token;
    if (form.llm_api_key) payload.llm_api_key = form.llm_api_key;

    try {
      if (creating) {
        await api.post('/admin/forge/settings', payload);
        showMsg('success', 'Setting created');
      } else if (editing) {
        await api.put(`/admin/forge/settings/${editing.id}`, payload);
        showMsg('success', 'Setting updated');
      }
      closeForm();
      await fetchSettings();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDelete = async (s: ForgeSetting) => {
    if (!confirm(`Delete setting for "${s.git_url}"?`)) return;
    try {
      await api.delete(`/admin/forge/settings/${s.id}`);
      await fetchSettings();
      showMsg('success', 'Setting deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSync = async (settingId: string) => {
    setSyncing((v) => ({ ...v, [settingId]: true }));
    try {
      await api.post(`/admin/forge/settings/${settingId}/sync`);
      showMsg('success', 'Sync job started');
      setSelectedSettingId(settingId);
      fetchJobs(settingId);
      // Start polling for live updates
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const data = await api.get<SyncJob[]>(`/admin/forge/settings/${settingId}/jobs`);
          setJobs(data);
          const running = data.some((j) => j.status === 'running' || j.status === 'pending');
          if (!running) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setSyncing((v) => ({ ...v, [settingId]: false }));
          }
          // Auto-expand the latest running job
          const runningJob = data.find((j) => j.status === 'running');
          if (runningJob) setExpandedJobId(runningJob.id);
        } catch { /* ignore */ }
      }, 2000);
    } catch (err: any) {
      showMsg('error', err.message);
      setSyncing((v) => ({ ...v, [settingId]: false }));
    }
  };

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (expandedJobId && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [jobs, expandedJobId]);

  const handleVerify = async (settingId: string) => {
    setVerifying((v) => ({ ...v, [settingId]: true }));
    setVerifyResults((v) => ({ ...v, [settingId]: null }));
    try {
      const res = await api.post<{ git: any; llm: any }>(`/admin/forge/settings/${settingId}/verify`);
      setVerifyResults((v) => ({ ...v, [settingId]: res }));
    } catch (err: any) {
      const detail = err.message || 'Unknown error';
      setVerifyResults((v) => ({
        ...v,
        [settingId]: {
          git: { status: 'error', message: `Verification request failed: ${detail}` },
          llm: { status: 'error', message: `Verification request failed: ${detail}` },
        },
      }));
    } finally {
      setVerifying((v) => ({ ...v, [settingId]: false }));
    }
  };

  const handleSyncAll = async () => {
    try {
      const res = await api.post<{ message: string }>('/admin/forge/sync-all');
      showMsg('success', res.message);
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleTranscriptSave = async () => {
    const active = settings.find((s) => s.is_active) || settings[0];
    if (!active) { showMsg('error', 'No forge setting found. Create one first.'); return; }
    setTranscriptSaving(true);
    try {
      const payload: any = {
        transcript_service_url: transcriptForm.url || null,
        transcript_model: transcriptForm.model,
      };
      if (transcriptForm.api_key) payload.transcript_service_api_key = transcriptForm.api_key;
      await api.put(`/admin/forge/settings/${active.id}`, payload);
      showMsg('success', 'Transcript service settings saved');
      setTranscriptForm((f) => ({ ...f, api_key: '' }));
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

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading settings...</div>;
  }

  const showForm = creating || editing;

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

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-xl font-bold text-white">Admin Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Configure SMTP email and marketplace repository scanning</p>
      </div>

      {/* ── Transcript Service Card ─────────────────────────────── */}
      <div className="bg-card-dark rounded-xl border border-white/5 p-6 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">mic</span>
            <div>
              <h2 className="text-base font-bold text-white">Transcript Service</h2>
              <p className="text-xs text-slate-400 mt-0.5">Configure the remote GPU-hosted speech-to-text service for Auto Mode video processing</p>
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
            <div className="flex flex-wrap gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">link</span>
                {transcriptForm.url}
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">model_training</span>
                Model: {transcriptForm.model}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Transcript Service Modal */}
      {showTranscriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowTranscriptModal(false)} />
          <div className="relative w-full max-w-md bg-background-dark border border-white/10 rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-white">Transcript Service</h2>
              <button onClick={() => setShowTranscriptModal(false)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Service URL</label>
                <input
                  value={transcriptForm.url}
                  onChange={(e) => setTranscriptForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="http://gpu-host:9100"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">API Key</label>
                <input
                  type="password"
                  value={transcriptForm.api_key}
                  onChange={(e) => setTranscriptForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder="(leave blank to keep existing)"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Whisper Model</label>
                <select
                  value={transcriptForm.model}
                  onChange={(e) => setTranscriptForm((f) => ({ ...f, model: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
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
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 text-sm font-bold rounded-lg transition-colors border border-white/10"
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

      {/* ── SMTP Settings Card ──────────────────────────────────── */}
      <div className="bg-card-dark rounded-xl border border-white/5 p-6 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">mail</span>
            <div>
              <h2 className="text-base font-bold text-white">SMTP Email Configuration</h2>
              <p className="text-xs text-slate-400 mt-0.5">Configure outgoing email server for newsletters</p>
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
            <div className="flex flex-wrap gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">server</span>
                {smtpConfig.smtp_server}:{smtpConfig.smtp_port}
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">email</span>
                From: {smtpConfig.smtp_from_email}
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">verified_user</span>
                Auth: {smtpConfig.smtp_user ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Marketplace Settings Header ────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-bold text-white">Marketplace Settings</h2>
          <p className="text-sm text-slate-400 mt-1">Configure git repositories for auto-scanning marketplace components</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSyncAll} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold rounded-lg transition-colors border border-white/10">
            <span className="material-symbols-outlined text-sm">sync</span>
            Sync All
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">add</span>
            Add Repository
          </button>
        </div>
      </div>

      {/* Settings List */}
      <div className="space-y-4 mb-8">
        {settings.map((s) => (
          <div key={s.id} className="bg-card-dark rounded-xl border border-white/5 p-5">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-primary">folder_open</span>
                  <h3 className="text-sm font-bold text-white">{s.git_url}</h3>
                  {s.is_active ? (
                    <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400">Active</span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">commit</span>
                    {s.git_branch}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">schedule</span>
                    {s.update_frequency}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">smart_toy</span>
                    {s.llm_provider}/{s.llm_model}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">key</span>
                    Token: {s.git_token || 'not set'}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">new_releases</span>
                    Auto-tag: {s.auto_update_release_tag ? 'On' : 'Off'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleVerify(s.id)}
                  disabled={verifying[s.id]}
                  className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-green-400 transition-colors disabled:opacity-40"
                  title="Verify connection"
                >
                  <span className={`material-symbols-outlined text-sm ${verifying[s.id] ? 'animate-spin' : ''}`}>
                    {verifying[s.id] ? 'progress_activity' : 'verified'}
                  </span>
                </button>
                <button
                  onClick={() => handleSync(s.id)}
                  disabled={syncing[s.id]}
                  className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-primary transition-colors disabled:opacity-40"
                  title="Trigger sync"
                >
                  <span className={`material-symbols-outlined text-sm ${syncing[s.id] ? 'animate-spin' : ''}`}>
                    {syncing[s.id] ? 'progress_activity' : 'sync'}
                  </span>
                </button>
                <button
                  onClick={() => setSelectedSettingId(selectedSettingId === s.id ? null : s.id)}
                  className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  title="View jobs"
                >
                  <span className="material-symbols-outlined text-sm">history</span>
                </button>
                <button onClick={() => openEdit(s)} className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
                <button onClick={() => handleDelete(s)} className="p-2 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors">
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
            </div>

            {/* Verify Results */}
            {verifyResults[s.id] && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Connection Verification</h4>
                  <button onClick={() => setVerifyResults((v) => ({ ...v, [s.id]: null }))} className="text-slate-500 hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {(['git', 'llm'] as const).map((key) => {
                    const r = verifyResults[s.id]?.[key];
                    if (!r) return null;
                    const icon = r.status === 'ok' ? 'check_circle' : r.status === 'warning' ? 'warning' : 'error';
                    const colors = r.status === 'ok' ? 'bg-green-500/10 text-green-400 border-green-500/30'
                      : r.status === 'warning' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-red-500/10 text-red-400 border-red-500/30';
                    return (
                      <div key={key} className={`flex items-start gap-3 p-3 rounded-lg border ${colors}`}>
                        <span className="material-symbols-outlined text-base mt-0.5">{icon}</span>
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wider">{key === 'git' ? 'Git Repository' : 'LLM Provider'}</span>
                          <p className="text-xs mt-0.5 opacity-80">{r.message}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sync Jobs */}
            {selectedSettingId === s.id && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Sync Jobs</h4>
                {jobs.length === 0 ? (
                  <p className="text-xs text-slate-500">No sync jobs yet</p>
                ) : (
                  <div className="space-y-2">
                    {jobs.map((job) => (
                      <div key={job.id} className="bg-slate-900/50 rounded-lg overflow-hidden">
                        <div
                          className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-800/50 transition-colors"
                          onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-0.5 rounded font-bold ${
                              job.status === 'completed' ? 'bg-green-500/10 text-green-400' :
                              job.status === 'running' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                              job.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                              'bg-slate-700 text-slate-400'
                            }`}>
                              {job.status === 'running' ? '● running' : job.status}
                            </span>
                            <span className="text-slate-400 capitalize">{job.trigger_type}</span>
                          </div>
                          <div className="flex items-center gap-4 text-slate-500">
                            <span>Found: {job.components_found}</span>
                            <span>Created: {job.components_created}</span>
                            <span>Updated: {job.components_updated}</span>
                            <span>{new Date(job.created_at).toLocaleString()}</span>
                            <span className="material-symbols-outlined text-xs">
                              {expandedJobId === job.id ? 'expand_less' : 'expand_more'}
                            </span>
                          </div>
                        </div>
                        {expandedJobId === job.id && (
                          <div className="border-t border-white/5 px-3 py-2">
                            {job.error && (
                              <div className="text-xs text-red-400 mb-2 bg-red-500/10 border border-red-500/30 rounded p-2">
                                <span className="font-bold">Error: </span>{job.error}
                              </div>
                            )}
                            <div className="bg-black/40 rounded p-3 max-h-60 overflow-y-auto font-mono text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap">
                              {job.log || (job.status === 'pending' ? 'Waiting to start...' : 'No logs available')}
                              <div ref={logEndRef} />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {settings.length === 0 && (
          <div className="text-center py-16 bg-card-dark rounded-xl border border-white/5">
            <span className="material-symbols-outlined text-4xl text-slate-600 mb-3 block">settings</span>
            <p className="text-slate-500 mb-4">No repository settings configured</p>
            <button onClick={openCreate} className="px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
              Add Repository
            </button>
          </div>
        )}
      </div>

      {/* Slide-out Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeForm} />
          <div className="relative w-full max-w-lg bg-background-dark border-l border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">
                {creating ? 'New Repository' : 'Edit Repository'}
              </h2>
              <button onClick={closeForm} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Git Repository URL</label>
                <input value={form.git_url} onChange={(e) => setForm((f) => ({ ...f, git_url: e.target.value }))}
                  placeholder="https://github.com/org/repo"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Branch</label>
                  <input value={form.git_branch} onChange={(e) => setForm((f) => ({ ...f, git_branch: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Update Frequency</label>
                  <select value={form.update_frequency} onChange={(e) => setForm((f) => ({ ...f, update_frequency: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none">
                    <option value="hourly">Hourly</option>
                    <option value="nightly">Nightly</option>
                    <option value="weekly">Weekly</option>
                    <option value="manual">Manual Only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Git Token (Personal Access Token)</label>
                <input type="password" value={form.git_token} onChange={(e) => setForm((f) => ({ ...f, git_token: e.target.value }))}
                  placeholder={editing ? '(leave blank to keep existing)' : 'ghp_...'}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Scan Paths (comma-separated)</label>
                <input value={form.scan_paths} onChange={(e) => setForm((f) => ({ ...f, scan_paths: e.target.value }))}
                  placeholder="., skills/, agents/"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">LLM Configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Provider</label>
                    <select value={form.llm_provider} onChange={(e) => setForm((f) => ({ ...f, llm_provider: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none">
                      <option value="openai">OpenAI</option>
                      <option value="ollama">Ollama (Local)</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Model</label>
                    <input value={form.llm_model} onChange={(e) => setForm((f) => ({ ...f, llm_model: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">LLM API Key</label>
                <input type="password" value={form.llm_api_key} onChange={(e) => setForm((f) => ({ ...f, llm_api_key: e.target.value }))}
                  placeholder={editing ? '(leave blank to keep existing)' : 'sk-...'}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.auto_update_release_tag}
                  onChange={(e) => setForm((f) => ({ ...f, auto_update_release_tag: e.target.checked }))}
                  className="rounded border-slate-600 text-primary focus:ring-primary bg-transparent" />
                <span className="text-sm text-slate-300">Auto-update release tag version</span>
              </label>

              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button onClick={handleSave} className="flex-1 px-6 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  {creating ? 'Add Repository' : 'Save Changes'}
                </button>
                <button onClick={closeForm} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SMTP Settings Modal */}
      {showSmtpModal && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSmtpModal(false)} />
          <div className="relative w-full max-w-lg bg-background-dark border-l border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">SMTP Email Configuration</h2>
              <button onClick={() => setShowSmtpModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">SMTP Server</label>
                <input value={smtpForm.smtp_server} onChange={(e) => setSmtpForm((f) => ({ ...f, smtp_server: e.target.value }))}
                  placeholder="smtp.gmail.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                <p className="text-xs text-slate-500 mt-1">Common: smtp.gmail.com, smtp.office365.com, smtp.sendgrid.net</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">SMTP Port</label>
                <input value={smtpForm.smtp_port} onChange={(e) => setSmtpForm((f) => ({ ...f, smtp_port: e.target.value }))}
                  placeholder="587"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                <p className="text-xs text-slate-500 mt-1">587 (STARTTLS), 465 (SSL), 25 (unencrypted)</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Username</label>
                <input value={smtpForm.smtp_user} onChange={(e) => setSmtpForm((f) => ({ ...f, smtp_user: e.target.value }))}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                <p className="text-xs text-slate-500 mt-1">Usually your full email address</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Password</label>
                <input type="password" value={smtpForm.smtp_password} onChange={(e) => setSmtpForm((f) => ({ ...f, smtp_password: e.target.value }))}
                  placeholder="(leave blank to keep existing)"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
                <p className="text-xs text-slate-500 mt-1">Gmail: Use App Password, not regular password</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">From Email</label>
                <input value={smtpForm.smtp_from_email} onChange={(e) => setSmtpForm((f) => ({ ...f, smtp_from_email: e.target.value }))}
                  placeholder="noreply@company.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">From Name</label>
                <input value={smtpForm.smtp_from_name} onChange={(e) => setSmtpForm((f) => ({ ...f, smtp_from_name: e.target.value }))}
                  placeholder="MST AI Portal"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Test Recipient Email</label>
                <input value={smtpForm.test_recipient} onChange={(e) => setSmtpForm((f) => ({ ...f, test_recipient: e.target.value }))}
                  placeholder="test@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none" />
              </div>

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
                  {smtpTesting ? 'Testing...' : 'Test'}
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
                      await fetchSmtpSettings(); // Refresh config display
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
                <button onClick={() => setShowSmtpModal(false)} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
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
