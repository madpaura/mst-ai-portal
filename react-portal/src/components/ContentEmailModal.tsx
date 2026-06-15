import { useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import { api, toApiError } from '../api/client';

interface EmailPreview {
  subject: string;
  html_content: string;
  plain_text: string;
}

interface ContentEmailModalProps {
  open: boolean;
  /** Short label for the item being emailed, shown in the header. */
  title: string;
  /** Backend endpoint that generates the LLM preview, e.g. `/admin/articles/{id}/email-preview`. */
  previewPath: string;
  /** Backend endpoint that sends the email, e.g. `/admin/articles/{id}/send-email`. */
  sendPath: string;
  onClose: () => void;
}

const SAVED_KEY = 'mst_content_email_saved';

/**
 * Self-contained "email this content item" workflow — mirrors the AdminVideos
 * Email tab (generate LLM preview → review → pick recipients → batched send),
 * reused for articles and marketplace components.
 */
export function ContentEmailModal({ open, title, previewPath, sendPath, onClose }: ContentEmailModalProps) {
  const [customContent, setCustomContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [subject, setSubject] = useState('');
  const [recipients, setRecipients] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [savedAddresses, setSavedAddresses] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    window.setTimeout(() => setMsg(null), 4000);
  };

  const persistSaved = (list: string[]) => {
    setSavedAddresses(list);
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  };

  const recipientList = () => recipients.split('\n').map(x => x.trim()).filter(x => x.includes('@'));

  const close = () => {
    setPreview(null); setSubject(''); setRecipients(''); setCustomContent(''); setMsg(null);
    onClose();
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const p = await api.post<EmailPreview>(previewPath, { custom_content: customContent });
      setPreview(p);
      setSubject(p.subject);
      flash('success', 'Email preview generated!');
    } catch (err: unknown) {
      flash('error', toApiError(err));
    } finally {
      setGenerating(false);
    }
  };

  const downloadEml = async () => {
    if (!preview) return;
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/admin/generate-eml`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject || preview.subject, html_content: preview.html_content, plain_text: preview.plain_text }),
      });
      if (!res.ok) throw new Error('Failed to generate .eml');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (subject || preview.subject).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_').slice(0, 60) + '.eml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      flash('success', 'Downloaded .eml — open with Outlook, Thunderbird, or drag into Gmail');
    } catch (err: unknown) {
      flash('error', toApiError(err));
    }
  };

  const send = async () => {
    if (!preview) return;
    const emails = recipientList();
    if (emails.length === 0) { flash('error', 'Please enter at least one valid email address'); return; }
    setSending(true);
    try {
      const batchSize = 50;
      const batches: string[][] = [];
      for (let i = 0; i < emails.length; i += batchSize) batches.push(emails.slice(i, i + batchSize));
      let totalSent = 0;
      for (let b = 0; b < batches.length; b++) {
        setProgress(batches.length > 1 ? `Batch ${b + 1}/${batches.length}…` : '');
        const result = await api.post<{ success: boolean; message: string; sent_count: number }>(
          sendPath,
          { recipient_emails: batches[b], subject: subject || preview.subject, html_content: preview.html_content, plain_text: preview.plain_text },
        );
        totalSent += result.sent_count;
        persistSaved([...new Set([...savedAddresses, ...batches[b]])]);
        if (b < batches.length - 1) await new Promise(r => setTimeout(r, 600));
      }
      flash('success', `Sent to ${totalSent}/${emails.length} recipient(s)`);
      setRecipients(''); setPreview(null); setSubject(''); setCustomContent('');
    } catch (err: unknown) {
      flash('error', toApiError(err));
    } finally {
      setSending(false);
      setProgress('');
    }
  };

  const list = recipientList();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/10 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-primary">mail</span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">Email — {title}</h3>
          </div>
          <button onClick={close} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {msg && (
            <div className={`text-xs font-medium px-3 py-2 rounded-lg ${msg.type === 'success' ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
              {msg.text}
            </div>
          )}

          {/* Generate */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Custom Content (optional)</label>
              <textarea
                value={customContent}
                onChange={(e) => setCustomContent(e.target.value)}
                placeholder="Add any additional content to include in the email..."
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none"
                rows={3}
              />
            </div>
            <button
              onClick={generate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-sm rounded-lg transition-colors border border-primary/20 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              {generating ? 'Generating...' : 'Generate Preview'}
            </button>
          </div>

          {/* Preview & Send */}
          {preview && (
            <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(DOMPurify.sanitize(preview.html_content)); w.document.close(); } }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-200 dark:border-white/10"
                  title="View in new tab"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  View
                </button>
                <button
                  onClick={() => {
                    const w = window.open('', '_blank');
                    if (w) { w.document.write(`<html><head><title>${subject || preview.subject}</title><style>@media print { body { margin: 0; } }</style></head><body onload="setTimeout(()=>{window.print();},500)">${DOMPurify.sanitize(preview.html_content)}</body></html>`); w.document.close(); }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-200 dark:border-white/10"
                  title="Download as PDF"
                >
                  <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
                  PDF
                </button>
                <button
                  onClick={downloadEml}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium rounded-lg transition-colors border border-blue-500/20"
                  title="Download .eml for external email client (Outlook, etc.)"
                >
                  <span className="material-symbols-outlined text-sm">forward_to_inbox</span>
                  Email Client
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Preview</label>
                <div
                  className="bg-white dark:bg-slate-900 rounded-lg p-4 text-slate-900 dark:text-white text-sm max-h-64 overflow-y-auto border border-slate-200 dark:border-white/10"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.html_content) }}
                />
              </div>

              {/* Recipients */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider">Send To</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => csvRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-200 dark:border-white/10"
                    title="Import emails from CSV"
                  >
                    <span className="material-symbols-outlined text-sm">upload_file</span>
                    CSV
                  </button>
                  <input
                    ref={csvRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const text = ev.target?.result as string;
                        const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
                        const found = Array.from(new Set(text.match(emailRegex) || []));
                        if (found.length === 0) { flash('error', 'No valid emails found in CSV'); return; }
                        const current = recipients.split('\n').map(x => x.trim()).filter(Boolean);
                        setRecipients([...new Set([...current, ...found])].join('\n'));
                        persistSaved([...new Set([...savedAddresses, ...found])]);
                        flash('success', `Loaded ${found.length} email(s) from CSV`);
                      };
                      reader.readAsText(file);
                      e.target.value = '';
                    }}
                  />
                  {savedAddresses.length > 0 && (
                    <button
                      onClick={() => setShowSaved(v => !v)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium rounded-lg transition-colors border border-primary/20"
                    >
                      <span className="material-symbols-outlined text-sm">bookmarks</span>
                      Saved ({savedAddresses.length})
                    </button>
                  )}
                </div>

                {showSaved && savedAddresses.length > 0 && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-white/5 rounded-lg space-y-1.5 max-h-40 overflow-y-auto">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Saved</span>
                      <button
                        onClick={() => {
                          const current = recipients.split('\n').map(x => x.trim()).filter(Boolean);
                          setRecipients([...new Set([...current, ...savedAddresses])].join('\n'));
                        }}
                        className="text-xs text-primary hover:text-slate-900 dark:hover:text-white transition-colors"
                      >Add all</button>
                    </div>
                    {savedAddresses.map(addr => {
                      const active = recipients.split('\n').map(x => x.trim()).includes(addr);
                      return (
                        <div key={addr} className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const current = recipients.split('\n').map(x => x.trim()).filter(Boolean);
                              if (current.includes(addr)) setRecipients(current.filter(x => x !== addr).join('\n'));
                              else setRecipients([...current, addr].join('\n'));
                            }}
                            className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition-colors font-mono truncate ${active ? 'bg-primary/15 text-primary border border-primary/20' : 'text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                          >
                            {active && <span className="mr-1">✓</span>}{addr}
                          </button>
                          <button
                            onClick={() => persistSaved(savedAddresses.filter(x => x !== addr))}
                            className="text-red-400/50 hover:text-red-400 transition-colors"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>close</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <textarea
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder={"user1@example.com\nuser2@example.com\nteam@example.com"}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none font-mono"
                  rows={4}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">{list.length} recipient{list.length !== 1 ? 's' : ''}</p>
                  {list.length > 0 && (
                    <button
                      onClick={() => { persistSaved([...new Set([...savedAddresses, ...list])]); flash('success', 'Saved to quick-access'); }}
                      className="text-xs text-slate-500 hover:text-primary transition-colors"
                    >Save to quick-access</button>
                  )}
                </div>
              </div>

              <button
                onClick={send}
                disabled={sending || !recipients.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 text-green-700 dark:text-green-400 font-bold text-sm rounded-lg transition-colors border border-green-200 dark:border-green-500/20 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">{sending ? 'hourglass_empty' : 'send'}</span>
                {sending ? (progress || 'Sending…') : 'Send Email'}
              </button>
            </div>
          )}

          {!preview && (
            <p className="text-sm text-slate-500 py-2">Generate a preview first to see the email content before sending.</p>
          )}
        </div>
      </div>
    </div>
  );
}
