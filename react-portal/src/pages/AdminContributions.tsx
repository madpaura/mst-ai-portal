import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../api/auth';

interface GuestInterest {
  id: number;
  email: string;
  source: string;
  status: string;
  admin_note: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface ContributeRequest {
  id: string;
  user_id: string;
  reason: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: string;
  initials: string | null;
  created_at: string;
}

interface NewUserForm {
  username: string;
  display_name: string;
  password: string;
  role: 'user' | 'content' | 'admin';
  email: string;
}

const BLANK_USER: NewUserForm = { username: '', display_name: '', password: '', role: 'user', email: '' };

const ROLE_STYLE: Record<string, string> = {
  admin: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  content: 'text-primary bg-primary/10 border-primary/20',
  user: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  approved: 'bg-green-500/10 text-green-500 border-green-500/20',
  rejected: 'bg-red-400/10 text-red-400 border-red-400/20',
  contacted: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
  dismissed: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
};

export const AdminContributions: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [requests, setRequests] = useState<ContributeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Guest interests
  const [guestInterests, setGuestInterests] = useState<GuestInterest[]>([]);
  const [guestNotes, setGuestNotes] = useState<Record<number, string>>({});
  const [guestProcessing, setGuestProcessing] = useState<number | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // User list
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  // Create user form
  const [newUser, setNewUser] = useState<NewUserForm>(BLANK_USER);
  const [creatingUser, setCreatingUser] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.get<UserRecord[]>('/auth/admin/users');
      setUsers(data);
    } catch { /* ignore */ }
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.display_name.trim() || !newUser.password.trim()) return;
    setCreatingUser(true);
    try {
      await api.post('/auth/admin/users', {
        username: newUser.username.trim(),
        display_name: newUser.display_name.trim(),
        password: newUser.password,
        role: newUser.role,
        email: newUser.email.trim() || null,
      });
      showMsg('success', `User "${newUser.username}" created`);
      setNewUser(BLANK_USER);
      setShowCreateForm(false);
      fetchUsers();
    } catch (err: any) {
      showMsg('error', err.message || 'Failed to create user');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleDeleteUser = async (u: UserRecord) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    setDeletingId(u.id);
    try {
      await api.delete(`/auth/admin/users/${u.id}`);
      showMsg('success', `User "${u.username}" deleted`);
      fetchUsers();
    } catch (err: any) {
      showMsg('error', err.message || 'Failed to delete user');
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || !resetPassword.trim()) return;
    setResetting(true);
    try {
      await api.put(`/auth/admin/users/${resetTarget.id}/password`, { new_password: resetPassword });
      showMsg('success', `Password reset for "${resetTarget.username}"`);
      setResetTarget(null);
      setResetPassword('');
    } catch (err: any) {
      showMsg('error', err.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
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

  const fetchGuestInterests = useCallback(async () => {
    try {
      const data = await api.get<GuestInterest[]>('/auth/admin/guest-interests');
      setGuestInterests(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchRequests(); fetchUsers(); fetchGuestInterests(); }, [fetchRequests, fetchUsers, fetchGuestInterests]);

  const handleGuestAction = async (id: number, status: 'contacted' | 'dismissed') => {
    setGuestProcessing(id);
    try {
      await api.put(`/auth/admin/guest-interests/${id}`, { status, admin_note: guestNotes[id] || null });
      showMsg('success', `Marked as ${status}`);
      fetchGuestInterests();
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setGuestProcessing(null);
    }
  };

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

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Contributors</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage contribution requests and add internal test users.
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-sm">person_add</span>
          Add User
        </button>
      </div>

      {/* Create User Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateUser} className="mb-6 p-5 rounded-xl border border-primary/20 bg-primary/5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-base">person_add</span>
            Create New User
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Username *</label>
              <input
                required
                value={newUser.username}
                onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
                placeholder="jsmith"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Display Name *</label>
              <input
                required
                value={newUser.display_name}
                onChange={(e) => setNewUser((u) => ({ ...u, display_name: e.target.value }))}
                placeholder="John Smith"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Password *</label>
              <input
                required
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                placeholder="Temporary password"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Email (optional)</label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
                placeholder="jsmith@example.com"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-500 mb-1">Role</label>
            <div className="flex gap-2">
              {(['user', 'content', 'admin'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNewUser((u) => ({ ...u, role: r }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    newUser.role === r
                      ? r === 'admin' ? 'bg-purple-500/20 border-purple-500/40 text-purple-400'
                        : r === 'content' ? 'bg-primary/20 border-primary/40 text-primary'
                        : 'bg-slate-200 dark:bg-slate-700 border-slate-400 dark:border-slate-500 text-slate-700 dark:text-slate-200'
                      : 'border-slate-200 dark:border-white/10 text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creatingUser}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              {creatingUser
                ? <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                : <span className="material-symbols-outlined text-sm">check</span>}
              {creatingUser ? 'Creating...' : 'Create User'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreateForm(false); setNewUser(BLANK_USER); }}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

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
          <div className="space-y-2 mb-10">
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

      {/* ── Guest Interest Signups ────────────────────────── */}
      <div className="border-t border-slate-200 dark:border-white/10 pt-8 mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-amber-400">mail</span>
            Guest Interest Signups ({guestInterests.filter(g => g.status === 'pending').length} pending)
          </h2>
          <button
            onClick={() => setShowDismissed(v => !v)}
            className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
          </button>
        </div>

        {guestInterests.filter(g => showDismissed || g.status !== 'dismissed').length === 0 ? (
          <p className="text-sm text-slate-400 italic">No guest interest submissions.</p>
        ) : (
          <div className="space-y-3">
            {guestInterests
              .filter(g => showDismissed || g.status !== 'dismissed')
              .map(g => (
                <div key={g.id} className="bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/10 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400 text-xs font-bold shrink-0">
                        {g.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{g.email}</div>
                        <div className="text-xs text-slate-400">
                          {g.source} · {new Date(g.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${STATUS_STYLES[g.status]}`}>
                      {g.status}
                    </span>
                  </div>

                  {g.status === 'pending' && (
                    <>
                      <textarea
                        placeholder="Note (optional)"
                        value={guestNotes[g.id] || ''}
                        onChange={e => setGuestNotes(n => ({ ...n, [g.id]: e.target.value }))}
                        rows={2}
                        className="w-full px-3 py-2 mb-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none resize-none"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleGuestAction(g.id, 'contacted')}
                          disabled={guestProcessing === g.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-sm">mark_email_read</span>
                          Mark Contacted
                        </button>
                        <button
                          onClick={() => {
                            setNewUser(u => ({ ...u, email: g.email }));
                            setShowCreateForm(true);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-bold rounded-lg transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">person_add</span>
                          Create Account
                        </button>
                        <button
                          onClick={() => handleGuestAction(g.id, 'dismissed')}
                          disabled={guestProcessing === g.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-slate-400 hover:text-slate-300 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                          Dismiss
                        </button>
                      </div>
                    </>
                  )}

                  {g.status !== 'pending' && g.admin_note && (
                    <p className="text-xs text-slate-400 italic mt-1">Note: {g.admin_note}</p>
                  )}
                  {g.status !== 'pending' && g.reviewer_name && (
                    <p className="text-xs text-slate-500 mt-0.5">by {g.reviewer_name} · {g.reviewed_at ? new Date(g.reviewed_at).toLocaleDateString() : ''}</p>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── User List ─────────────────────────────────────── */}
      <div className="border-t border-slate-200 dark:border-white/10 pt-8">
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-primary">group</span>
          All Users ({users.length})
        </h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark">
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                {u.initials || u.display_name.charAt(0).toUpperCase()}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{u.display_name}</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${ROLE_STYLE[u.role] || ROLE_STYLE.user}`}>
                    {u.role}
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-mono">{u.username}{u.email ? ` · ${u.email}` : ''}</span>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setResetTarget(u); setResetPassword(''); }}
                  disabled={deletingId === u.id}
                  title="Reset password"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">lock_reset</span>
                </button>
                {currentUser?.id !== u.id && (
                  <button
                    onClick={() => handleDeleteUser(u)}
                    disabled={deletingId === u.id}
                    title="Delete user"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                  >
                    {deletingId === u.id
                      ? <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                      : <span className="material-symbols-outlined text-[18px]">delete</span>}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <form
            onSubmit={handleResetPassword}
            className="bg-card-light dark:bg-card-dark border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Reset Password</h3>
            <p className="text-xs text-slate-400 mb-4">
              Set a new password for <strong className="text-slate-600 dark:text-slate-300">{resetTarget.username}</strong>
            </p>
            <input
              type="password"
              required
              autoFocus
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="New password"
              className="w-full px-3 py-2 mb-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={resetting || resetPassword.length < 4}
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {resetting
                  ? <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                  : <span className="material-symbols-outlined text-sm">lock_reset</span>}
                {resetting ? 'Saving...' : 'Reset Password'}
              </button>
              <button
                type="button"
                onClick={() => { setResetTarget(null); setResetPassword(''); }}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
