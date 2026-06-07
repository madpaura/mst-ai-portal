import React, { useState, useEffect, useCallback, useRef, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import JSZip from 'jszip';
import { useSearchParams } from 'react-router-dom';
import { api, toApiError } from '../api/client';
import { useAuth } from '../api/auth';

// ── Types ─────────────────────────────────────────────────────────────────────

type ArtifactType = 'agent' | 'skill' | 'mcp';
type ArtifactStatus = 'draft' | 'pending' | 'approved' | 'published' | 'rejected';

interface ArtifactFile {
  name: string;
  content: string;
}

interface ValidationIssue {
  severity: 'error' | 'warning';
  file: string;
  line: number | null;
  message: string;
  pattern: string;
}

interface ValidationResult {
  passed: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface Artifact {
  id: string;
  name: string;
  display_name: string;
  artifact_type: ArtifactType;
  description: string | null;
  instructions: string | null;
  files: ArtifactFile[];
  tags: string[];
  status: ArtifactStatus;
  validation_results: ValidationResult | null;
  submitted_by_id: string | null;
  submitted_by_name: string | null;
  github_url: string | null;
  reject_reason: string | null;
  parent_slug: string | null;
  version_tag: string | null;
  created_at: string;
  updated_at: string;
}

interface ArtifactVersion {
  id: string;
  name: string;
  artifact_type: ArtifactType;
  version: string;
  description: string | null;
  instructions: string | null;
  files: ArtifactFile[];
  tags: string[];
  github_url: string | null;
  published_by_name: string | null;
  published_at: string;
}

interface GithubTypeConfig {
  url: string;
  branch: string;
  folder: string;
  token: string;
}

interface GithubConfig {
  agent: GithubTypeConfig;
  skill: GithubTypeConfig;
  mcp: GithubTypeConfig;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ArtifactType, string> = { agent: 'Agent', skill: 'Skill', mcp: 'MCP Server' };
const TYPE_ICONS: Record<ArtifactType, string> = { agent: 'smart_toy', skill: 'terminal', mcp: 'hub' };
const TYPE_COLORS: Record<ArtifactType, string> = {
  agent: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  skill: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  mcp: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
};

const STATUS_COLORS: Record<ArtifactStatus, string> = {
  draft:     'text-slate-400 bg-slate-400/10 border-slate-400/30',
  pending:   'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  approved:  'text-blue-400 bg-blue-400/10 border-blue-400/30',
  published: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  rejected:  'text-red-400 bg-red-400/10 border-red-400/30',
};

const EMPTY_GITHUB_CONFIG: GithubConfig = {
  agent: { url: '', branch: 'main', folder: 'agents', token: '' },
  skill: { url: '', branch: 'main', folder: 'skills', token: '' },
  mcp:   { url: '', branch: 'main', folder: 'mcp',    token: '' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

function slugify(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Main component ────────────────────────────────────────────────────────────

export const AdminArtifacts: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { user, isAdmin } = useAuth();
  const [urlParams] = useSearchParams();
  const initialParentSlug = urlParams.get('parent_slug') || '';
  const initialParentType = (urlParams.get('parent_type') || 'skill') as ArtifactType;
  const [tab, setTab] = useState<'list' | 'pick' | 'new' | 'config'>(initialParentSlug ? 'new' : 'list');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [allowedTypes, setAllowedTypes] = useState<ArtifactType[]>(['agent', 'skill', 'mcp']);
  const [pickedType, setPickedType] = useState<ArtifactType>('agent');

  useEffect(() => {
    api.get<{ allowed: ArtifactType[] }>('/admin/artifacts/allowed-types')
      .then(d => { if (d.allowed?.length) setAllowedTypes(d.allowed); })
      .catch(() => {});
  }, []);

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType)   params.set('artifact_type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      const data = await api.get<Artifact[]>(`/admin/artifacts?${params}`);
      setArtifacts(data);
    } catch { /* ignore */ } finally {
      setLoading(false); }
  }, [filterType, filterStatus]);

  useEffect(() => { fetchArtifacts(); }, [fetchArtifacts]);

  const handleCreated = (a: Artifact) => {
    setIsEditing(false);
    setTab('list');
    setSelected(a);
    fetchArtifacts();
  };

  const trySelectArtifact = (a: Artifact) => {
    if (isEditing && selected?.id !== a.id) {
      if (!confirm('You have unsaved changes. Discard and switch to this artifact?')) return;
      setIsEditing(false);
    }
    setSelected(a);
    setTab('list');
  };

  return (
    <div className={`flex h-full ${embedded ? '' : 'min-h-screen'}`}>
      {/* Left panel — list */}
      <div className="w-80 shrink-0 border-r border-slate-200 dark:border-white/10 bg-sidebar-light dark:bg-sidebar-dark flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Artifact Hub</h2>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  if (isEditing && !confirm('Discard unsaved changes?')) return;
                  setIsEditing(false);
                  setSelected(null);
                  // One allowed type → skip the picker; otherwise confirm the type first
                  if (allowedTypes.length === 1) {
                    setPickedType(allowedTypes[0]);
                    setTab('new');
                  } else {
                    setTab('pick');
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                New
              </button>
              {isAdmin && !embedded && (
                <button
                  onClick={() => setTab('config')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${tab === 'config' ? 'bg-white/20 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'}`}
                >
                  <span className="material-symbols-outlined text-sm">settings</span>
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-primary/50"
            >
              <option value="">All types</option>
              <option value="agent">Agent</option>
              <option value="skill">Skill</option>
              <option value="mcp">MCP Server</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-primary/50"
            >
              <option value="">All status</option>
              <option value="draft">Draft</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="published">Published</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-slate-500 text-sm">Loading…</div>
          ) : artifacts.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-sm">No submissions yet</div>
          ) : (
            artifacts.map(a => (
              <button
                key={a.id}
                onClick={() => trySelectArtifact(a)}
                className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors hover:bg-white/5 ${selected?.id === a.id ? 'bg-primary/10 border-l-2 border-l-primary' : ''}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-slate-900 dark:text-white truncate">{a.display_name}</span>
                  <Badge label={a.status} cls={STATUS_COLORS[a.status]} />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-sm ${TYPE_COLORS[a.artifact_type].split(' ')[0]}`}>
                    {TYPE_ICONS[a.artifact_type]}
                  </span>
                  <span className="text-xs text-slate-500">{TYPE_LABELS[a.artifact_type]}</span>
                  {a.submitted_by_name && (
                    <span className="text-xs text-slate-600">· {a.submitted_by_name}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto bg-background-light dark:bg-background-dark">
        {tab === 'config' && isAdmin ? (
          <GithubConfigPanel />
        ) : tab === 'pick' ? (
          <TypePicker
            allowed={allowedTypes}
            onPick={(t) => { setPickedType(t); setTab('new'); }}
            onCancel={() => setTab('list')}
          />
        ) : tab === 'new' ? (
          <NewArtifactForm
            onCreated={handleCreated}
            onCancel={() => setTab('list')}
            onChangeType={() => setTab('pick')}
            initialParentSlug={initialParentSlug}
            initialParentType={initialParentType}
            initialType={pickedType}
            canChangeType={allowedTypes.length > 1}
          />
        ) : selected ? (
          <ArtifactDetail
            artifact={selected}
            isAdmin={isAdmin}
            currentUserId={user?.id || ''}
            onEditModeChange={setIsEditing}
            onRefresh={async () => {
              await fetchArtifacts();
              const fresh = await api.get<Artifact>(`/admin/artifacts/${selected.id}`);
              setSelected(fresh);
            }}
            onDelete={() => { setIsEditing(false); setSelected(null); fetchArtifacts(); }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-96 text-slate-500">
            <span className="material-symbols-outlined text-5xl mb-3">hub</span>
            <p className="text-sm">Select an artifact or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Detail panel ──────────────────────────────────────────────────────────────

const ArtifactDetail: React.FC<{
  artifact: Artifact;
  isAdmin: boolean;
  currentUserId: string;
  onEditModeChange: (v: boolean) => void;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
}> = ({ artifact, isAdmin, currentUserId, onEditModeChange, onRefresh, onDelete }) => {
  const [detailTab, setDetailTab] = useState<'overview' | 'files' | 'instructions' | 'history'>('overview');
  const [versions, setVersions] = useState<ArtifactVersion[] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [toast, setToast] = useState('');
  const [editData, setEditData] = useState({
    display_name: artifact.display_name,
    description: artifact.description || '',
    instructions: artifact.instructions || '',
    tags: artifact.tags.join(', '),
    files: artifact.files,
  });

  const isOwner = artifact.submitted_by_id === currentUserId;
  const canEdit = (isOwner || isAdmin) && ['draft', 'rejected'].includes(artifact.status);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Reset transient tab state when switching to a different artifact.
  useEffect(() => { setVersions(null); setDetailTab('overview'); }, [artifact.id]);

  // Lazy-load version history the first time the History tab is opened.
  useEffect(() => {
    if (detailTab !== 'history' || versions !== null) return;
    api.get<ArtifactVersion[]>(`/admin/artifacts/${artifact.id}/versions`)
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [detailTab, versions, artifact.id]);

  const handleValidate = async () => {
    setValidating(true);
    try {
      await api.post(`/admin/artifacts/${artifact.id}/validate`, {});
      await onRefresh();
      showToast('Validation complete');
    } catch (e: unknown) {
      showToast(`Validation failed: ${toApiError(e) || 'error'}`);
    } finally { setValidating(false); }
  };

  const handleAction = async (action: string, body?: object) => {
    setActionLoading(action);
    try {
      await api.post(`/admin/artifacts/${artifact.id}/${action}`, body || {});
      await onRefresh();
      showToast(`${action.charAt(0).toUpperCase() + action.slice(1)} successful`);
      setShowRejectBox(false);
    } catch (e: unknown) {
      showToast(toApiError(e) || 'Action failed');
    } finally { setActionLoading(''); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/artifacts/${artifact.id}`, {
        display_name: editData.display_name,
        description: editData.description,
        instructions: editData.instructions,
        tags: editData.tags.split(',').map(t => t.trim()).filter(Boolean),
        files: editData.files,
      });
      await onRefresh();
      setEditMode(false);
      onEditModeChange(false);
      showToast('Saved');
    } catch (e: unknown) {
      showToast(toApiError(e) || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    const wasPublished = artifact.status === 'published' || !!artifact.github_url;
    const msg = wasPublished
      ? `Delete "${artifact.display_name}"?\n\nThis also removes its folder from GitHub (and its MANIFEST.json / README.md entry) and deactivates the marketplace card. This cannot be undone.`
      : 'Delete this submission?';
    if (!confirm(msg)) return;
    try {
      await api.delete(`/admin/artifacts/${artifact.id}`);
      onDelete();
    } catch (e: unknown) { showToast(toApiError(e) || 'Delete failed'); }
  };

  const vr = artifact.validation_results;

  return (
    <div className="p-6 max-w-4xl">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg bg-primary text-white text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`material-symbols-outlined text-xl ${TYPE_COLORS[artifact.artifact_type].split(' ')[0]}`}>
              {TYPE_ICONS[artifact.artifact_type]}
            </span>
            <Badge label={TYPE_LABELS[artifact.artifact_type]} cls={TYPE_COLORS[artifact.artifact_type]} />
            <Badge label={artifact.status} cls={STATUS_COLORS[artifact.status]} />
          </div>
          {editMode ? (
            <input
              className="text-xl font-bold bg-white/5 border border-white/20 rounded px-3 py-1 text-white w-full focus:outline-none focus:border-primary/50"
              value={editData.display_name}
              onChange={e => setEditData(d => ({ ...d, display_name: e.target.value }))}
            />
          ) : (
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{artifact.display_name}</h1>
          )}
          <p className="text-xs text-slate-500 mt-1 font-mono">{artifact.name}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canEdit && !editMode && (
            <button
              onClick={() => { setEditMode(true); onEditModeChange(true); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-white/10 text-slate-300 text-xs font-medium hover:bg-white/20 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              Edit
            </button>
          )}
          {editMode && (
            <>
              <button
                onClick={() => { setEditMode(false); onEditModeChange(false); }}
                className="px-3 py-1.5 rounded bg-white/10 text-slate-400 text-xs hover:bg-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 rounded bg-primary/80 text-white text-xs font-medium hover:bg-primary transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
          {(isAdmin || isOwner) && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-red-400 hover:bg-red-400/10 text-xs transition-colors"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-6 p-3 rounded-lg bg-white/5 border border-white/10">
        {(isOwner || isAdmin) && ['draft', 'rejected'].includes(artifact.status) && (
          <button
            onClick={handleValidate}
            disabled={validating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">verified_user</span>
            {validating ? 'Validating…' : 'Validate'}
          </button>
        )}

        {(isOwner || isAdmin) && ['draft', 'rejected'].includes(artifact.status) && (
          <button
            onClick={() => handleAction('submit')}
            disabled={!!actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 text-xs font-medium hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">send</span>
            {actionLoading === 'submit' ? 'Submitting…' : 'Submit for Review'}
          </button>
        )}

        {isAdmin && artifact.status === 'pending' && (
          <>
            <button
              onClick={() => handleAction('approve')}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">thumb_up</span>
              {actionLoading === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              onClick={() => setShowRejectBox(!showRejectBox)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-medium hover:bg-red-500/30 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">thumb_down</span>
              Reject
            </button>
          </>
        )}

        {isAdmin && artifact.status === 'approved' && (
          <button
            onClick={() => handleAction('publish')}
            disabled={!!actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">rocket_launch</span>
            {actionLoading === 'publish' ? 'Publishing…' : 'Publish to GitHub'}
          </button>
        )}

        {artifact.status === 'published' && artifact.github_url && (
          <a
            href={artifact.github_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            View on GitHub
          </a>
        )}
      </div>

      {/* Reject box */}
      {showRejectBox && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-xs text-red-400 mb-2 font-medium">Rejection reason (optional)</p>
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-red-500/50 resize-none"
            rows={2}
            placeholder="Explain why…"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
          />
          <button
            onClick={() => handleAction('reject', { reason: rejectReason })}
            disabled={!!actionLoading}
            className="mt-2 px-3 py-1.5 rounded bg-red-500/30 text-red-300 text-xs font-medium hover:bg-red-500/50 transition-colors disabled:opacity-50"
          >
            {actionLoading === 'reject' ? 'Rejecting…' : 'Confirm Reject'}
          </button>
        </div>
      )}

      {/* Reject reason display */}
      {artifact.status === 'rejected' && artifact.reject_reason && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-xs text-red-400 font-medium mb-1">Rejection reason</p>
          <p className="text-sm text-red-300">{artifact.reject_reason}</p>
        </div>
      )}

      {/* Validation results */}
      {vr && (
        <div className={`mb-4 p-3 rounded-lg border ${vr.passed ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`material-symbols-outlined text-sm ${vr.passed ? 'text-emerald-400' : 'text-red-400'}`}>
              {vr.passed ? 'verified' : 'dangerous'}
            </span>
            <span className={`text-xs font-bold ${vr.passed ? 'text-emerald-400' : 'text-red-400'}`}>
              {vr.passed
                ? `Validation passed${vr.warnings.length ? ` (${vr.warnings.length} warning${vr.warnings.length > 1 ? 's' : ''})` : ''}`
                : `${vr.errors.length} error${vr.errors.length > 1 ? 's' : ''} found — fix before submitting`}
            </span>
          </div>
          {[...vr.errors, ...vr.warnings].map((issue, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs py-1 ${issue.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}`}>
              <span className="material-symbols-outlined text-xs mt-0.5">
                {issue.severity === 'error' ? 'error' : 'warning'}
              </span>
              <span>
                <span className="font-mono font-bold">{issue.file}</span>
                {issue.line && <span className="text-slate-500">:{issue.line}</span>}
                {' — '}{issue.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/10">
        {(['overview', 'files', 'instructions', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setDetailTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${detailTab === t ? 'text-white border-b-2 border-primary' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'files' && ` (${artifact.files.length})`}
            {t === 'history' && versions !== null && ` (${versions.length})`}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {detailTab === 'overview' && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Description</p>
            {editMode ? (
              <textarea
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary/50 resize-none"
                rows={4}
                value={editData.description}
                onChange={e => setEditData(d => ({ ...d, description: e.target.value }))}
                placeholder="Describe what this artifact does…"
              />
            ) : (
              <p className="text-sm text-slate-300 whitespace-pre-wrap">
                {artifact.description || <span className="text-slate-600 italic">No description</span>}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Tags</p>
            {editMode ? (
              <input
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary/50"
                value={editData.tags}
                onChange={e => setEditData(d => ({ ...d, tags: e.target.value }))}
                placeholder="comma, separated, tags"
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {artifact.tags.length ? artifact.tags.map(t => (
                  <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-slate-400 border border-white/10">{t}</span>
                )) : <span className="text-slate-600 italic text-sm">No tags</span>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 text-xs text-slate-500">
            <div>
              <span className="block font-medium text-slate-400 mb-0.5">Submitted by</span>
              {artifact.submitted_by_name || 'Unknown'}
            </div>
            <div>
              <span className="block font-medium text-slate-400 mb-0.5">Last updated</span>
              {new Date(artifact.updated_at).toLocaleString()}
            </div>
            {artifact.parent_slug && (
              <div>
                <span className="block font-medium text-slate-400 mb-0.5">Updating component</span>
                <span className="font-mono text-primary">{artifact.parent_slug}</span>
              </div>
            )}
            {artifact.version_tag && (
              <div>
                <span className="block font-medium text-slate-400 mb-0.5">Version</span>
                <span className="font-mono text-emerald-400">v{artifact.version_tag}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Files */}
      {detailTab === 'files' && (
        <div>
          {editMode ? (
            <FilesEditor
              files={editData.files}
              onChange={files => setEditData(d => ({ ...d, files }))}
            />
          ) : (
            <FilesViewer files={artifact.files} />
          )}
        </div>
      )}

      {/* Tab: Instructions */}
      {detailTab === 'instructions' && (
        <div>
          {editMode ? (
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 font-mono focus:outline-none focus:border-primary/50 resize-none"
              rows={20}
              value={editData.instructions}
              onChange={e => setEditData(d => ({ ...d, instructions: e.target.value }))}
              placeholder="Write usage instructions in Markdown…"
            />
          ) : artifact.instructions ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.instructions}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
              <span className="material-symbols-outlined text-4xl mb-2 block">description</span>
              <p className="text-sm">No instructions added yet</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: History */}
      {detailTab === 'history' && <VersionHistory versions={versions} />}
    </div>
  );
};

// ── Version history (read-only) ───────────────────────────────────────────────

const VersionHistory: React.FC<{ versions: ArtifactVersion[] | null }> = ({ versions }) => {
  const [openId, setOpenId] = useState<string | null>(null);

  if (versions === null) {
    return <div className="py-12 text-center text-slate-500 text-sm">Loading history…</div>;
  }
  if (versions.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <span className="material-symbols-outlined text-4xl mb-2 block">history</span>
        <p className="text-sm">No published versions yet</p>
        <p className="text-xs text-slate-600 mt-1">A snapshot is recorded each time this artifact is published.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {versions.map((v, i) => {
        const isOpen = openId === v.id;
        return (
          <div key={v.id} className="border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenId(isOpen ? null : v.id)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 transition-colors text-left"
            >
              <span className="font-mono text-sm font-bold text-emerald-400">v{v.version}</span>
              {i === 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">latest</span>
              )}
              <span className="text-xs text-slate-500 flex-1 truncate">
                {v.published_by_name || 'Unknown'} · {new Date(v.published_at).toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">{v.files.length} file{v.files.length === 1 ? '' : 's'}</span>
              <span className="material-symbols-outlined text-slate-500 text-sm">{isOpen ? 'expand_less' : 'expand_more'}</span>
            </button>
            {isOpen && (
              <div className="p-4 space-y-3 border-t border-slate-200 dark:border-white/10">
                {v.description && <p className="text-sm text-slate-600 dark:text-slate-300">{v.description}</p>}
                <div className="flex items-center gap-3">
                  {v.github_url && (
                    <a href={v.github_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <span className="material-symbols-outlined text-sm">open_in_new</span>
                      View on GitHub
                    </a>
                  )}
                </div>
                <FilesViewer files={v.files} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Files viewer ──────────────────────────────────────────────────────────────

const FilesViewer: React.FC<{ files: ArtifactFile[] }> = ({ files }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!files.length) return (
    <div className="text-center py-12 text-slate-500">
      <span className="material-symbols-outlined text-4xl mb-2 block">folder_open</span>
      <p className="text-sm">No files uploaded</p>
    </div>
  );
  return (
    <div className="space-y-2">
      {files.map((f, i) => {
        const isOpen = expanded.has(f.name);
        return (
          <div key={i} className="border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(s => { const n = new Set(s); isOpen ? n.delete(f.name) : n.add(f.name); return n; })}
              className="w-full flex items-center gap-3 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 transition-colors text-left"
            >
              <span className="material-symbols-outlined text-slate-500 dark:text-slate-400 text-sm">description</span>
              <span className="text-sm font-mono text-slate-700 dark:text-slate-300 flex-1">{f.name}</span>
              <span className="text-xs text-slate-500 dark:text-slate-600">{f.content.length.toLocaleString()} chars</span>
              <span className="material-symbols-outlined text-slate-500 text-sm">{isOpen ? 'expand_less' : 'expand_more'}</span>
            </button>
            {isOpen && (
              <pre className="px-4 py-3 overflow-x-auto text-xs text-slate-900 dark:text-slate-300 bg-slate-100 dark:bg-black/20 font-mono leading-relaxed max-h-96 overflow-y-auto">
                {f.content}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Skip patterns for ZIP extraction ─────────────────────────────────────────

const ZIP_SKIP_PATTERNS = [
  /^\./, /__pycache__/, /\.pyc$/, /\.pyo$/, /node_modules\//,
  /\.git\//, /\.DS_Store$/, /Thumbs\.db$/, /\.egg-info\//,
  /dist\//, /build\//,
];

function shouldSkipZipEntry(path: string): boolean {
  const parts = path.split('/');
  return parts.some(p => ZIP_SKIP_PATTERNS.some(rx => rx.test(p))) ||
    ZIP_SKIP_PATTERNS.some(rx => rx.test(path));
}

/** Strip the longest common path prefix shared by all files. */
function stripCommonPrefix(files: ArtifactFile[]): ArtifactFile[] {
  if (files.length === 0) return files;
  const split = files.map(f => f.name.split('/'));
  const minDepth = Math.min(...split.map(p => p.length));
  let stripLevels = 0;
  for (let i = 0; i < minDepth - 1; i++) {
    if (split.every(p => p[i] === split[0][i])) stripLevels++;
    else break;
  }
  if (stripLevels === 0) return files;
  return files.map(f => ({ ...f, name: f.name.split('/').slice(stripLevels).join('/') }));
}

interface DropResult {
  files: ArtifactFile[];
  skipped: string[];
  /** Set when the drop contained exactly one ZIP file. */
  zipName?: string;
}

async function readFilesFromDrop(fileList: File[]): Promise<DropResult> {
  const files: ArtifactFile[] = [];
  const skipped: string[] = [];
  let zipName: string | undefined;

  for (const file of fileList) {
    const isZip = file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

    if (isZip) {
      if (fileList.length === 1) zipName = file.name;
      const zip = await JSZip.loadAsync(file);
      const rawFiles: ArtifactFile[] = [];
      const entries = Object.entries(zip.files).filter(([, e]) => !e.dir);
      for (const [path, entry] of entries) {
        if (shouldSkipZipEntry(path)) { skipped.push(path); continue; }
        try {
          const content = await entry.async('string');
          if (content.includes('\x00')) { skipped.push(`${path} (binary)`); continue; }
          rawFiles.push({ name: path, content });
        } catch {
          skipped.push(`${path} (unreadable)`);
        }
      }
      // Strip any common leading folder (e.g. "myproject-1.0/" wrapping from GitHub ZIPs)
      const stripped = stripCommonPrefix(rawFiles);
      files.push(...stripped);
    } else {
      try {
        const content = await file.text();
        if (content.includes('\x00')) { skipped.push(`${file.name} (binary)`); continue; }
        files.push({ name: file.name, content });
      } catch {
        skipped.push(`${file.name} (unreadable)`);
      }
    }
  }

  return { files, skipped, zipName };
}

// ── Files editor ──────────────────────────────────────────────────────────────

const FilesEditor: React.FC<{
  files: ArtifactFile[];
  onChange: (files: ArtifactFile[]) => void;
  onZipDrop?: (zipName: string, files: ArtifactFile[]) => void;
}> = ({ files, onChange, onZipDrop }) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const [newName, setNewName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dropMsg, setDropMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const _2MB = 2 * 1024 * 1024;

  const totalBytes = (list: ArtifactFile[]) =>
    list.reduce((sum, f) => sum + new TextEncoder().encode(f.content).length, 0);

  const mergeFiles = (incoming: ArtifactFile[]) => {
    const map = new Map(files.map(f => [f.name, f]));
    incoming.forEach(f => map.set(f.name, f));
    const merged = Array.from(map.values());
    const size = totalBytes(merged);
    if (size > _2MB) {
      setDropMsg(`⚠ Total size ${(size / 1024 / 1024).toFixed(1)} MB exceeds the 2 MB limit. Remove some files and try again.`);
      return;
    }
    onChange(merged);
    setActiveIdx(Math.max(0, merged.length - 1));
  };

  const processDropResult = (result: DropResult) => {
    const { files: incoming, skipped, zipName } = result;
    mergeFiles(incoming);
    if (zipName && onZipDrop) onZipDrop(zipName, incoming);
    if (skipped.length) setDropMsg(`Added ${incoming.length} file(s). Skipped ${skipped.length} (binary/cache): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`);
    else setDropMsg(`Added ${incoming.length} file(s)`);
    setTimeout(() => setDropMsg(''), 5000);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    setProcessing(true);
    setDropMsg('');
    try {
      const result = await readFilesFromDrop(Array.from(e.dataTransfer.files));
      processDropResult(result);
    } catch (err: unknown) {
      setDropMsg(`Error reading files: ${toApiError(err) || 'unknown'}`);
    } finally { setProcessing(false); }
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;
    setProcessing(true);
    setDropMsg('');
    try {
      const result = await readFilesFromDrop(fileList);
      processDropResult(result);
    } catch (err: unknown) {
      setDropMsg(`Error: ${toApiError(err) || 'unknown'}`);
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addBlankFile = () => {
    const name = newName.trim();
    if (!name) return;
    if (files.some(f => f.name === name)) return;
    const next = [...files, { name, content: '' }];
    onChange(next);
    setActiveIdx(next.length - 1);
    setNewName('');
  };

  const removeFile = (i: number) => {
    const next = files.filter((_, idx) => idx !== i);
    onChange(next);
    setActiveIdx(Math.max(0, Math.min(activeIdx, next.length - 1)));
  };

  const updateContent = (i: number, content: string) => {
    onChange(files.map((f, idx) => idx === i ? { ...f, content } : f));
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragEnter={e => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-2 px-6 py-6 rounded-lg border-2 border-dashed cursor-pointer transition-all select-none ${
          dragging
            ? 'border-primary bg-primary/10 scale-[1.01]'
            : 'border-white/20 hover:border-white/40 hover:bg-white/5'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*,.zip"
          className="hidden"
          onChange={handleInputChange}
        />
        {processing ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <span className="material-symbols-outlined text-xl animate-spin">progress_activity</span>
            Extracting…
          </div>
        ) : (
          <>
            <span className={`material-symbols-outlined text-3xl ${dragging ? 'text-primary' : 'text-slate-500'}`}>
              upload_file
            </span>
            <p className={`text-sm font-medium ${dragging ? 'text-primary' : 'text-slate-400'}`}>
              {dragging ? 'Drop to add files' : 'Drag & drop files or a ZIP here'}
            </p>
            <p className="text-xs text-slate-600">
              Or <span className="text-slate-400 underline underline-offset-2">click to browse</span> · ZIP files are automatically extracted
            </p>
          </>
        )}
      </div>

      {dropMsg && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
          <span className="material-symbols-outlined text-sm">check_circle</span>
          {dropMsg}
        </div>
      )}

      {/* Size indicator */}
      {files.length > 0 && (() => {
        const used = totalBytes(files);
        const pct = Math.min(100, (used / _2MB) * 100);
        const overLimit = used > _2MB;
        return (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${overLimit ? 'bg-red-400' : pct > 75 ? 'bg-yellow-400' : 'bg-emerald-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`text-xs tabular-nums ${overLimit ? 'text-red-400' : 'text-slate-500'}`}>
              {(used / 1024).toFixed(0)} KB / 2048 KB
            </span>
          </div>
        );
      })()}

      {/* File list + editor */}
      {files.length > 0 && (
        <div className="flex gap-3" style={{ minHeight: 360 }}>
          {/* Sidebar */}
          <div className="w-52 shrink-0 flex flex-col gap-1">
            <div className="flex-1 space-y-0.5 overflow-y-auto max-h-80">
              {files.map((f, i) => (
                <div
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  className={`flex items-center gap-1.5 group rounded px-2 py-1.5 cursor-pointer transition-colors ${activeIdx === i ? 'bg-primary/20 text-primary dark:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-300'}`}
                >
                  <span className="material-symbols-outlined text-xs text-slate-500 shrink-0">description</span>
                  <span className="flex-1 text-xs font-mono truncate" title={f.name}>{f.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); removeFile(i); }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity shrink-0"
                  >
                    <span className="material-symbols-outlined text-xs">close</span>
                  </button>
                </div>
              ))}
            </div>

            {/* Add blank file */}
            <div className="flex gap-1 pt-1 border-t border-slate-200 dark:border-white/10">
              <input
                className="flex-1 bg-slate-100 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:border-primary/50 min-w-0 font-mono"
                placeholder="new-file.py"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addBlankFile()}
              />
              <button
                onClick={addBlankFile}
                className="px-2 py-1 rounded bg-primary/20 text-primary text-xs hover:bg-primary/30 transition-colors shrink-0"
                title="Add blank file"
              >+</button>
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col">
            {files[activeIdx] ? (
              <>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="material-symbols-outlined text-xs text-slate-500">description</span>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-400">{files[activeIdx].name}</span>
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-600">{files[activeIdx].content.length.toLocaleString()} chars</span>
                </div>
                <textarea
                  className="flex-1 bg-slate-100 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:border-primary/50 resize-none leading-relaxed"
                  value={files[activeIdx].content}
                  onChange={e => updateContent(activeIdx, e.target.value)}
                  placeholder="Paste or type file content here…"
                  spellCheck={false}
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-600 text-sm border border-slate-200 dark:border-white/5 rounded">
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Type picker (confirm step before the New form) ────────────────────────────

const TYPE_BLURBS: Record<ArtifactType, string> = {
  agent: 'A pre-configured AI agent with a defined role and toolset.',
  skill: 'A reusable skill that extends an agent with new capabilities.',
  mcp: 'A Model Context Protocol server exposing tools and data.',
};

const TypePicker: React.FC<{
  allowed: ArtifactType[];
  onPick: (t: ArtifactType) => void;
  onCancel: () => void;
}> = ({ allowed, onPick, onCancel }) => (
  <div className="p-6 max-w-3xl">
    <div className="flex items-center justify-between mb-1">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">What are you contributing?</h2>
      <button type="button" onClick={onCancel} className="text-text-muted hover:text-slate-900 dark:hover:text-white transition-colors">
        <span className="material-symbols-outlined">close</span>
      </button>
    </div>
    <p className="text-sm text-slate-500 mb-6">Pick a type to continue to the submission form.</p>

    <div className="grid sm:grid-cols-3 gap-4">
      {allowed.map(t => (
        <button
          key={t}
          type="button"
          onClick={() => onPick(t)}
          className={`group flex flex-col items-start gap-3 p-5 rounded-xl border text-left transition-all hover:scale-[1.02] ${TYPE_COLORS[t]} hover:border-current`}
        >
          <span className="material-symbols-outlined text-3xl">{TYPE_ICONS[t]}</span>
          <span className="text-base font-bold text-slate-900 dark:text-white">{TYPE_LABELS[t]}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{TYPE_BLURBS[t]}</span>
          <span className="mt-auto pt-2 text-xs font-medium flex items-center gap-1">
            Continue
            <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-0.5">arrow_forward</span>
          </span>
        </button>
      ))}
    </div>
  </div>
);

// ── New artifact form ─────────────────────────────────────────────────────────

function zipNameToSlug(name: string): string {
  return name.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function zipNameToTitle(name: string): string {
  const raw = name.replace(/\.zip$/i, '').replace(/[_\-]+/g, ' ');
  return raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function bumpSemver(current: string, level: 'major' | 'minor' | 'patch'): string {
  const p = (current || '0.0.0').replace(/^v/i, '').split('.');
  const maj = parseInt(p[0], 10) || 0, min = parseInt(p[1], 10) || 0, pat = parseInt(p[2], 10) || 0;
  if (level === 'major') return `${maj + 1}.0.0`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const NewArtifactForm: React.FC<{
  onCreated: (a: Artifact) => void;
  onCancel: () => void;
  onChangeType?: () => void;
  initialParentSlug?: string;
  initialParentType?: ArtifactType;
  initialType?: ArtifactType;
  canChangeType?: boolean;
}> = ({ onCreated, onCancel, onChangeType, initialParentSlug = '', initialParentType = 'skill', initialType = 'agent', canChangeType = false }) => {
  const isUpdateMode = !!initialParentSlug;
  const [form, setForm] = useState({
    name: initialParentSlug || '',
    display_name: '',
    artifact_type: (initialParentSlug ? initialParentType : initialType) as ArtifactType,
    description: '',
    instructions: '',
    tags: '',
    parent_slug: initialParentSlug,
    version_bump: 'patch' as 'major' | 'minor' | 'patch',
  });
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // In update mode, look up the latest published version to preview the next bump.
  useEffect(() => {
    if (!isUpdateMode) return;
    api.get<{ current: string | null }>(
      `/admin/artifacts/version-info?name=${encodeURIComponent(initialParentSlug)}&artifact_type=${initialParentType}`,
    ).then(d => setCurrentVersion(d.current)).catch(() => {});
  }, [isUpdateMode, initialParentSlug, initialParentType]);

  const nextVersion = currentVersion === null
    ? '1.0.0'
    : bumpSemver(currentVersion, form.version_bump);

  const handleZipDrop = async (zipName: string, droppedFiles: ArtifactFile[]) => {
    // Pre-fill name/display_name immediately from ZIP filename
    const slug = zipNameToSlug(zipName);
    const title = zipNameToTitle(zipName);
    setForm(f => ({
      ...f,
      name: f.name || slug,
      display_name: f.display_name || title,
    }));

    // Call LLM to analyze the files
    setAnalyzing(true);
    try {
      const result = await api.post<{ display_name: string; description: string; instructions: string | null }>(
        '/admin/artifacts/analyze',
        { files: droppedFiles, zip_name: zipName }
      );
      setForm(f => ({
        ...f,
        display_name: result.display_name || f.display_name,
        description: result.description || f.description,
        instructions: result.instructions || f.instructions,
      }));
    } catch { /* LLM unavailable — keep the pre-filled values */ }
    finally { setAnalyzing(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.display_name.trim()) { setError('Display name is required'); return; }
    if (!form.name.trim()) { setError('Name (slug) is required'); return; }
    setSaving(true);
    setError('');
    try {
      const artifact = await api.post<Artifact>('/admin/artifacts', {
        name: form.name.trim(),
        display_name: form.display_name.trim(),
        artifact_type: form.artifact_type,
        description: form.description.trim() || null,
        instructions: form.instructions.trim() || null,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        files,
        parent_slug: form.parent_slug.trim() || null,
        version_bump: isUpdateMode ? form.version_bump : null,
      });
      onCreated(artifact);
    } catch (e: unknown) {
      setError(toApiError(e) || 'Failed to create artifact');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {isUpdateMode ? 'Submit Update' : 'New Artifact Submission'}
          </h2>
          {isUpdateMode && (
            <p className="text-xs text-slate-500 mt-0.5">
              Updating <span className="font-mono text-primary">{initialParentSlug}</span> — admins skip the approval queue
            </p>
          )}
        </div>
        <button type="button" onClick={onCancel} className="text-text-muted hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Files — shown first so ZIP drop auto-populates the fields below */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
          Files
          <span className="ml-2 text-slate-600 normal-case font-normal">— drop a ZIP to auto-fill name &amp; description</span>
        </label>
        <FilesEditor files={files} onChange={setFiles} onZipDrop={handleZipDrop} />
      </div>

      {/* Analyzing banner */}
      {analyzing && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-primary/10 border border-primary/20 text-sm text-primary">
          <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
          Analyzing files with LLM — filling in name, description &amp; how-to guide…
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Type — confirmed in the picker step */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Artifact Type</label>
          <div className="flex items-center justify-between gap-2 py-3 px-4 rounded-lg border border-slate-300 dark:border-white/10">
            <span className={`flex items-center gap-2 text-sm font-medium ${TYPE_COLORS[form.artifact_type].split(' ')[0]}`}>
              <span className="material-symbols-outlined text-base">{TYPE_ICONS[form.artifact_type]}</span>
              {TYPE_LABELS[form.artifact_type]}
            </span>
            {!isUpdateMode && canChangeType && onChangeType && (
              <button
                type="button"
                onClick={onChangeType}
                className="text-xs font-medium text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">swap_horiz</span>
                Change
              </button>
            )}
          </div>
        </div>

        {/* Display name */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
            Display Name *
            {analyzing && <span className="ml-2 text-primary text-xs normal-case">filling…</span>}
          </label>
          <input
            className={`w-full bg-slate-100 dark:bg-white/5 border rounded px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary/50 transition-colors ${analyzing ? 'border-primary/40 animate-pulse' : 'border-slate-300 dark:border-white/10'}`}
            value={form.display_name}
            onChange={e => {
              set('display_name', e.target.value);
              if (!form.name && !isUpdateMode) set('name', slugify(e.target.value));
            }}
            placeholder="My Awesome Agent"
          />
        </div>

        {/* Slug */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Folder Name (slug) *</label>
          <input
            className={`w-full bg-slate-100 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 font-mono focus:outline-none focus:border-primary/50 ${isUpdateMode ? 'opacity-60 cursor-not-allowed' : ''}`}
            value={form.name}
            readOnly={isUpdateMode}
            onChange={e => !isUpdateMode && set('name', slugify(e.target.value))}
            placeholder="my-awesome-agent"
          />
          <p className="text-xs text-slate-600 mt-1">Used as the folder name in GitHub. Lowercase, hyphens only.</p>
        </div>

        {/* Description */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
            Description
            {analyzing && <span className="ml-2 text-primary text-xs normal-case">filling…</span>}
          </label>
          <textarea
            className={`w-full bg-slate-100 dark:bg-white/5 border rounded px-3 py-2 text-sm text-slate-900 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:border-primary/50 resize-none transition-colors ${analyzing ? 'border-primary/40 animate-pulse' : 'border-slate-300 dark:border-white/10'}`}
            rows={3}
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="What does this artifact do?"
          />
        </div>

        {/* Tags */}
        <div className={isUpdateMode ? '' : 'col-span-2'}>
          <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Tags</label>
          <input
            className="w-full bg-slate-100 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded px-3 py-2 text-sm text-slate-900 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:border-primary/50"
            value={form.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder="llm, automation, productivity"
          />
        </div>

        {/* Version bump — only shown for updates; resolved version assigned on publish */}
        {isUpdateMode && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
              Version Bump
            </label>
            <div className="flex gap-2">
              {(['major', 'minor', 'patch'] as const).map(level => (
                <button
                  key={level}
                  type="button"
                  onClick={() => set('version_bump', level)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${form.version_bump === level ? 'border-primary text-primary bg-primary/10' : 'border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300'}`}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-1.5 font-mono">
              {currentVersion ? `current v${currentVersion} → ` : 'first publish → '}
              <span className="text-emerald-400">v{nextVersion}</span>
              <span className="not-italic font-sans text-slate-500"> · assigned automatically when an admin publishes</span>
            </p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
          Instructions / How-to Guide
          <span className="ml-2 text-slate-600 normal-case font-normal">(Markdown — auto-filled from skill.md if present)</span>
          {analyzing && <span className="ml-2 text-primary text-xs normal-case">filling…</span>}
        </label>
        <textarea
          className={`w-full bg-slate-100 dark:bg-white/5 border rounded px-3 py-2 text-sm text-slate-900 dark:text-slate-300 placeholder-slate-400 font-mono focus:outline-none focus:border-primary/50 resize-none transition-colors ${analyzing ? 'border-primary/40 animate-pulse' : 'border-slate-300 dark:border-white/10'}`}
          rows={10}
          value={form.instructions}
          onChange={e => set('instructions', e.target.value)}
          placeholder={`# Getting Started\n\n## Prerequisites\n- ...\n\n## Installation\n\`\`\`bash\n...\n\`\`\`\n\n## Usage\n...`}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? (isUpdateMode ? 'Submitting…' : 'Creating…') : (isUpdateMode ? 'Submit Update' : 'Create Draft')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-white/10 text-slate-400 text-sm hover:bg-white/20 transition-colors"
        >
          Cancel
        </button>
        <p className="text-xs text-slate-600">Saved as draft — validate and submit when ready.</p>
      </div>
    </form>
  );
};

// ── GitHub Config panel ───────────────────────────────────────────────────────

interface ConnCheckStep {
  name: string;
  ok: boolean;
  detail: string;
}

interface ConnCheckResult {
  ok: boolean;
  checks: ConnCheckStep[];
  error: string | null;
}

export const GithubConfigPanel: React.FC = () => {
  const [config, setConfig] = useState<GithubConfig>(EMPTY_GITHUB_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeType, setActiveType] = useState<ArtifactType>('agent');
  const [testing, setTesting] = useState(false);
  const [connResult, setConnResult] = useState<ConnCheckResult | null>(null);
  const [allowedTypes, setAllowedTypes] = useState<ArtifactType[]>(['agent', 'skill', 'mcp']);

  useEffect(() => {
    Promise.all([
      api.get<GithubConfig>('/admin/artifacts/github-config').then(setConfig).catch(() => {}),
      api.get<{ allowed: ArtifactType[] }>('/admin/artifacts/allowed-types')
        .then(d => { if (d.allowed?.length) setAllowedTypes(d.allowed); })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const toggleAllowed = (t: ArtifactType) => {
    setAllowedTypes(prev => {
      if (prev.includes(t)) {
        if (prev.length === 1) return prev; // keep at least one
        return prev.filter(x => x !== t);
      }
      // preserve canonical order
      return (['agent', 'skill', 'mcp'] as ArtifactType[]).filter(x => x === t || prev.includes(x));
    });
  };

  const updateTypeConfig = (type: ArtifactType, field: keyof GithubTypeConfig, value: string) => {
    setConfig(c => ({ ...c, [type]: { ...c[type], [field]: value } }));
    setConnResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setConnResult(null);
    try {
      const result = await api.post<ConnCheckResult>(
        `/admin/artifacts/github-config/test/${activeType}`, {}
      );
      setConnResult(result);
    } catch (e: unknown) {
      setConnResult({ ok: false, checks: [], error: toApiError(e) || 'Request failed' });
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        api.put('/admin/artifacts/github-config', config),
        api.put('/admin/artifacts/allowed-types', { allowed: allowedTypes }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-center text-slate-500 text-sm">Loading…</div>;

  const cfg = config[activeType];

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <span className="material-symbols-outlined text-slate-400">settings</span>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">GitHub Backend Configuration</h2>
      </div>

      <div className="mb-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
        <p className="font-medium mb-1">Configure where artifacts are published</p>
        <p className="text-blue-400 text-xs">
          Each artifact type (Agent, Skill, MCP) can be published to a separate folder or repository.
          A GitHub Personal Access Token with <code className="bg-black/30 px-1 rounded">repo</code> scope is required.
        </p>
      </div>

      {/* Allowed submission types */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Allowed Submission Types</label>
        <p className="text-xs text-slate-500 mb-3">
          Contributors can only submit the types you enable here. The “+ New” flow asks which of these to create.
        </p>
        <div className="flex gap-2">
          {(['agent', 'skill', 'mcp'] as ArtifactType[]).map(t => {
            const on = allowedTypes.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleAllowed(t)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${on ? `${TYPE_COLORS[t]} border-current` : 'border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300'}`}
              >
                <span className="material-symbols-outlined text-base">{on ? 'check_circle' : TYPE_ICONS[t]}</span>
                {TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-6">
        {(['agent', 'skill', 'mcp'] as ArtifactType[]).map(t => (
          <button
            key={t}
            onClick={() => setActiveType(t)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeType === t ? `${TYPE_COLORS[t]} border border-current` : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'}`}
          >
            <span className="material-symbols-outlined text-sm">{TYPE_ICONS[t]}</span>
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Config form for active type */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">GitHub Repository URL</label>
          <input
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary/50 font-mono"
            value={cfg.url}
            onChange={e => updateTypeConfig(activeType, 'url', e.target.value)}
            placeholder="https://github.com/org/repo.git"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Branch</label>
            <input
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary/50 font-mono"
              value={cfg.branch}
              onChange={e => updateTypeConfig(activeType, 'branch', e.target.value)}
              placeholder="main"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Base Folder</label>
            <input
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary/50 font-mono"
              value={cfg.folder}
              onChange={e => updateTypeConfig(activeType, 'folder', e.target.value)}
              placeholder={activeType === 'agent' ? 'agents' : activeType === 'skill' ? 'skills' : 'mcp'}
            />
            <p className="text-xs text-slate-600 mt-1">Artifacts go into: folder/artifact-name/</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">GitHub Personal Access Token</label>
          <input
            type="password"
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary/50 font-mono"
            value={cfg.token}
            onChange={e => updateTypeConfig(activeType, 'token', e.target.value)}
            placeholder="ghp_… (leave blank to keep existing)"
            autoComplete="new-password"
          />
          <p className="text-xs text-slate-600 mt-1">Requires: <code className="bg-white/5 px-1 rounded">repo</code> scope. Leave blank to keep current token.</p>
        </div>

        {/* Preview */}
        {cfg.url && cfg.folder && (
          <div className="p-3 rounded bg-black/20 border border-white/10 text-xs font-mono text-slate-400">
            <p className="text-slate-600 mb-1">Example publish path:</p>
            <span className="text-slate-300">{cfg.url.replace(/\.git$/, '')}/tree/{cfg.branch || 'main'}/{cfg.folder}/<span className="text-primary">your-artifact-name</span>/</span>
          </div>
        )}

        {/* Connectivity result */}
        {connResult && (
          <div className={`p-4 rounded-lg border ${connResult.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`material-symbols-outlined text-base ${connResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {connResult.ok ? 'check_circle' : 'cancel'}
              </span>
              <span className={`text-sm font-bold ${connResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {connResult.ok ? 'Connection successful' : `Connection failed: ${connResult.error}`}
              </span>
            </div>
            <div className="space-y-1.5">
              {connResult.checks.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={`material-symbols-outlined text-xs mt-0.5 shrink-0 ${step.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {step.ok ? 'check' : 'close'}
                  </span>
                  <span className={`font-medium ${step.ok ? 'text-slate-300' : 'text-red-300'} shrink-0`}>{step.name}</span>
                  <span className="text-slate-500">— {step.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
        <button
          onClick={handleTest}
          disabled={testing || saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-slate-300 text-sm font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-sm">wifi_tethering</span>
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-emerald-400 text-sm">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            Saved
          </span>
        )}
      </div>
    </div>
  );
};
