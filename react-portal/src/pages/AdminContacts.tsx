import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

interface ContactEntry {
  id: string;
  division: string;
  name: string;
  title: string;
  email: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

const EMPTY_FORM = { division: '', name: '', title: '', email: '', is_active: true, sort_order: 0 };

export const AdminContacts: React.FC = () => {
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContactEntry | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ContactEntry[]>('/admin/contacts');
      setContacts(data);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (c: ContactEntry) => {
    setEditing(c);
    setForm({ division: c.division, name: c.name, title: c.title, email: c.email, is_active: c.is_active, sort_order: c.sort_order });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.division.trim()) { showMsg('error', 'Division is required'); return; }
    if (!form.name.trim()) { showMsg('error', 'Name is required'); return; }
    if (!form.email.trim() || !form.email.includes('@')) { showMsg('error', 'Valid email is required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/admin/contacts/${editing.id}`, form);
        showMsg('success', 'Contact updated');
      } else {
        await api.post('/admin/contacts', form);
        showMsg('success', 'Contact created');
      }
      setShowForm(false);
      await fetchContacts();
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (c: ContactEntry) => {
    try {
      await api.put(`/admin/contacts/${c.id}`, { is_active: !c.is_active });
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !x.is_active } : x));
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDelete = async (c: ContactEntry) => {
    if (!confirm(`Delete ${c.name}?`)) return;
    try {
      await api.delete(`/admin/contacts/${c.id}`);
      showMsg('success', 'Deleted');
      setContacts(prev => prev.filter(x => x.id !== c.id));
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  // Group by division
  const grouped: { [div: string]: ContactEntry[] } = contacts.reduce((acc, c) => {
    (acc[c.division] = acc[c.division] || []).push(c);
    return acc;
  }, {} as { [div: string]: ContactEntry[] });
  const divisions = Object.keys(grouped).sort();

  // Collect unique division names for datalist
  const divisionNames = [...new Set(contacts.map(c => c.division))].sort();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-1">Contact Directory</h1>
            <p className="text-slate-400 text-sm">Manage division contacts shown on the Contact page</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-sm rounded-lg border border-primary/20 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">person_add</span>
            Add Contact
          </button>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg border text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/20 text-green-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="mb-6 bg-slate-800/60 rounded-xl border border-white/10 p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-200">{editing ? 'Edit Contact' : 'New Contact'}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Division *</label>
                <input
                  type="text"
                  list="division-list"
                  value={form.division}
                  onChange={e => setForm(f => ({ ...f, division: e.target.value }))}
                  placeholder="e.g. Engineering, Product"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                />
                <datalist id="division-list">
                  {divisionNames.map(d => <option key={d} value={d} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Title / Role</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Team Lead, Product Manager"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="name@company.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Sort Order</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-slate-300">Active (visible to users)</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-sm rounded-lg border border-white/10 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-bold rounded-lg border border-primary/20 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : (editing ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        )}

        {/* Contact list */}
        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <span className="material-symbols-outlined text-5xl mb-3 block opacity-30">contacts</span>
            No contacts yet. Add your first division contact.
          </div>
        ) : (
          <div className="space-y-6">
            {divisions.map(division => (
              <div key={division} className="bg-slate-800/40 rounded-xl border border-white/8 overflow-hidden">
                <div className="px-5 py-3 bg-slate-800/60 border-b border-white/8">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{division}</span>
                  <span className="ml-2 text-xs text-slate-600">({grouped[division].length})</span>
                </div>
                <div className="divide-y divide-white/5">
                  {grouped[division].map(c => (
                    <div key={c.id} className={`flex items-center gap-4 px-5 py-4 transition-colors ${c.is_active ? '' : 'opacity-50'}`}>
                      <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-primary">{c.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-white truncate">{c.name}</div>
                        <div className="text-xs text-slate-400 truncate">{c.title && `${c.title} · `}{c.email}</div>
                      </div>
                      {!c.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400 border border-white/10">Inactive</span>
                      )}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleToggle(c)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
                            c.is_active
                              ? 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20'
                              : 'bg-slate-700/40 border-white/10 text-slate-400 hover:bg-slate-700'
                          }`}
                          title={c.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>
                            {c.is_active ? 'visibility' : 'visibility_off'}
                          </span>
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-slate-700/40 hover:bg-slate-700 text-slate-300 border border-white/10 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>edit</span>
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400/60 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
