import React, { useEffect, useMemo, useState } from 'react';
import { api, toApiError } from '../api/client';

// Self-contained announcement poster, served statically from public/posters/.
// Generated from doc/portal-announcement-poster-offerings.html (fonts embedded).
const POSTER_URL = '/posters/portal-offerings.html';

interface PosterSenderCardProps {
  onMessage: (type: 'success' | 'error', text: string) => void;
}

const parseEmails = (raw: string) =>
  raw.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes('@'));

/**
 * "Announcement Poster" sender (Admin → Settings).
 * Loads the bundled, self-contained offerings poster and sends it as the
 * email body (not an attachment) to To/BCC recipients via /admin/send-html-email.
 */
export const PosterSenderCard: React.FC<PosterSenderCardProps> = ({ onMessage }) => {
  const [html, setHtml] = useState('');
  const [subject, setSubject] = useState('MST AI Portal — What It Offers');
  const [toEmails, setToEmails] = useState('');
  const [bccEmails, setBccEmails] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(POSTER_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => {
        if (cancelled) return;
        setHtml(text);
        const m = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (m) setSubject(m[1].trim());
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, []);

  const previewUrl = useMemo(
    () => (html ? URL.createObjectURL(new Blob([html], { type: 'text/html' })) : null),
    [html],
  );
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const sizeKb = html ? (new Blob([html]).size / 1024).toFixed(0) : '0';
  const totalRecipients = parseEmails(toEmails).length + parseEmails(bccEmails).length;

  const handleSend = async () => {
    const to = parseEmails(toEmails);
    const bcc = parseEmails(bccEmails);
    if (!html) { onMessage('error', 'Poster has not loaded yet'); return; }
    if (!subject.trim()) { onMessage('error', 'Subject is required'); return; }
    if (!to.length && !bcc.length) {
      onMessage('error', 'Add at least one recipient (To or BCC)');
      return;
    }
    setSending(true);
    try {
      const res = await api.post<{ success: boolean; message: string; sent_count: number }>(
        '/admin/send-html-email',
        { subject, html_content: html, to_emails: to, bcc_emails: bcc },
      );
      onMessage(res.success ? 'success' : 'error', res.message);
    } catch (err: unknown) {
      onMessage('error', toApiError(err) || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-100 dark:border-white/5 p-6 mb-8">
      <div className="flex items-center gap-3 mb-5">
        <span className="material-symbols-outlined text-primary">campaign</span>
        <div className="flex-1">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Announcement Poster</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Send the self-contained portal offerings poster as an email — embedded in the body, not attached
          </p>
        </div>
        {html && (
          <span className="text-xs text-emerald-500 flex items-center gap-1 shrink-0">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            {sizeKb} KB loaded
          </span>
        )}
      </div>

      {loadError ? (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-base">error</span>
          Could not load the poster from {POSTER_URL}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Email subject line"
              className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Recipients */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                To <span className="text-slate-400">(visible)</span>
              </label>
              <textarea
                value={toEmails}
                onChange={e => setToEmails(e.target.value)}
                placeholder="one@example.com, two@example.com"
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                BCC <span className="text-slate-400">(hidden — for blasts)</span>
              </label>
              <textarea
                value={bccEmails}
                onChange={e => setBccEmails(e.target.value)}
                placeholder="one@example.com, two@example.com"
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSend}
              disabled={sending || !html}
              className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
            >
              <span className={`material-symbols-outlined text-sm ${sending ? 'animate-spin' : ''}`}>
                {sending ? 'progress_activity' : 'send'}
              </span>
              {sending ? 'Sending…' : 'Send Poster'}
            </button>
            <button
              onClick={() => setShowPreview(p => !p)}
              disabled={!html}
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-white/10 hover:border-primary text-slate-600 dark:text-slate-300 hover:text-primary disabled:opacity-40 text-sm font-medium rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-sm">{showPreview ? 'visibility_off' : 'preview'}</span>
              {showPreview ? 'Hide preview' : 'Preview'}
            </button>
            <span className="text-xs text-text-muted">{totalRecipients} recipient(s)</span>
          </div>

          {showPreview && previewUrl && (
            <div className="rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden bg-white">
              <iframe
                key={previewUrl}
                src={previewUrl}
                title="Poster preview"
                className="w-full border-0"
                style={{ height: '520px' }}
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
