import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api, toApiError } from '../api/client';
import { useAuth } from '../api/auth';
import { usePageView } from '../hooks/usePageView';
import { EVENT_LABELS, STATUS_META, formatDate } from '../components/ragSpaceTypes';
import type { RagSpace, RevealedKey, SpaceEvent, SpaceStatus } from '../components/ragSpaceTypes';

const POLL_MS = 10000;
const WAITING: SpaceStatus[] = ['pending', 'deploying', 'deployed', 'delete_requested', 'deleting'];

const inputClass =
  'w-full rounded-lg border border-border-base bg-surface-muted px-3 py-2 text-sm text-text-strong placeholder:text-text-faint focus:outline-none focus:border-primary';

const slugFrom = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 31).replace(/-+$/, '');

interface FormValues {
  name: string;
  plm_project: string;
  reason: string;
  slug: string;
}

const EMPTY_FORM: FormValues = { name: '', plm_project: '', reason: '', slug: '' };

const SpaceForm: React.FC<{
  initial?: RagSpace;
  onSaved: () => void;
  onCancel?: () => void;
}> = ({ initial, onSaved, onCancel }) => {
  const [values, setValues] = useState<FormValues>(
    initial
      ? { name: initial.name, plm_project: initial.plm_project, reason: initial.reason, slug: initial.slug }
      : EMPTY_FORM,
  );
  const [slugEdited, setSlugEdited] = useState(!!initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const slugLocked = !!initial?.provisioned;

  const setName = (name: string) =>
    setValues((v) => ({ ...v, name, slug: slugEdited ? v.slug : slugFrom(name) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (initial) await api.put(`/api/rag-spaces/${initial.id}`, values);
      else await api.post('/api/rag-spaces', values);
      onSaved();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1" htmlFor="space-name">Name</label>
        <input
          id="space-name"
          className={inputClass}
          value={values.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Firmware validation knowledge base"
          required
          minLength={3}
          maxLength={80}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1" htmlFor="space-slug">Space ID</label>
        <input
          id="space-slug"
          className={`${inputClass} font-mono`}
          value={values.slug}
          onChange={(e) => {
            setSlugEdited(true);
            setValues((v) => ({ ...v, slug: e.target.value }));
          }}
          disabled={slugLocked}
          required
          pattern="[a-z0-9][a-z0-9\-]{0,30}"
          maxLength={31}
          title="Lowercase letters, digits and hyphens, starting with a letter or digit"
        />
        <p className="mt-1 text-xs text-text-faint">
          {slugLocked ? 'The ID stays the same while the earlier deployment is removed.' : 'Used in the space URL. It cannot change after deployment.'}
        </p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1" htmlFor="space-plm">PLM project name</label>
        <input
          id="space-plm"
          className={inputClass}
          value={values.plm_project}
          onChange={(e) => setValues((v) => ({ ...v, plm_project: e.target.value }))}
          required
          maxLength={120}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1" htmlFor="space-reason">Why do you need RAG?</label>
        <textarea
          id="space-reason"
          className={`${inputClass} min-h-28`}
          value={values.reason}
          onChange={(e) => setValues((v) => ({ ...v, reason: e.target.value }))}
          placeholder="What data will you ingest, who will use it, and what questions should it answer?"
          required
          minLength={10}
          maxLength={2000}
        />
      </div>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Request space'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-border-base px-4 py-2 text-sm font-medium text-text-muted hover:text-text-strong">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

const KeyPanel: React.FC<{ space: RagSpace }> = ({ space }) => {
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    setLoading(true);
    setError('');
    try {
      setRevealed(await api.post<RevealedKey>(`/api/rag-spaces/${space.id}/reveal-key`));
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!revealed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={reveal}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-base px-3 py-2 text-sm font-medium text-text-muted hover:text-text-strong disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">key</span>
          {loading ? 'Fetching…' : 'Show access key'}
        </button>
        {error && <span role="alert" className="text-sm text-rose-500">{error}</span>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-base bg-surface-muted p-3 text-sm">
      <p className="text-text-muted">
        Sign in to the space with user <code className="font-mono text-text-strong">{revealed.username}</code> and this key as the password:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs text-text-strong">{revealed.key}</code>
        <button onClick={copy} className="shrink-0 rounded-md border border-border-base px-2 py-1 text-xs text-text-muted hover:text-text-strong">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={() => setRevealed(null)} className="shrink-0 rounded-md border border-border-base px-2 py-1 text-xs text-text-muted hover:text-text-strong">
          Hide
        </button>
      </div>
      <p className="mt-2 text-xs text-text-faint">Keep this private. Anyone with the key can read and change this space.</p>
    </div>
  );
};

const Timeline: React.FC<{ spaceId: string }> = ({ spaceId }) => {
  const [events, setEvents] = useState<SpaceEvent[] | null>(null);

  useEffect(() => {
    let active = true;
    api.get<RagSpace>(`/api/rag-spaces/${spaceId}`)
      .then((s) => { if (active) setEvents(s.events ?? []); })
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [spaceId]);

  if (!events) return <p className="text-xs text-text-faint">Loading history…</p>;
  return (
    <ol className="space-y-2">
      {events.map((e, i) => (
        <li key={i} className="text-xs text-text-muted">
          <span className="font-semibold text-text-strong">{EVENT_LABELS[e.event] ?? e.event}</span>
          {e.actor_name && <> by {e.actor_name}</>} · {formatDate(e.created_at)}
          {e.note && <p className="mt-0.5 whitespace-pre-wrap">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
};

const SpaceCard: React.FC<{ space: RagSpace; onChanged: () => void }> = ({ space, onChanged }) => {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete-request' | 'delete-confirm'>('view');
  const [showHistory, setShowHistory] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const meta = STATUS_META[space.status];
  const sentBack = space.status === 'needs_info' || space.status === 'rejected';

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setMode('view');
      onChanged();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'edit') {
    return (
      <article className="rounded-2xl border border-border-base bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-base font-bold text-text-strong">Edit request</h2>
        <SpaceForm initial={space} onSaved={() => { setMode('view'); onChanged(); }} onCancel={() => setMode('view')} />
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-border-base bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {space.status === 'live' && space.mgmt_url ? (
            <a href={space.mgmt_url} target="_blank" rel="noreferrer" className="text-base font-bold text-text-strong hover:text-primary">
              {space.name}
            </a>
          ) : (
            <h2 className="text-base font-bold text-text-strong">{space.name}</h2>
          )}
          <p className="mt-0.5 text-xs text-text-muted">
            <span className="font-mono">{space.slug}</span> · PLM: {space.plm_project}
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.className}`}>{meta.label}</span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm text-text-muted">{space.reason}</p>

      {space.review_note && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${sentBack ? 'border-amber-500/30 bg-amber-500/5' : 'border-border-base bg-surface-muted'}`}>
          <p className="text-xs font-semibold text-text-muted">Message from the admin</p>
          <p className="mt-1 whitespace-pre-wrap text-text-strong">{space.review_note}</p>
        </div>
      )}

      {space.status === 'pending' && <p className="mt-3 text-sm text-text-muted">An admin will review this request. You'll get an email when it has been reviewed.</p>}
      {(space.status === 'deploying' || space.status === 'deploy_failed') && (
        <p className="mt-3 text-sm text-text-muted">Your request was approved and the space is being set up.</p>
      )}
      {space.status === 'deployed' && <p className="mt-3 text-sm text-text-muted">The space is deployed. An admin is verifying it before it opens to you.</p>}
      {space.status === 'stopped' && <p className="mt-3 text-sm text-text-muted">An admin stopped this space. Its data is kept.</p>}
      {(space.status === 'delete_requested' || space.status === 'deleting' || space.status === 'delete_failed') && (
        <p className="mt-3 text-sm text-text-muted">Deletion reason: {space.delete_reason}</p>
      )}

      {space.status === 'live' && space.mgmt_url && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={space.mgmt_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90"
            >
              Open space
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            </a>
            {space.api_url && (
              <a href={space.api_url} target="_blank" rel="noreferrer" className="rounded-lg border border-border-base px-3 py-2 text-sm font-medium text-text-muted hover:text-text-strong">
                API
              </a>
            )}
          </div>
          <KeyPanel space={space} />
        </div>
      )}

      {mode === 'delete-request' && (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <label className="block text-sm font-semibold text-text-strong" htmlFor={`delete-${space.id}`}>Why should this space be deleted?</label>
          <p className="mt-0.5 text-xs text-text-muted">An admin will review this. A backup is taken before anything is deleted.</p>
          <textarea
            id={`delete-${space.id}`}
            className={`${inputClass} mt-2`}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            maxLength={2000}
          />
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy || deleteReason.trim().length < 3}
              onClick={() => act(() => api.post(`/api/rag-spaces/${space.id}/request-delete`, { reason: deleteReason }))}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Request deletion
            </button>
            <button onClick={() => setMode('view')} className="rounded-lg border border-border-base px-3 py-1.5 text-sm text-text-muted">Cancel</button>
          </div>
        </div>
      )}

      {mode === 'delete-confirm' && (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-sm font-semibold text-text-strong">Delete this request?</p>
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy}
              onClick={() => act(() => api.delete(`/api/rag-spaces/${space.id}`))}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Delete
            </button>
            <button onClick={() => setMode('view')} className="rounded-lg border border-border-base px-3 py-1.5 text-sm text-text-muted">Cancel</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-rose-500">{error}</p>}

      {mode === 'view' && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-base pt-3">
          {(space.status === 'pending' || sentBack) && (
            <button onClick={() => setMode('edit')} className="rounded-lg border border-border-base px-3 py-1.5 text-sm font-medium text-text-muted hover:text-text-strong">Edit</button>
          )}
          {sentBack && (
            <button
              disabled={busy}
              onClick={() => act(() => api.post(`/api/rag-spaces/${space.id}/resubmit`))}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Resubmit
            </button>
          )}
          {(space.status === 'pending' || sentBack) && (
            <button
              disabled={space.provisioned}
              title={space.provisioned ? 'The earlier deployment is still being removed' : undefined}
              onClick={() => setMode('delete-confirm')}
              className="rounded-lg border border-border-base px-3 py-1.5 text-sm font-medium text-rose-500 disabled:opacity-50"
            >
              Delete
            </button>
          )}
          {(space.status === 'live' || space.status === 'stopped') && (
            <button onClick={() => setMode('delete-request')} className="rounded-lg border border-border-base px-3 py-1.5 text-sm font-medium text-rose-500">
              Request deletion
            </button>
          )}
          {space.status === 'delete_requested' && (
            <button
              disabled={busy}
              onClick={() => act(() => api.post(`/api/rag-spaces/${space.id}/cancel-delete`))}
              className="rounded-lg border border-border-base px-3 py-1.5 text-sm font-medium text-text-muted hover:text-text-strong disabled:opacity-50"
            >
              Cancel deletion request
            </button>
          )}
          <button onClick={() => setShowHistory((s) => !s)} className="ml-auto text-xs font-medium text-text-muted hover:text-text-strong">
            {showHistory ? 'Hide history' : 'History'}
          </button>
        </div>
      )}
      {showHistory && <div className="mt-3"><Timeline key={space.updated_at} spaceId={space.id} /></div>}
    </article>
  );
};

export const RagSpaces: React.FC = () => {
  usePageView('/rag-spaces');
  const { user, loading: authLoading } = useAuth();
  const [spaces, setSpaces] = useState<RagSpace[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: RagSpace[] }>('/api/rag-spaces');
      if (!mountedRef.current) return;
      setSpaces(data.items);
      setError('');
    } catch (err) {
      if (mountedRef.current) setError(toApiError(err));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timer = user ? setTimeout(load, 0) : undefined;
    return () => {
      clearTimeout(timer);
      mountedRef.current = false;
    };
  }, [user, load]);

  const waiting = spaces?.some((s) => WAITING.includes(s.status)) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const showForm = creating || spaces?.length === 0;

  return (
    <div className="bg-background-light dark:bg-background-dark text-text-strong min-h-screen font-sans flex flex-col">
      <Navbar variant="solutions" />
      <main className="flex-1 pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">MMRAG Spaces</h1>
              <p className="mt-1 text-sm text-text-muted">Private RAG workspaces for your project's documents.</p>
            </div>
            {user && !showForm && (
              <button onClick={() => setCreating(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90">
                New space
              </button>
            )}
          </div>

          <div className="mt-6 space-y-4">
            {!authLoading && !user && (
              <div className="rounded-2xl border border-border-base bg-surface p-6 text-sm text-text-muted">
                <Link to="/login?next=/rag-spaces" className="font-semibold text-primary">Sign in</Link> to request a space or open your spaces.
              </div>
            )}
            {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
            {user && spaces === null && !error && <p className="text-sm text-text-muted">Loading…</p>}
            {user && showForm && (
              <section className="rounded-2xl border border-border-base bg-surface p-5 shadow-sm">
                <h2 className="mb-4 text-base font-bold">Request a new space</h2>
                <SpaceForm
                  onSaved={() => { setCreating(false); load(); }}
                  onCancel={spaces && spaces.length > 0 ? () => setCreating(false) : undefined}
                />
              </section>
            )}
            {spaces?.map((space) => <SpaceCard key={space.id} space={space} onChanged={load} />)}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};
