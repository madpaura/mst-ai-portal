import React, { useState, useEffect, useCallback } from 'react';
import { api, toApiError } from '../api/client';

interface PublishRequest {
  id: string;
  target_type: string;
  target_id: string;
  target_title: string;
  requested_by: string;
  requester_name: string | null;
  requester_email: string | null;
  status: string;
  note: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
}

interface Props {
  targetType?: 'video' | 'marketplace';
  onClose: () => void;
  onApproved?: () => void;
}

export const PublishRequests: React.FC<Props> = ({ targetType, onClose, onApproved }) => {
  const [requests, setRequests] = useState<PublishRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter === 'pending') params.set('status', 'pending');
      const data = await api.get<PublishRequest[]>(`/admin/publish-requests?${params}`);
      setRequests(targetType ? data.filter(r => r.target_type === targetType) : data);
    } finally {
      setLoading(false);
    }
  }, [filter, targetType]);

  useEffect(() => { load(); }, [load]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const handleApprove = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/admin/publish-requests/${id}/approve`, { note: reviewNote[id] || null });
      showMsg('success', 'Approved and published');
      onApproved?.();
      load();
    } catch (err: unknown) {
      showMsg('error', toApiError(err));
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/admin/publish-requests/${id}/reject`, { note: reviewNote[id] || null });
      showMsg('success', 'Request rejected');
      load();
    } catch (err: unknown) {
      showMsg('error', toApiError(err));
    } finally {
      setActing(null);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
      approved: 'bg-green-400/10 text-green-400 border-green-400/20',
      rejected: 'bg-red-400/10 text-red-400 border-red-400/20',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${map[status] ?? 'bg-slate-400/10 text-slate-400 border-slate-400/20'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Publish Requests</h2>
            <p className="text-xs text-text-muted mt-0.5">Review and approve contributor publish requests</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden text-xs">
              {(['pending', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 capitalize transition-colors ${filter === f ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {msg && (
          <div className={`mx-6 mt-4 px-4 py-2 rounded-lg text-sm border ${msg.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
            {msg.text}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <span className="material-symbols-outlined animate-spin mr-2">autorenew</span>
              Loading…
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-2">
              <span className="material-symbols-outlined text-4xl">pending_actions</span>
              <p className="text-sm">No {filter === 'pending' ? 'pending ' : ''}publish requests</p>
            </div>
          ) : (
            requests.map(r => (
              <div key={r.id} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">{r.target_title}</span>
                      {statusBadge(r.status)}
                      <span className="text-xs text-text-muted capitalize px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700">{r.target_type}</span>
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      Requested by <span className="text-text">{r.requester_name || r.requester_email || 'Unknown'}</span>
                      {r.created_at && ` · ${new Date(r.created_at).toLocaleString()}`}
                    </p>
                    {r.note && r.status !== 'pending' && (
                      <p className="text-xs text-text-muted mt-1">Note: {r.note}</p>
                    )}
                    {r.reviewer_name && (
                      <p className="text-xs text-text-muted mt-0.5">
                        Reviewed by {r.reviewer_name}{r.reviewed_at && ` · ${new Date(r.reviewed_at).toLocaleString()}`}
                      </p>
                    )}
                  </div>
                </div>

                {r.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <input
                      value={reviewNote[r.id] || ''}
                      onChange={e => setReviewNote(n => ({ ...n, [r.id]: e.target.value }))}
                      placeholder="Optional review note…"
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => handleApprove(r.id)}
                      disabled={acting === r.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(r.id)}
                      disabled={acting === r.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">cancel</span>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
