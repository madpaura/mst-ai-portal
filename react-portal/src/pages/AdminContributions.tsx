import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

interface ContributeRequest {
  id: string;
  user_id: string;
  reason: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  approved: 'bg-green-500/10 text-green-500 border-green-500/20',
  rejected: 'bg-red-400/10 text-red-400 border-red-400/20',
};

export const AdminContributions: React.FC = () => {
  const [requests, setRequests] = useState<ContributeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchRequests = useCallback(async () => {
    try {
      const data = await api.get<ContributeRequest[]>('/auth/admin/contribute-requests');
      setRequests(data);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    setProcessing(id);
    try {
      await api.put(`/auth/admin/contribute-requests/${id}`, {
        status,
        admin_note: reviewNote[id] || null,
      });
      showMsg('success', `Request ${status}`);
      await fetchRequests();
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading...</div>;
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const reviewed = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Contribution Requests</h1>
        <p className="text-sm text-slate-400 mt-1">
          Approve to grant content creator access. Reject with a note explaining why.
        </p>
      </div>

      {/* User Levels Reference */}
      <div className="mb-6 p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/30">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">User Roles</h2>
        <div className="flex gap-4 text-xs text-slate-500">
          <span><strong className="text-slate-700 dark:text-slate-300">user</strong> — view only</span>
          <span><strong className="text-primary">content</strong> — videos, articles, marketplace</span>
          <span><strong className="text-purple-400">admin</strong> — full access</span>
        </div>
      </div>

      {/* Pending Requests */}
      <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">
        Pending ({pending.length})
      </h2>
      {pending.length === 0 && (
        <p className="text-sm text-slate-400 mb-6 italic">No pending requests.</p>
      )}
      <div className="space-y-4 mb-8">
        {pending.map((req) => (
          <div key={req.id} className="bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${STATUS_STYLES[req.status]}`}>
                  {req.status}
                </span>
                <span className="ml-2 text-xs text-slate-400">{new Date(req.created_at).toLocaleDateString()}</span>
              </div>
              <span className="text-xs text-slate-400 font-mono truncate max-w-[180px]">{req.user_id}</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 mb-3">
              <p className="text-xs text-slate-500 mb-1 font-bold uppercase tracking-wider">Reason</p>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{req.reason}</p>
            </div>
            <div className="mb-3">
              <textarea
                placeholder="Admin note (optional — visible to user)"
                value={reviewNote[req.id] || ''}
                onChange={(e) => setReviewNote((n) => ({ ...n, [req.id]: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none resize-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleReview(req.id, 'approved')}
                disabled={processing === req.id}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-400 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Approve
              </button>
              <button
                onClick={() => handleReview(req.id, 'rejected')}
                disabled={processing === req.id}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">cancel</span>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Reviewed Requests */}
      {reviewed.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Reviewed ({reviewed.length})</h2>
          <div className="space-y-2">
            {reviewed.map((req) => (
              <div key={req.id} className="px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 flex items-center gap-4">
                <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${STATUS_STYLES[req.status]}`}>
                  {req.status}
                </span>
                <span className="text-xs text-slate-500 font-mono truncate flex-1">{req.user_id}</span>
                <span className="text-xs text-slate-400">{new Date(req.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
