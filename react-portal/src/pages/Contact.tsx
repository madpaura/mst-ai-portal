import React, { useState, useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { useAuth } from '../api/auth';
import { api, toApiError } from '../api/client';

interface ContactEntry {
  id: string;
  division: string;
  name: string;
  title: string;
  email: string;
}

interface GroupedContacts {
  [division: string]: ContactEntry[];
}

export const Contact: React.FC = () => {
  const { user } = useAuth();

  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<ContactEntry[]>('/contacts')
      .then(setContacts)
      .catch(() => setError('Failed to load contacts'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) {
      setSenderName(user.display_name || user.username || '');
      setSenderEmail(user.email || '');
    }
  }, [user]);

  const grouped: GroupedContacts = contacts.reduce((acc, c) => {
    (acc[c.division] = acc[c.division] || []).push(c);
    return acc;
  }, {} as GroupedContacts);

  const divisions = Object.keys(grouped).sort();
  const allIds = contacts.map(c => c.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));

  const toggleContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleDivision = (division: string) => {
    const ids = grouped[division].map(c => c.id);
    const allIn = ids.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => allIn ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (selectedIds.size === 0) { setError('Please select at least one contact'); return; }
    if (!senderName.trim()) { setError('Please enter your name'); return; }
    if (!senderEmail.trim() || !senderEmail.includes('@')) { setError('Please enter a valid email address'); return; }
    if (!subject.trim()) { setError('Please enter a subject'); return; }
    if (!message.trim()) { setError('Please enter a message'); return; }

    setSending(true);
    try {
      await api.post('/contacts/send', {
        sender_name: senderName.trim(),
        sender_email: senderEmail.trim(),
        subject: subject.trim(),
        message: message.trim(),
        contact_ids: Array.from(selectedIds),
      });
      setSent(true);
    } catch (err: unknown) {
      setError(toApiError(err) || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const selectedContacts = contacts.filter(c => selectedIds.has(c.id));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background-dark font-sans">
      <Navbar />
      <div className="pt-24 pb-16 px-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">Contact Us</h1>
          <p className="text-text-muted text-base">
            Choose the division or person you'd like to reach and send your message directly.
            You'll be CC'd on the email.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <span className="material-symbols-outlined animate-spin text-primary text-4xl">autorenew</span>
          </div>
        ) : sent ? (
          <div className="max-w-lg mx-auto text-center py-24">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined text-3xl text-green-400" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Message Sent!</h2>
            <p className="text-text-muted mb-6">
              Your message was delivered to {selectedContacts.length} contact{selectedContacts.length !== 1 ? 's' : ''}.
              A copy was sent to {senderEmail}.
            </p>
            <button
              onClick={() => { setSent(false); setMessage(''); setSubject(''); setSelectedIds(new Set()); }}
              className="px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors"
            >
              Send Another
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-8">

            {/* Left — contact directory */}
            <div className="col-span-2">
              <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Select Recipients</span>
                  <button
                    onClick={toggleAll}
                    className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-colors ${
                      allSelected
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:text-primary'
                    }`}
                  >
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                {contacts.length === 0 ? (
                  <div className="px-5 py-10 text-center text-slate-400 text-sm">
                    No contacts configured yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {divisions.map(division => {
                      const divContacts = grouped[division];
                      const divIds = divContacts.map(c => c.id);
                      const divAllSelected = divIds.every(id => selectedIds.has(id));
                      const divSomeSelected = divIds.some(id => selectedIds.has(id));

                      return (
                        <div key={division}>
                          {/* Division header */}
                          <button
                            onClick={() => toggleDivision(division)}
                            className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group"
                          >
                            <span className="text-xs font-bold uppercase tracking-wider text-text-muted group-hover:text-primary transition-colors">
                              {division}
                            </span>
                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                              divAllSelected
                                ? 'bg-primary border-primary'
                                : divSomeSelected
                                ? 'bg-primary/30 border-primary/50'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}>
                              {(divAllSelected || divSomeSelected) && (
                                <span className="material-symbols-outlined text-white" style={{ fontSize: '10px', fontVariationSettings: "'FILL' 1" }}>
                                  {divAllSelected ? 'check' : 'remove'}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Contacts in division */}
                          {divContacts.map(contact => {
                            const selected = selectedIds.has(contact.id);
                            return (
                              <button
                                key={contact.id}
                                onClick={() => toggleContact(contact.id)}
                                className={`w-full flex items-center gap-3 px-5 py-3 pl-8 transition-colors text-left ${
                                  selected
                                    ? 'bg-primary/5 dark:bg-primary/10'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/20'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                                  selected ? 'bg-primary border-primary' : 'border-slate-300 dark:border-slate-600'
                                }`}>
                                  {selected && (
                                    <span className="material-symbols-outlined text-white" style={{ fontSize: '10px', fontVariationSettings: "'FILL' 1" }}>check</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{contact.name}</div>
                                  {contact.title && (
                                    <div className="text-xs text-slate-400 truncate">{contact.title}</div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Selected summary */}
              {selectedIds.size > 0 && (
                <div className="mt-3 px-4 py-3 bg-primary/5 dark:bg-primary/10 rounded-xl border border-primary/15 dark:border-primary/20">
                  <p className="text-xs font-semibold text-primary mb-1">
                    {selectedIds.size} recipient{selectedIds.size !== 1 ? 's' : ''} selected
                  </p>
                  <p className="text-xs text-text-muted leading-relaxed line-clamp-3">
                    {selectedContacts.map(c => c.name).join(', ')}
                  </p>
                </div>
              )}
            </div>

            {/* Right — message form */}
            <form onSubmit={handleSubmit} className="col-span-3 space-y-5">
              <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-white/10 p-6 space-y-5">
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Your Details</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1.5">Name *</label>
                    <input
                      type="text"
                      value={senderName}
                      onChange={e => setSenderName(e.target.value)}
                      placeholder="Your name"
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1.5">Email *</label>
                    <input
                      type="email"
                      value={senderEmail}
                      onChange={e => setSenderEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-white/10 p-6 space-y-5">
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Message</h2>
                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1.5">Subject *</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="What's this about?"
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1.5">Message *</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Write your message here..."
                    rows={7}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none transition-colors resize-none"
                  />
                </div>

                {error && (
                  <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-text-faint">
                    {selectedIds.size === 0
                      ? 'Select at least one contact on the left'
                      : `Will be sent to ${selectedIds.size} contact${selectedIds.size !== 1 ? 's' : ''} · you'll be CC'd`}
                  </p>
                  <button
                    type="submit"
                    disabled={sending || selectedIds.size === 0}
                    className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-lg transition-all shadow-[0_0_15px_rgba(37,140,244,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    <span className="material-symbols-outlined text-sm">{sending ? 'hourglass_empty' : 'send'}</span>
                    {sending ? 'Sending…' : 'Send Message'}
                  </button>
                </div>
              </div>
            </form>

          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};
