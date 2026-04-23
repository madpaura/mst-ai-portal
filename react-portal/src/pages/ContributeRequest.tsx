import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../api/auth';

interface ContributeRequestData {
  id: string;
  status: string;
  reason: string;
  admin_note: string | null;
  created_at: string;
}

export const ContributeRequest: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingRequest, setExistingRequest] = useState<ContributeRequestData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/ignite'); return; }
    api.get<ContributeRequestData | null>('/auth/contribute-request')
      .then(setExistingRequest)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authLoading, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please describe why you want to contribute.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const req = await api.post<ContributeRequestData>('/auth/contribute-request', { reason: reason.trim() });
      setExistingRequest(req);
      setReason('');
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const userRole = user?.role ?? null;

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
        <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
      </div>
    );
  }

  const statusColor = {
    pending: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    approved: 'text-green-500 bg-green-500/10 border-green-500/20',
    rejected: 'text-red-400 bg-red-400/10 border-red-400/20',
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 font-sans">
      <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        {/* Back link */}
        <Link to="/ignite" className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary transition-colors mb-8">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Learn
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <span className="material-symbols-outlined text-primary text-3xl">volunteer_activism</span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Interested in Contributing?</h1>
            <p className="text-sm text-slate-500 mt-1">Apply to become a content creator on the portal</p>
          </div>
        </div>

        {/* User level info */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { role: 'user', label: 'Viewer', icon: 'visibility', desc: 'Watch videos, read articles, browse marketplace', color: 'text-slate-500' },
            { role: 'content', label: 'Content Creator', icon: 'edit_note', desc: 'Upload videos, write articles, publish marketplace items', color: 'text-primary' },
            { role: 'admin', label: 'Admin', icon: 'admin_panel_settings', desc: 'Full site access including user management', color: 'text-purple-500' },
          ].map((level) => (
            <div
              key={level.role}
              className={`p-4 rounded-xl border transition-all ${
                userRole === level.role
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/30'
              }`}
            >
              <span className={`material-symbols-outlined text-2xl ${level.color} mb-2 block`}>{level.icon}</span>
              <p className={`text-xs font-bold ${userRole === level.role ? 'text-primary' : 'text-slate-700 dark:text-slate-200'} mb-1`}>
                {level.label}
                {userRole === level.role && <span className="ml-1 text-[9px] bg-primary/20 text-primary px-1 rounded">You</span>}
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">{level.desc}</p>
            </div>
          ))}
        </div>

        {/* Already a content creator or admin */}
        {userRole && userRole !== 'user' && (
          <div className="p-6 rounded-xl border border-green-500/20 bg-green-500/5 text-center">
            <span className="material-symbols-outlined text-green-500 text-3xl mb-2 block">check_circle</span>
            <p className="font-bold text-slate-900 dark:text-white mb-1">
              You already have {userRole === 'admin' ? 'admin' : 'content creator'} access!
            </p>
            <Link to="/ignite" className="text-primary text-sm hover:underline">Return to Learn</Link>
          </div>
        )}

        {/* Existing request status */}
        {userRole === 'user' && existingRequest && existingRequest.status !== 'rejected' && (
          <div className={`p-6 rounded-xl border ${statusColor[existingRequest.status as keyof typeof statusColor] || 'border-slate-200'}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className="material-symbols-outlined text-2xl">
                {existingRequest.status === 'pending' ? 'hourglass_empty' : existingRequest.status === 'approved' ? 'check_circle' : 'cancel'}
              </span>
              <div>
                <p className="font-bold text-slate-900 dark:text-white capitalize">{existingRequest.status}</p>
                <p className="text-xs text-slate-500">{new Date(existingRequest.created_at).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="bg-white/50 dark:bg-black/20 rounded-lg p-3 mb-3">
              <p className="text-xs text-slate-500 mb-1 font-bold uppercase tracking-wider">Your reason</p>
              <p className="text-sm text-slate-700 dark:text-slate-200">{existingRequest.reason}</p>
            </div>
            {existingRequest.admin_note && (
              <div className="bg-white/50 dark:bg-black/20 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1 font-bold uppercase tracking-wider">Admin note</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">{existingRequest.admin_note}</p>
              </div>
            )}
          </div>
        )}

        {/* Request form — show if no existing request, or if rejected */}
        {userRole === 'user' && (!existingRequest || existingRequest.status === 'rejected') && (
          <form onSubmit={handleSubmit} className="bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/10 rounded-xl p-6">
            {existingRequest?.status === 'rejected' && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs text-amber-500 font-bold mb-1">Previous request was rejected</p>
                {existingRequest.admin_note && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">{existingRequest.admin_note}</p>
                )}
              </div>
            )}

            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Submit a request</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Why do you want to contribute?
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={5}
                placeholder="Describe what kind of content you'd like to create (videos, articles, marketplace components), your expertise, and how it would benefit the team..."
                className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none transition-all"
                required
              />
              <p className="text-[11px] text-slate-400 mt-1">{reason.length} characters</p>
            </div>

            {error && (
              <p className="text-sm text-red-400 mb-4 p-3 bg-red-400/10 rounded-lg border border-red-400/20">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary hover:bg-blue-500 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-[20px]">send</span>
              )}
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>

            <p className="text-[11px] text-slate-400 text-center mt-3">
              An admin will review your request and grant access if approved.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
