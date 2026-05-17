import React, { useState, useEffect } from 'react';
import { api, toApiError } from '../api/client';

export const PublishAuthority: React.FC = () => {
  const [emails, setEmails] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.get<string[]>('/admin/publish-authority')
      .then(data => setEmails(data || []))
      .catch(() => setEmails([]))
      .finally(() => setLoading(false));
  }, []);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const addEmail = () => {
    const e = input.trim().toLowerCase();
    if (!e || !e.includes('@')) { showMsg('error', 'Enter a valid email'); return; }
    if (emails.includes(e)) { showMsg('error', 'Already in list'); return; }
    setEmails(prev => [...prev, e]);
    setInput('');
  };

  const removeEmail = (email: string) => {
    setEmails(prev => prev.filter(e => e !== email));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/admin/publish-authority', { emails });
      showMsg('success', 'Publish authority saved');
    } catch (err: unknown) {
      showMsg('error', toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden mb-6">
      <div className="px-5 py-3 bg-panel-light dark:bg-panel-dark/60 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">Publish Authority</span>
          <span className="ml-2 text-xs text-slate-500">Who receives publish request notifications</span>
        </div>
        <span className="material-symbols-outlined text-sm text-amber-500">pending_actions</span>
      </div>

      {msg && (
        <div className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs border ${msg.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {msg.text}
        </div>
      )}

      <div className="p-5 space-y-4">
        {loading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEmail()}
                placeholder="name@company.com"
                className="flex-1 px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
              />
              <button
                onClick={addEmail}
                className="flex items-center gap-1 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-sm transition-colors"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Add
              </button>
            </div>

            {emails.length > 0 ? (
              <div className="space-y-2">
                {emails.map(email => (
                  <div key={email} className="flex items-center justify-between px-3 py-2 bg-panel-light dark:bg-panel-dark/50 rounded-lg border border-slate-200 dark:border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm text-amber-500">person</span>
                      <span className="text-sm text-slate-700 dark:text-slate-300">{email}</span>
                    </div>
                    <button
                      onClick={() => removeEmail(email)}
                      className="text-slate-400 hover:text-red-400 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No publish authority set — only admins will be notified.</p>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
