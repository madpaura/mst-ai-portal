import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { useAuth } from '../api/auth';
import { AdminArtifacts, GithubConfigPanel } from './AdminArtifacts';

// ── Component catalog types ────────────────────────────────────────────────────

interface ForgeComponent {
  id: string;
  slug: string;
  name: string;
  component_type: string;
  description: string | null;
  icon: string | null;
  icon_color: string | null;
  version: string;
  install_command: string;
  badge: string | null;
  author: string | null;
  downloads: number;
  tags: string[];
  is_active: boolean;
  howto_guide: string | null;
  howto_guide_url: string | null;
  video_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ComponentForm {
  slug: string;
  name: string;
  component_type: string;
  description: string;
  icon: string;
  icon_color: string;
  version: string;
  install_command: string;
  badge: string;
  author: string;
  tags: string;
  howto_guide: string;
  howto_guide_url: string;
  video_url: string;
}

const EMPTY_COMPONENT_FORM: ComponentForm = {
  slug: '', name: '', component_type: 'agent', description: '',
  icon: 'smart_toy', icon_color: 'text-primary',
  version: 'v1.0.0', install_command: '', badge: '', author: '', tags: '',
  howto_guide: '', howto_guide_url: '', video_url: '',
};

const ICON_OPTIONS = [
  'smart_toy', 'architecture', 'psychology', 'sync_alt', 'auto_timer',
  'energy_savings_leaf', 'description', 'terminal', 'memory', 'hub',
  'integration_instructions', 'developer_board', 'code', 'bug_report',
];

const COLOR_OPTIONS = [
  { label: 'Blue', value: 'text-primary' },
  { label: 'Amber', value: 'text-amber-500' },
  { label: 'Purple', value: 'text-purple-500' },
  { label: 'Rose', value: 'text-rose-500' },
  { label: 'Cyan', value: 'text-cyan-500' },
  { label: 'Indigo', value: 'text-indigo-500' },
  { label: 'Green', value: 'text-green-500' },
];

// ── Sync source types ──────────────────────────────────────────────────────────

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

interface SourceForm {
  git_url: string;
  git_token: string;
  git_branch: string;
  scan_paths: string;
  update_frequency: string;
  auto_update_release_tag: boolean;
}

const EMPTY_SOURCE_FORM: SourceForm = {
  git_url: '', git_token: '', git_branch: 'main',
  scan_paths: '.', update_frequency: 'nightly',
  auto_update_release_tag: true,
};

type Tab = 'overview' | 'components' | 'contribute' | 'sync-sources' | 'settings';

// ── Main component ─────────────────────────────────────────────────────────────

export const AdminMarketplace: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const isContent = !isAdmin && !!user;

  const [activeTab, setActiveTab] = useState<Tab>(isContent ? 'contribute' : 'overview');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Overview ──
  const [marketplaceStatus, setMarketplaceStatus] = useState<{ under_construction: boolean; message: string } | null>(null);
  const [marketplaceSaving, setMarketplaceSaving] = useState(false);
  const [marketplaceForm, setMarketplaceForm] = useState({ under_construction: false, message: '' });

  // ── Components ──
  const [components, setComponents] = useState<ForgeComponent[]>([]);
  const [compLoading, setCompLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [editingComp, setEditingComp] = useState<ForgeComponent | null>(null);
  const [creatingComp, setCreatingComp] = useState(false);
  const [compForm, setCompForm] = useState<ComponentForm>(EMPTY_COMPONENT_FORM);
  const [beautifying, setBeautifying] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);

  // ── Settings tab ──
  const [contributingVideoSlug, setContributingVideoSlug] = useState('');
  const [savingGuide, setSavingGuide] = useState(false);

  // ── Sync Sources ──
  const [sources, setSources] = useState<ForgeSetting[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [editingSource, setEditingSource] = useState<ForgeSetting | null>(null);
  const [creatingSource, setCreatingSource] = useState(false);
  const [sourceForm, setSourceForm] = useState<SourceForm>(EMPTY_SOURCE_FORM);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, { git: any; llm: any } | null>>({});
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // ── Fetch ──

  const fetchMarketplaceStatus = useCallback(async () => {
    try {
      const data = await api.get<{ under_construction: boolean; message: string } | null>('/settings/marketplace_status');
      if (data) {
        setMarketplaceStatus(data);
        setMarketplaceForm({ under_construction: data.under_construction, message: data.message || '' });
      }
    } catch { }
  }, []);

  const fetchComponents = useCallback(async () => {
    try {
      const data = await api.get<ForgeComponent[]>('/admin/forge/components');
      setComponents(data);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setCompLoading(false);
    }
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      const data = await api.get<ForgeSetting[]>('/admin/forge/settings');
      setSources(data);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  const fetchJobs = useCallback(async (sourceId: string) => {
    try {
      const data = await api.get<SyncJob[]>(`/admin/forge/settings/${sourceId}/jobs`);
      setJobs(data);
    } catch { }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchMarketplaceStatus();
      fetchComponents();
      fetchSources();
      api.get<{ video_slug: string | null }>('/forge/contributing-guide')
        .then(g => { if (g?.video_slug) setContributingVideoSlug(g.video_slug); })
        .catch(() => {});
    }
  }, [isAdmin, fetchMarketplaceStatus, fetchComponents, fetchSources]);

  useEffect(() => {
    if (selectedSourceId) fetchJobs(selectedSourceId);
  }, [selectedSourceId, fetchJobs]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (expandedJobId && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [jobs, expandedJobId]);

  // ── Overview handlers ──

  const handleMarketplaceSave = async () => {
    setMarketplaceSaving(true);
    try {
      await api.put('/settings/admin/marketplace_status', { value: marketplaceForm });
      setMarketplaceStatus(marketplaceForm);
      showMsg('success', 'Marketplace status saved');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setMarketplaceSaving(false);
    }
  };

  // ── Component handlers ──

  const handleBeautifyHowto = async () => {
    if (!compForm.howto_guide.trim()) return;
    setBeautifying(true);
    try {
      const result = await api.post<{ content: string }>('/admin/articles/beautify', { content: compForm.howto_guide });
      setCompForm(f => ({ ...f, howto_guide: result.content }));
      showMsg('success', 'Content beautified');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setBeautifying(false);
    }
  };

  const openCreateComp = () => { setEditingComp(null); setCompForm(EMPTY_COMPONENT_FORM); setCreatingComp(true); };

  const openEditComp = (comp: ForgeComponent) => {
    setCreatingComp(false);
    setEditingComp(comp);
    setCompForm({
      slug: comp.slug, name: comp.name, component_type: comp.component_type,
      description: comp.description || '', icon: comp.icon || 'smart_toy',
      icon_color: comp.icon_color || 'text-primary', version: comp.version,
      install_command: comp.install_command, badge: comp.badge || '',
      author: comp.author || '', tags: comp.tags.join(', '),
      howto_guide: comp.howto_guide || '', howto_guide_url: comp.howto_guide_url || '',
      video_url: comp.video_url || '',
    });
  };

  const closeCompForm = () => { setCreatingComp(false); setEditingComp(null); setCompForm(EMPTY_COMPONENT_FORM); };

  const handleSaveComp = async () => {
    const payload = {
      ...compForm,
      tags: compForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      badge: compForm.badge || null,
      description: compForm.description || null,
      howto_guide: compForm.howto_guide.trim() || null,
      howto_guide_url: compForm.howto_guide_url.trim() || null,
      video_url: compForm.video_url.trim() || null,
    };
    try {
      if (creatingComp) {
        await api.post('/admin/forge/components', payload);
        showMsg('success', 'Component created');
      } else if (editingComp) {
        await api.put(`/admin/forge/components/${editingComp.id}`, payload);
        showMsg('success', 'Component updated');
      }
      closeCompForm();
      await fetchComponents();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleToggleActive = async (comp: ForgeComponent) => {
    try {
      if (comp.is_active) {
        await api.post(`/admin/forge/components/${comp.id}/deactivate`);
      } else {
        await api.post(`/admin/forge/components/${comp.id}/activate`);
      }
      await fetchComponents();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteComp = async (comp: ForgeComponent) => {
    if (!confirm(`Permanently delete "${comp.name}"?`)) return;
    try {
      await api.delete(`/admin/forge/components/${comp.id}`);
      await fetchComponents();
      showMsg('success', 'Component deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteAllComps = async () => {
    try {
      await api.delete('/admin/forge/components');
      setDeleteAllConfirm(false);
      await fetchComponents();
      showMsg('success', 'All components deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSaveContributingGuide = async () => {
    setSavingGuide(true);
    try {
      await api.put('/settings/admin/marketplace_contributing_video', { value: contributingVideoSlug.trim() || null });
      showMsg('success', 'Contributing guide video saved');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSavingGuide(false);
    }
  };

  // ── Sync source handlers ──

  const openCreateSource = () => { setEditingSource(null); setSourceForm(EMPTY_SOURCE_FORM); setCreatingSource(true); };

  const openEditSource = (s: ForgeSetting) => {
    setCreatingSource(false);
    setEditingSource(s);
    setSourceForm({
      git_url: s.git_url, git_token: '', git_branch: s.git_branch,
      scan_paths: s.scan_paths.join(', '), update_frequency: s.update_frequency,
      auto_update_release_tag: s.auto_update_release_tag,
    });
  };

  const closeSourceForm = () => { setCreatingSource(false); setEditingSource(null); setSourceForm(EMPTY_SOURCE_FORM); };

  const handleSaveSource = async () => {
    const payload: any = {
      git_url: sourceForm.git_url, git_branch: sourceForm.git_branch,
      scan_paths: sourceForm.scan_paths.split(',').map(s => s.trim()).filter(Boolean),
      update_frequency: sourceForm.update_frequency,
      auto_update_release_tag: sourceForm.auto_update_release_tag,
    };
    if (sourceForm.git_token) payload.git_token = sourceForm.git_token;
    try {
      if (creatingSource) {
        await api.post('/admin/forge/settings', payload);
        showMsg('success', 'Source added');
      } else if (editingSource) {
        await api.put(`/admin/forge/settings/${editingSource.id}`, payload);
        showMsg('success', 'Source updated');
      }
      closeSourceForm();
      await fetchSources();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteSource = async (s: ForgeSetting) => {
    if (!confirm(`Delete source "${s.git_url}"?`)) return;
    try {
      await api.delete(`/admin/forge/settings/${s.id}`);
      await fetchSources();
      showMsg('success', 'Source deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSync = async (sourceId: string) => {
    setSyncing(v => ({ ...v, [sourceId]: true }));
    try {
      await api.post(`/admin/forge/settings/${sourceId}/sync`);
      showMsg('success', 'Sync started');
      setSelectedSourceId(sourceId);
      fetchJobs(sourceId);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const data = await api.get<SyncJob[]>(`/admin/forge/settings/${sourceId}/jobs`);
          setJobs(data);
          const running = data.some(j => j.status === 'running' || j.status === 'pending');
          if (!running) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setSyncing(v => ({ ...v, [sourceId]: false }));
          }
          const runningJob = data.find(j => j.status === 'running');
          if (runningJob) setExpandedJobId(runningJob.id);
        } catch { }
      }, 2000);
    } catch (err: any) {
      showMsg('error', err.message);
      setSyncing(v => ({ ...v, [sourceId]: false }));
    }
  };

  const handleVerify = async (sourceId: string) => {
    setVerifying(v => ({ ...v, [sourceId]: true }));
    setVerifyResults(v => ({ ...v, [sourceId]: null }));
    try {
      const res = await api.post<{ git: any; llm: any }>(`/admin/forge/settings/${sourceId}/verify`);
      setVerifyResults(v => ({ ...v, [sourceId]: res }));
    } catch (err: any) {
      const detail = err.message || 'Unknown error';
      setVerifyResults(v => ({
        ...v,
        [sourceId]: {
          git: { status: 'error', message: `Verification failed: ${detail}` },
          llm: { status: 'error', message: `Verification failed: ${detail}` },
        },
      }));
    } finally {
      setVerifying(v => ({ ...v, [sourceId]: false }));
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

  // ── Helpers ──

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      agent: 'bg-primary/20 text-primary border-primary/30',
      skill: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      mcp_server: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    };
    const labels: Record<string, string> = { agent: 'Agent', skill: 'Skill', mcp_server: 'MCP Server' };
    return (
      <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${colors[type] || 'bg-slate-700 text-slate-400'}`}>
        {labels[type] || type}
      </span>
    );
  };

  const filteredComponents = components.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !filterType || c.component_type === filterType;
    return matchesSearch && matchesType;
  });

  const showCompForm = creatingComp || !!editingComp;
  const showSourceForm = creatingSource || !!editingSource;

  const tabs: { id: Tab; label: string; icon: string }[] = [
    ...(isAdmin ? [
      { id: 'overview' as Tab, label: 'Overview', icon: 'storefront' },
      { id: 'components' as Tab, label: 'Components', icon: 'category' },
    ] : []),
    { id: 'contribute' as Tab, label: 'Contribute', icon: 'volunteer_activism' },
    ...(isAdmin ? [
      { id: 'sync-sources' as Tab, label: 'Sync Sources', icon: 'sync' },
      { id: 'settings' as Tab, label: 'Settings', icon: 'settings' },
    ] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Toast */}
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tab bar */}
      <div className="border-b border-slate-200 dark:border-white/10 bg-white dark:bg-sidebar-dark px-6 shrink-0">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-primary text-primary dark:text-primary'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-sm">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab panels */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Overview ── */}
        {activeTab === 'overview' && isAdmin && (
          <div className="p-6 lg:p-8 max-w-3xl mx-auto">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Marketplace Overview</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Control marketplace visibility for all users</p>
            </div>

            <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary">store</span>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">Marketplace Status</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Set under construction to show users a friendly notice</p>
                  </div>
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Under Construction</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={marketplaceForm.under_construction}
                    onClick={() => setMarketplaceForm(f => ({ ...f, under_construction: !f.under_construction }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      marketplaceForm.under_construction ? 'bg-amber-500' : 'bg-slate-700'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      marketplaceForm.under_construction ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </label>
              </div>

              {marketplaceForm.under_construction && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5 space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Message shown to users</label>
                    <textarea
                      rows={2}
                      value={marketplaceForm.message}
                      onChange={e => setMarketplaceForm(f => ({ ...f, message: e.target.value }))}
                      placeholder="We're upgrading the marketplace — check back soon!"
                      className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <span className="material-symbols-outlined text-amber-400 text-sm">warning</span>
                    <p className="text-xs text-amber-400">Marketplace will be hidden from all users until this is turned off.</p>
                  </div>
                </div>
              )}

              {(marketplaceStatus?.under_construction !== marketplaceForm.under_construction ||
                (marketplaceStatus?.message || '') !== marketplaceForm.message) && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5 flex gap-2">
                  <button
                    onClick={handleMarketplaceSave}
                    disabled={marketplaceSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">save</span>
                    {marketplaceSaving ? 'Saving…' : 'Save Status'}
                  </button>
                  <button
                    onClick={() => setMarketplaceForm({ under_construction: marketplaceStatus?.under_construction ?? false, message: marketplaceStatus?.message ?? '' })}
                    className="px-4 py-2 bg-muted-light dark:bg-muted-dark hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors"
                  >
                    Discard
                  </button>
                </div>
              )}

              {marketplaceStatus && (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <span className={`w-1.5 h-1.5 rounded-full ${marketplaceStatus.under_construction ? 'bg-amber-400' : 'bg-green-400'}`} />
                  {marketplaceStatus.under_construction ? 'Currently under construction' : 'Marketplace is live'}
                </div>
              )}
            </div>

            <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 p-6 mt-6">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">volunteer_activism</span>
                "Interested in Contributing?" Video Guide
              </h2>
              <p className="text-xs text-slate-500 mb-3">Set the video slug shown to users who want to contribute to the marketplace.</p>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="e.g. how-to-contribute-marketplace"
                  value={contributingVideoSlug}
                  onChange={e => setContributingVideoSlug(e.target.value)}
                  className="flex-1 max-w-sm px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:border-primary outline-none"
                />
                <button
                  onClick={handleSaveContributingGuide}
                  disabled={savingGuide}
                  className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {savingGuide
                    ? <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    : <span className="material-symbols-outlined text-sm">save</span>}
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Components ── */}
        {activeTab === 'components' && isAdmin && (
          <div className="p-6 lg:p-8 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Marketplace Catalog</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{components.length} component(s) in catalog</p>
              </div>
              <div className="flex items-center gap-2">
                {!deleteAllConfirm ? (
                  <button
                    onClick={() => setDeleteAllConfirm(true)}
                    disabled={components.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-sm">delete_sweep</span>
                    Delete All
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/40">
                    <span className="text-xs text-red-400 font-medium">Delete all {components.length} components?</span>
                    <button onClick={handleDeleteAllComps} className="px-3 py-1 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded transition-colors">Confirm</button>
                    <button onClick={() => setDeleteAllConfirm(false)} className="px-3 py-1 text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">Cancel</button>
                  </div>
                )}
                <button onClick={openCreateComp} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  <span className="material-symbols-outlined text-sm">add</span>
                  Add Component
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-6">
              <input
                type="text"
                placeholder="Search components..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="flex-1 max-w-sm px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:border-primary outline-none"
              />
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-primary outline-none"
              >
                <option value="">All Types</option>
                <option value="agent">Agents</option>
                <option value="skill">Skills</option>
                <option value="mcp_server">MCP Servers</option>
              </select>
            </div>

            {compLoading ? (
              <div className="text-center py-16 text-slate-400">Loading...</div>
            ) : (
              <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Component</th>
                      <th className="text-left px-4 py-3">Type</th>
                      <th className="text-left px-4 py-3">Version</th>
                      <th className="text-left px-4 py-3">Badge</th>
                      <th className="text-left px-4 py-3">Downloads</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredComponents.map(comp => (
                      <tr key={comp.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-panel-light dark:bg-input-dark border border-slate-200 dark:border-white/10 flex items-center justify-center">
                              <span className={`material-symbols-outlined text-base ${comp.icon_color || 'text-primary'}`}>{comp.icon || 'smart_toy'}</span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900 dark:text-white">{comp.name}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{comp.slug}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">{typeBadge(comp.component_type)}</td>
                        <td className="px-4 py-3 text-xs text-slate-300 font-mono">{comp.version}</td>
                        <td className="px-4 py-3">
                          {comp.badge
                            ? <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/20 text-green-400 border border-green-500/30 capitalize">{comp.badge}</span>
                            : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{comp.downloads}</td>
                        <td className="px-4 py-3">
                          {comp.is_active
                            ? <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400">Active</span>
                            : <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEditComp(comp)} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                            <button onClick={() => handleToggleActive(comp)} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
                              <span className="material-symbols-outlined text-sm">{comp.is_active ? 'visibility_off' : 'visibility'}</span>
                            </button>
                            <button onClick={() => handleDeleteComp(comp)} className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors">
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredComponents.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No components found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Contribute ── */}
        {activeTab === 'contribute' && (
          <AdminArtifacts embedded={true} />
        )}

        {/* ── Sync Sources ── */}
        {activeTab === 'sync-sources' && isAdmin && (
          <div className="p-6 lg:p-8 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Sync Sources</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Git repositories scanned to populate the marketplace catalog</p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSyncAll} className="flex items-center gap-2 px-4 py-2 bg-muted-light dark:bg-muted-dark hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold rounded-lg transition-colors border border-slate-300 dark:border-white/10">
                  <span className="material-symbols-outlined text-sm">sync</span>
                  Sync All
                </button>
                <button onClick={openCreateSource} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  <span className="material-symbols-outlined text-sm">add</span>
                  Add Repository
                </button>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              {sources.map(s => (
                <div key={s.id} className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="material-symbols-outlined text-primary">folder_open</span>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{s.git_url}</h3>
                        {s.is_active
                          ? <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400">Active</span>
                          : <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>}
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">commit</span>{s.git_branch}</span>
                        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">schedule</span>{s.update_frequency}</span>
                        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">key</span>Token: {s.git_token || 'not set'}</span>
                        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">new_releases</span>Auto-tag: {s.auto_update_release_tag ? 'On' : 'Off'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleVerify(s.id)} disabled={verifying[s.id]} className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-green-400 transition-colors disabled:opacity-40" title="Verify connection">
                        <span className={`material-symbols-outlined text-sm ${verifying[s.id] ? 'animate-spin' : ''}`}>{verifying[s.id] ? 'progress_activity' : 'verified'}</span>
                      </button>
                      <button onClick={() => handleSync(s.id)} disabled={syncing[s.id]} className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-primary transition-colors disabled:opacity-40" title="Trigger sync">
                        <span className={`material-symbols-outlined text-sm ${syncing[s.id] ? 'animate-spin' : ''}`}>{syncing[s.id] ? 'progress_activity' : 'sync'}</span>
                      </button>
                      <button onClick={() => setSelectedSourceId(selectedSourceId === s.id ? null : s.id)} className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors" title="View sync jobs">
                        <span className="material-symbols-outlined text-sm">history</span>
                      </button>
                      <button onClick={() => openEditSource(s)} className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-sm">edit</span>
                      </button>
                      <button onClick={() => handleDeleteSource(s)} className="p-2 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors">
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  </div>

                  {verifyResults[s.id] && (
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Connection Verification</h4>
                        <button onClick={() => setVerifyResults(v => ({ ...v, [s.id]: null }))} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                      <div className="space-y-2">
                        {(['git', 'llm'] as const).map(key => {
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

                  {selectedSourceId === s.id && (
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5">
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Recent Sync Jobs</h4>
                      {jobs.length === 0 ? (
                        <p className="text-xs text-slate-500">No sync jobs yet</p>
                      ) : (
                        <div className="space-y-2">
                          {jobs.map(job => (
                            <div key={job.id} className="bg-slate-100/50 dark:bg-slate-900/50 rounded-lg overflow-hidden">
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
                                  <span className="material-symbols-outlined text-xs">{expandedJobId === job.id ? 'expand_less' : 'expand_more'}</span>
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

              {!sourcesLoading && sources.length === 0 && (
                <div className="text-center py-16 bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5">
                  <span className="material-symbols-outlined text-4xl text-slate-600 mb-3 block">sync</span>
                  <p className="text-slate-500 mb-4">No sync sources configured</p>
                  <button onClick={openCreateSource} className="px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                    Add Repository
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Settings ── */}
        {activeTab === 'settings' && isAdmin && (
          <div className="p-6 lg:p-8 max-w-4xl mx-auto">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Marketplace Settings</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Artifact Hub publish targets and contributor guide</p>
            </div>

            <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
              <GithubConfigPanel />
            </div>
          </div>
        )}
      </div>

      {/* ── Component form slide-out ── */}
      {showCompForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeCompForm} />
          <div className="relative w-full max-w-lg bg-background-light dark:bg-background-dark border-l border-slate-200 dark:border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {creatingComp ? 'New Component' : `Edit: ${editingComp?.name}`}
              </h2>
              <button onClick={closeCompForm} className="text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Name</label>
                  <input value={compForm.name} onChange={e => setCompForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Slug</label>
                  <input value={compForm.slug} onChange={e => setCompForm(f => ({ ...f, slug: e.target.value }))}
                    disabled={!!editingComp}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none disabled:opacity-50" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Type</label>
                  <select value={compForm.component_type} onChange={e => setCompForm(f => ({ ...f, component_type: e.target.value }))}
                    disabled={!!editingComp}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none disabled:opacity-50">
                    <option value="agent">Agent</option>
                    <option value="skill">Skill</option>
                    <option value="mcp_server">MCP Server</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Version</label>
                  <input value={compForm.version} onChange={e => setCompForm(f => ({ ...f, version: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Description</label>
                <textarea value={compForm.description} onChange={e => setCompForm(f => ({ ...f, description: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    How-To Guide
                    <span className="ml-1 text-[10px] normal-case text-slate-500 font-normal">(Markdown)</span>
                  </label>
                  <button
                    onClick={handleBeautifyHowto}
                    disabled={beautifying || !compForm.howto_guide.trim()}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded transition-colors disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>{beautifying ? 'autorenew' : 'auto_fix_high'}</span>
                    {beautifying ? 'Beautifying…' : 'Beautify'}
                  </button>
                </div>
                <textarea value={compForm.howto_guide} onChange={e => setCompForm(f => ({ ...f, howto_guide: e.target.value }))}
                  rows={6} placeholder="## Getting Started&#10;&#10;Step-by-step guide in Markdown..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none font-mono" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Install Command</label>
                <input value={compForm.install_command} onChange={e => setCompForm(f => ({ ...f, install_command: e.target.value }))}
                  placeholder="forge install my-agent"
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none font-mono" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Icon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICON_OPTIONS.map(icon => (
                      <button
                        key={icon}
                        onClick={() => setCompForm(f => ({ ...f, icon }))}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-all ${
                          compForm.icon === icon ? 'bg-primary/20 border border-primary/50 ring-1 ring-primary/30' : 'bg-panel-light dark:bg-panel-dark border border-slate-100 dark:border-white/5 hover:border-primary/30 dark:hover:border-white/20'
                        }`}
                      >
                        <span className={`material-symbols-outlined text-sm ${compForm.icon === icon ? 'text-primary' : 'text-slate-400'}`}>{icon}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Icon Color</label>
                  <select value={compForm.icon_color} onChange={e => setCompForm(f => ({ ...f, icon_color: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                    {COLOR_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Badge</label>
                  <select value={compForm.badge} onChange={e => setCompForm(f => ({ ...f, badge: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                    <option value="">None</option>
                    <option value="verified">Verified</option>
                    <option value="community">Community</option>
                    <option value="open_source">Open Source</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Author</label>
                  <input value={compForm.author} onChange={e => setCompForm(f => ({ ...f, author: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Tags (comma-separated)</label>
                <input value={compForm.tags} onChange={e => setCompForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="verification, systemverilog, uvm"
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  How-To Guide URL
                  <span className="ml-1 text-[10px] normal-case text-slate-500 font-normal">(overrides scanned guide)</span>
                </label>
                <input value={compForm.howto_guide_url} onChange={e => setCompForm(f => ({ ...f, howto_guide_url: e.target.value }))}
                  placeholder="https://docs.example.com/guide" type="url"
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Video Link
                  <span className="ml-1 text-[10px] normal-case text-slate-500 font-normal">(YouTube, Vimeo — shown as Watch button)</span>
                </label>
                <input value={compForm.video_url} onChange={e => setCompForm(f => ({ ...f, video_url: e.target.value }))}
                  placeholder="https://youtube.com/watch?v=..." type="url"
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-white/10">
                <button onClick={handleSaveComp} className="flex-1 px-6 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  {creatingComp ? 'Create Component' : 'Save Changes'}
                </button>
                <button onClick={closeCompForm} className="px-6 py-2.5 bg-muted-light dark:bg-muted-dark hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sync source form slide-out ── */}
      {showSourceForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeSourceForm} />
          <div className="relative w-full max-w-lg bg-background-light dark:bg-background-dark border-l border-slate-200 dark:border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {creatingSource ? 'New Repository' : 'Edit Repository'}
              </h2>
              <button onClick={closeSourceForm} className="text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Git Repository URL</label>
                <input value={sourceForm.git_url} onChange={e => setSourceForm(f => ({ ...f, git_url: e.target.value }))}
                  placeholder="https://github.com/org/repo"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Branch</label>
                  <input value={sourceForm.git_branch} onChange={e => setSourceForm(f => ({ ...f, git_branch: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Update Frequency</label>
                  <select value={sourceForm.update_frequency} onChange={e => setSourceForm(f => ({ ...f, update_frequency: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                    <option value="hourly">Hourly</option>
                    <option value="nightly">Nightly</option>
                    <option value="weekly">Weekly</option>
                    <option value="manual">Manual Only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Git Token (Personal Access Token)</label>
                <input type="password" value={sourceForm.git_token} onChange={e => setSourceForm(f => ({ ...f, git_token: e.target.value }))}
                  placeholder={editingSource ? '(leave blank to keep existing)' : 'ghp_...'}
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Scan Paths (comma-separated)</label>
                <input value={sourceForm.scan_paths} onChange={e => setSourceForm(f => ({ ...f, scan_paths: e.target.value }))}
                  placeholder="., skills/, agents/"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={sourceForm.auto_update_release_tag}
                  onChange={e => setSourceForm(f => ({ ...f, auto_update_release_tag: e.target.checked }))}
                  className="rounded border-slate-600 text-primary focus:ring-primary bg-transparent" />
                <span className="text-sm text-slate-700 dark:text-slate-300">Auto-update release tag version</span>
              </label>

              <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-white/10">
                <button onClick={handleSaveSource} className="flex-1 px-6 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  {creatingSource ? 'Add Repository' : 'Save Changes'}
                </button>
                <button onClick={closeSourceForm} className="px-6 py-2.5 bg-muted-light dark:bg-muted-dark hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
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
