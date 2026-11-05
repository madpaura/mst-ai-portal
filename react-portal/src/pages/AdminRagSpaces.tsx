import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, toApiError } from '../api/client';
import { EVENT_LABELS, STATUS_META, formatDate } from '../components/ragSpaceTypes';
import type { RagSpace, RevealedKey, SpaceJob } from '../components/ragSpaceTypes';

const POLL_MS = 4000;

const FILTERS = [
  { key: 'action', label: 'Needs action' },
  { key: 'all', label: 'All' },
  { key: 'deploying', label: 'Deploying' },
  { key: 'live', label: 'Live' },
  { key: 'stopped', label: 'Stopped' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'deleted', label: 'Deleted' },
];

interface Connection {
  configured: boolean;
  host: string;
  user: string;
  remote_path: string;
}

interface PendingNote {
  title: string;
  hint: string;
  action: string;
  confirmLabel: string;
  danger?: boolean;
  required: boolean;
}

const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition-colors';
const btnPrimary = `${btn} bg-primary text-white hover:bg-primary/90 font-bold`;
const btnGhost = `${btn} border border-border-base text-text-muted hover:text-text-strong`;
const btnDanger = `${btn} border border-rose-500/40 text-rose-500 hover:bg-rose-500/10`;

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-emerald-500',
  running: 'bg-emerald-500',
  starting: 'bg-amber-500',
  unhealthy: 'bg-rose-500',
  missing: 'bg-rose-500',
};

const ConnectionBar: React.FC = () => {
  const [conn, setConn] = useState<Connection | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null);

  useEffect(() => {
    api.get<Connection>('/admin/rag-spaces/connection').then(setConn).catch(() => {});
  }, []);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post<{ ok: boolean; output: string }>('/admin/rag-spaces/connection/test'));
    } catch (err) {
      setResult({ ok: false, output: toApiError(err) });
    } finally {
      setTesting(false);
    }
  };

  if (!conn) return null;
  if (!conn.configured) {
    return (
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-text-muted">
        The mmrag host is not configured. Users can submit requests, but approving one needs the MMRAG_SSH_* and MMRAG_REMOTE_PATH variables.
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-border-base bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
        <span className="material-symbols-outlined text-[18px]">dns</span>
        <span className="font-mono text-xs">{conn.user}@{conn.host}:{conn.remote_path}</span>
        <button onClick={test} disabled={testing} className={`${btnGhost} ml-auto`}>
          {testing ? 'Checking…' : 'Test connection'}
        </button>
      </div>
      {result && (
        <pre className={`mt-2 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-xs ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
          {result.output || (result.ok ? 'OK' : 'Check failed')}
        </pre>
      )}
    </div>
  );
};

const JobLog: React.FC<{ jobId: string; running: boolean; onFinished: () => void }> = ({ jobId, running, onFinished }) => {
  const [job, setJob] = useState<SpaceJob | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    activeJobRef.current = jobId;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      if (activeJobRef.current !== jobId) { clearInterval(timer); return; }
      try {
        const data = await api.get<SpaceJob>(`/admin/rag-spaces/jobs/${jobId}`);
        if (activeJobRef.current !== jobId) return;
        setJob(data);
        if (data.status === 'succeeded' || data.status === 'failed') {
          clearInterval(timer);
          if (running) onFinished();
        }
      } catch {
        clearInterval(timer);
      }
    };
    poll();
    if (running) timer = setInterval(poll, POLL_MS);
    return () => { clearInterval(timer); activeJobRef.current = null; };
  }, [jobId, running, onFinished]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log]);

  return (
    <pre ref={logRef} className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
      {job ? job.log || 'Waiting for output…' : 'Loading…'}
    </pre>
  );
};

const Detail: React.FC<{ spaceId: string; onChanged: () => void }> = ({ spaceId, onChanged }) => {
  const [space, setSpace] = useState<RagSpace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingNote | null>(null);
  const [note, setNote] = useState('');
  const [confirmSlug, setConfirmSlug] = useState<{ action: string; label: string } | null>(null);
  const [typedSlug, setTypedSlug] = useState('');
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const activeIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<RagSpace>(`/admin/rag-spaces/${spaceId}`);
    if (activeIdRef.current !== spaceId) return;
    setSpace(data);
  }, [spaceId]);

  useEffect(() => {
    activeIdRef.current = spaceId;
    load().catch((err) => setError(toApiError(err)));
    return () => { activeIdRef.current = null; };
  }, [spaceId, load]);

  const activeJobId = space?.active_job?.id ?? null;
  useEffect(() => {
    if (!activeJobId) return;
    const timer = setInterval(() => {
      if (activeIdRef.current !== spaceId) { clearInterval(timer); return; }
      load().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeJobId, spaceId, load]);

  const onJobFinished = useCallback(() => {
    load().catch(() => {});
    onChanged();
  }, [load, onChanged]);

  const post = async (action: string, body?: unknown) => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post<RagSpace>(`/admin/rag-spaces/${spaceId}/${action}`, body ?? {});
      if (activeIdRef.current !== spaceId) return;
      setSpace(data);
      setPending(null);
      setConfirmSlug(null);
      setNote('');
      setTypedSlug('');
      onChanged();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    setBusy(true);
    setError('');
    try {
      setRevealed(await api.post<RevealedKey>(`/admin/rag-spaces/${spaceId}/reveal-key`));
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const ask = (next: PendingNote) => { setNote(''); setPending(next); };

  if (!space) {
    return <div className="rounded-xl border border-border-base bg-surface p-6 text-sm text-text-muted">{error || 'Loading…'}</div>;
  }

  const meta = STATUS_META[space.status];
  const jobBusy = !!space.active_job;
  const logJobId = selectedJob ?? space.active_job?.id ?? space.jobs?.[0]?.id ?? null;
  const logJobRunning = !!space.active_job && logJobId === space.active_job.id;
  const askInfo = () => ask({ title: 'Request more information', hint: 'The owner sees this message by email and on their space.', action: 'request-info', confirmLabel: 'Send request', required: true });
  const askReject = () => ask({ title: 'Reject this request', hint: 'The owner sees this reason and can edit and resubmit.', action: 'reject', confirmLabel: 'Reject', danger: true, required: true });
  const sendBackRemoves = space.provisioned ? ' The deployed stack will be removed.' : '';

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border-base bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text-strong">{space.name}</h2>
            <p className="text-xs text-text-muted">
              <span className="font-mono">{space.slug}</span> · {space.owner_name ?? 'Owner removed'}{space.owner_email ? ` (${space.owner_email})` : ''}
            </p>
          </div>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.className}`}>{meta.label}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold text-text-faint">PLM project</dt><dd className="text-text-strong">{space.plm_project}</dd></div>
          <div><dt className="text-xs font-semibold text-text-faint">Requested</dt><dd className="text-text-strong">{formatDate(space.created_at)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-faint">Reason for RAG</dt><dd className="whitespace-pre-wrap text-text-strong">{space.reason}</dd></div>
          {space.delete_reason && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-faint">Deletion reason</dt><dd className="whitespace-pre-wrap text-text-strong">{space.delete_reason}</dd></div>}
          {space.review_note && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-faint">Last message to owner</dt><dd className="whitespace-pre-wrap text-text-strong">{space.review_note}</dd></div>}
          {space.backup_path && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-faint">Backup on mmrag host</dt><dd className="break-all font-mono text-xs text-text-strong">{space.backup_path}</dd></div>}
          {space.mgmt_url && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-text-faint">URLs</dt>
              <dd className="flex flex-wrap gap-3 text-sm">
                <a href={space.mgmt_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Management portal</a>
                {space.api_url && <a href={space.api_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">API</a>}
              </dd>
            </div>
          )}
        </dl>

        {error && <p role="alert" className="mt-3 text-sm text-rose-500">{error}</p>}

        {pending ? (
          <div className="mt-4 rounded-lg border border-border-base bg-surface-muted p-3">
            <p className="text-sm font-semibold text-text-strong">{pending.title}</p>
            <p className="text-xs text-text-muted">{pending.hint}</p>
            <textarea
              aria-label={pending.title}
              className="mt-2 min-h-20 w-full rounded-lg border border-border-base bg-surface px-3 py-2 text-sm text-text-strong focus:outline-none focus:border-primary"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
            <div className="mt-2 flex gap-2">
              <button
                disabled={busy || (pending.required && note.trim().length < 3)}
                onClick={() => post(pending.action, { note: note.trim() || null })}
                className={pending.danger ? btnDanger : btnPrimary}
              >
                {pending.confirmLabel}
              </button>
              <button onClick={() => setPending(null)} className={btnGhost}>Cancel</button>
            </div>
          </div>
        ) : confirmSlug ? (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
            <label className="text-sm font-semibold text-text-strong" htmlFor="confirm-slug">
              Type <code className="font-mono">{space.slug}</code> to confirm
            </label>
            <input
              id="confirm-slug"
              className="mt-2 w-full rounded-lg border border-border-base bg-surface px-3 py-2 font-mono text-sm text-text-strong focus:outline-none focus:border-rose-500"
              value={typedSlug}
              onChange={(e) => setTypedSlug(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <button disabled={busy || typedSlug !== space.slug} onClick={() => post(confirmSlug.action)} className={btnDanger}>{confirmSlug.label}</button>
              <button onClick={() => { setConfirmSlug(null); setTypedSlug(''); }} className={btnGhost}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {space.status === 'pending' && (
              <>
                <button disabled={busy} onClick={() => post('approve')} className={btnPrimary}>Approve and deploy</button>
                <button disabled={busy} onClick={askInfo} className={btnGhost}>Request info</button>
                <button disabled={busy} onClick={askReject} className={btnDanger}>Reject</button>
              </>
            )}
            {space.status === 'deployed' && (
              <>
                <button disabled={busy} onClick={() => ask({ title: 'Final approval', hint: 'The owner is emailed that the space is ready. An optional message goes with it.', action: 'final-approve', confirmLabel: 'Approve and notify owner', required: false })} className={btnPrimary}>Final approval</button>
                <button disabled={busy} onClick={reveal} className={btnGhost}>Show access key</button>
                <button disabled={busy} onClick={() => { askInfo(); setPending((p) => p && { ...p, hint: p.hint + sendBackRemoves }); }} className={btnGhost}>Request info</button>
                <button disabled={busy} onClick={() => { askReject(); setPending((p) => p && { ...p, hint: p.hint + sendBackRemoves }); }} className={btnDanger}>Reject</button>
              </>
            )}
            {space.status === 'deploy_failed' && (
              <>
                <button disabled={busy || jobBusy} onClick={() => post('retry')} className={btnPrimary}>Retry deployment</button>
                <button disabled={busy} onClick={() => { askInfo(); setPending((p) => p && { ...p, hint: p.hint + sendBackRemoves }); }} className={btnGhost}>Request info</button>
                <button disabled={busy} onClick={() => { askReject(); setPending((p) => p && { ...p, hint: p.hint + sendBackRemoves }); }} className={btnDanger}>Reject</button>
              </>
            )}
            {space.status === 'live' && (
              <>
                <button disabled={busy || jobBusy} onClick={() => post('redeploy')} className={btnGhost}>Redeploy</button>
                <button disabled={busy || jobBusy} onClick={() => post('stop')} className={btnGhost}>Stop</button>
                <button disabled={busy || jobBusy} onClick={reveal} className={btnGhost}>Show access key</button>
                <button disabled={busy || jobBusy} onClick={() => setConfirmSlug({ action: 'rotate-key', label: 'Rotate key' })} className={btnDanger}>Rotate key</button>
              </>
            )}
            {space.status === 'stopped' && <button disabled={busy || jobBusy} onClick={() => post('start')} className={btnPrimary}>Start</button>}
            {space.status === 'delete_requested' && (
              <>
                <button disabled={busy || jobBusy} onClick={() => setConfirmSlug({ action: 'approve-delete', label: 'Back up and delete' })} className={btnDanger}>Approve deletion</button>
                <button disabled={busy} onClick={() => ask({ title: 'Decline deletion', hint: 'The space stays as it was and the owner is told why.', action: 'deny-delete', confirmLabel: 'Decline', required: true })} className={btnGhost}>Decline</button>
              </>
            )}
            {space.status === 'delete_failed' && (
              <>
                <button disabled={busy || jobBusy} onClick={() => post('retry-delete')} className={btnPrimary}>Retry deletion</button>
                <button disabled={busy} onClick={() => ask({ title: 'Remove the portal record only', hint: 'Nothing is run on the mmrag host. Use this only if the project is already gone. Say why.', action: 'force-remove', confirmLabel: 'Remove record', danger: true, required: true })} className={btnDanger}>Remove record</button>
              </>
            )}
            {(space.status === 'needs_info' || space.status === 'rejected') && space.provisioned && (
              <button disabled={busy || jobBusy} onClick={() => post('retry-cleanup')} className={btnGhost}>Retry cleanup</button>
            )}
          </div>
        )}

        {revealed && (
          <div className="mt-3 rounded-lg border border-border-base bg-surface-muted p-3 text-sm">
            <p className="text-text-muted">User <code className="font-mono text-text-strong">{revealed.username}</code>, password:</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-text-strong">{revealed.key}</code>
              <button onClick={() => setRevealed(null)} className={btnGhost}>Hide</button>
            </div>
          </div>
        )}
      </section>

      {space.provisioned && (
        <section className="rounded-xl border border-border-base bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-text-strong">Service health</h3>
            <button disabled={busy} onClick={() => post('status')} className={btnGhost}>Check now</button>
          </div>
          {space.health ? (
            <>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {space.health.services.map((s) => (
                  <li key={s.service} className="flex items-center gap-2 text-sm text-text-muted">
                    <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[s.state] ?? 'bg-slate-400'}`} />
                    <span className="font-mono text-xs text-text-strong">{s.service}</span> {s.state}
                  </li>
                ))}
              </ul>
              {space.health.error && <p className="mt-2 text-xs text-rose-500">{space.health.error}</p>}
              <p className="mt-2 text-xs text-text-faint">Checked {formatDate(space.health_checked_at)}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-text-muted">Not checked yet.</p>
          )}
        </section>
      )}

      {!!space.jobs?.length && (
        <section className="rounded-xl border border-border-base bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-text-strong">Deployment logs</h3>
            <select
              aria-label="Job"
              value={logJobId ?? ''}
              onChange={(e) => setSelectedJob(e.target.value)}
              className="rounded-lg border border-border-base bg-surface-muted px-2 py-1 text-xs text-text-strong"
            >
              {space.jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.label} · {j.status} · {formatDate(j.created_at)}</option>
              ))}
            </select>
          </div>
          {space.jobs.find((j) => j.id === logJobId)?.error && (
            <p className="mt-2 text-sm text-rose-500">{space.jobs.find((j) => j.id === logJobId)?.error}</p>
          )}
          {logJobId && <div className="mt-3"><JobLog key={logJobId} jobId={logJobId} running={logJobRunning} onFinished={onJobFinished} /></div>}
        </section>
      )}

      <section className="rounded-xl border border-border-base bg-surface p-5">
        <h3 className="mb-3 text-sm font-bold text-text-strong">History</h3>
        <ol className="space-y-2">
          {space.events?.map((e, i) => (
            <li key={i} className="text-xs text-text-muted">
              <span className="font-semibold text-text-strong">{EVENT_LABELS[e.event] ?? e.event}</span>
              {e.actor_name && <> by {e.actor_name}</>} · {formatDate(e.created_at)}
              {e.note && <p className="mt-0.5 whitespace-pre-wrap">{e.note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

export const AdminRagSpaces: React.FC = () => {
  const [items, setItems] = useState<RagSpace[]>([]);
  const [actionCount, setActionCount] = useState(0);
  const [filter, setFilter] = useState('action');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const params = new URLSearchParams({ filter });
      if (query.trim()) params.set('q', query.trim());
      const data = await api.get<{ items: RagSpace[]; action_count: number }>(`/admin/rag-spaces?${params}`);
      if (request !== requestRef.current) return;
      setItems(data.items);
      setActionCount(data.action_count);
      setError('');
    } catch (err) {
      if (request === requestRef.current) setError(toApiError(err));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">MMRAG Spaces</h1>
        <p className="text-sm text-text-muted">Review requests, follow deployments and operate spaces on the mmrag host.</p>
      </div>
      <ConnectionBar />
      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="min-w-0">
          <input
            aria-label="Search spaces"
            placeholder="Search name, ID, PLM or owner"
            className="mb-3 w-full rounded-lg border border-border-base bg-surface px-3 py-2 text-sm text-text-strong focus:outline-none focus:border-primary"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filter === f.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border-base text-text-muted hover:text-text-strong'}`}
              >
                {f.label}{f.key === 'action' && actionCount > 0 ? ` (${actionCount})` : ''}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="mb-2 text-sm text-rose-500">{error}</p>}
          <ul className="space-y-2">
            {items.map((space) => {
              const meta = STATUS_META[space.status];
              return (
                <li key={space.id}>
                  <button
                    onClick={() => setSelectedId(space.id)}
                    className={`w-full rounded-xl border bg-surface p-3 text-left transition-colors ${selectedId === space.id ? 'border-primary/50' : 'border-border-base hover:border-primary/30'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-text-strong">{space.name}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>{meta.label}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-text-muted">{space.owner_name ?? 'Owner removed'} · {space.plm_project}</p>
                  </button>
                </li>
              );
            })}
            {!loading && items.length === 0 && <li className="rounded-xl border border-border-base bg-surface p-4 text-sm text-text-muted">Nothing here.</li>}
          </ul>
        </aside>
        <div className="min-w-0">
          {selectedId ? (
            <Detail key={selectedId} spaceId={selectedId} onChanged={load} />
          ) : (
            <div className="rounded-xl border border-border-base bg-surface p-6 text-sm text-text-muted">Select a space to review it.</div>
          )}
        </div>
      </div>
    </div>
  );
};
