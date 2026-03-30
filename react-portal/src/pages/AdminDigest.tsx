import React, { useState } from 'react';
import { api } from '../api/client';

interface DigestPreview {
  subject: string;
  html_content: string;
  plain_text: string;
  summary: {
    videos_count: number;
    articles_count: number;
    components_count: number;
    solutions_count: number;
  };
}

export const AdminDigest: React.FC = () => {
  const [digestDays, setDigestDays] = useState(7);
  const [customContent, setCustomContent] = useState('');
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [recipientEmails, setRecipientEmails] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleGeneratePreview = async () => {
    setGenerating(true);
    try {
      const data = await api.post<DigestPreview>('/admin/digest-preview', {
        days: digestDays,
        custom_content: customContent,
      });
      setPreview(data);
      showMsg('success', 'Digest preview generated!');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleViewInNewTab = () => {
    if (!preview) return;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(preview.html_content);
      win.document.close();
    }
  };

  const handleDownloadPdf = () => {
    if (!preview) return;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`
        <html><head><title>${preview.subject}</title>
        <style>@media print { body { margin: 0; } }</style>
        </head><body onload="setTimeout(()=>{window.print();},500)">${preview.html_content}</body></html>
      `);
      win.document.close();
    }
  };

  const handleOpenInEmailClient = async () => {
    if (!preview) return;
    try {
      const token = localStorage.getItem('mst_token');
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/admin/generate-eml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ subject: preview.subject, html_content: preview.html_content, plain_text: preview.plain_text }),
      });
      if (!res.ok) throw new Error('Failed to generate .eml');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = preview.subject.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_').slice(0, 60) + '.eml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showMsg('success', 'Downloaded .eml — open it with Outlook, Thunderbird, or drag into Gmail');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSendDigest = async () => {
    if (!preview) return;

    const emails = recipientEmails
      .split('\n')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (emails.length === 0) {
      showMsg('error', 'Please enter at least one email address');
      return;
    }

    setSending(true);
    try {
      const result = await api.post<{ success: boolean; message: string; sent_count: number }>(
        '/admin/send-digest',
        {
          recipient_emails: emails,
          subject: preview.subject,
          html_content: preview.html_content,
        },
      );
      showMsg('success', result.message);
      if (result.success) {
        setRecipientEmails('');
        setPreview(null);
        setCustomContent('');
      }
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">📚 Learning Digest</h1>
          <p className="text-slate-400">Create and send curated learning newsletters covering videos, articles, and platform updates</p>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              message.type === 'success'
                ? 'bg-green-500/10 border-green-500/20 text-green-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* Left Panel - Settings */}
          <div className="col-span-1 space-y-6">
            <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6">
              <h2 className="text-lg font-bold mb-4">Digest Settings</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Time Period (days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={digestDays}
                    onChange={(e) => setDigestDays(parseInt(e.target.value) || 7)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none"
                  />
                  <p className="text-xs text-slate-500 mt-1">Look back this many days for content</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Custom Message
                  </label>
                  <textarea
                    value={customContent}
                    onChange={(e) => setCustomContent(e.target.value)}
                    placeholder="Add a personal message to include in the digest..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none"
                    rows={4}
                  />
                </div>

                <button
                  onClick={handleGeneratePreview}
                  disabled={generating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-sm rounded-lg transition-colors border border-primary/20 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  {generating ? 'Generating...' : 'Generate Digest'}
                </button>
              </div>
            </div>

            {/* Summary Stats */}
            {preview && (
              <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6">
                <h3 className="text-sm font-bold mb-4">Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Videos:</span>
                    <span className="font-bold">{preview.summary.videos_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Articles:</span>
                    <span className="font-bold">{preview.summary.articles_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Components:</span>
                    <span className="font-bold">{preview.summary.components_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Solutions:</span>
                    <span className="font-bold">{preview.summary.solutions_count}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Preview & Send */}
          <div className="col-span-2 space-y-6">
            {preview ? (
              <>
                {/* Preview */}
                <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold">Preview</h2>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleViewInNewTab}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10"
                        title="View in new tab"
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                        View
                      </button>
                      <button
                        onClick={handleDownloadPdf}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10"
                        title="Download as PDF"
                      >
                        <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
                        PDF
                      </button>
                      <button
                        onClick={handleOpenInEmailClient}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium rounded-lg transition-colors border border-blue-500/20"
                        title="Open in external email client (Outlook, etc.)"
                      >
                        <span className="material-symbols-outlined text-sm">forward_to_inbox</span>
                        Email Client
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Subject
                      </label>
                      <p className="text-sm font-semibold text-white">{preview.subject}</p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Email Preview
                      </label>
                      <div
                        className="bg-white dark:bg-slate-900 rounded-lg p-4 text-slate-900 dark:text-white text-sm max-h-96 overflow-y-auto border border-white/10"
                        dangerouslySetInnerHTML={{ __html: preview.html_content }}
                      />
                    </div>
                  </div>
                </div>

                {/* Send Recipients */}
                <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6">
                  <h2 className="text-lg font-bold mb-4">Send To Recipients</h2>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Recipient Emails (one per line)
                      </label>
                      <textarea
                        value={recipientEmails}
                        onChange={(e) => setRecipientEmails(e.target.value)}
                        placeholder="user1@example.com&#10;user2@example.com&#10;team@example.com"
                        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none font-mono"
                        rows={5}
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        {recipientEmails
                          .split('\n')
                          .filter((e) => e.trim().length > 0).length}{' '}
                        recipients
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={handleSendDigest}
                        disabled={sending || recipientEmails.trim().length === 0}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 font-bold text-sm rounded-lg transition-colors border border-green-500/20 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-sm">send</span>
                        {sending ? 'Sending...' : 'Send Digest'}
                      </button>
                      <button
                        onClick={() => {
                          setPreview(null);
                          setRecipientEmails('');
                        }}
                        className="px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-bold text-sm rounded-lg transition-colors border border-white/10"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-slate-800/50 rounded-xl border border-white/10 p-12 text-center">
                <span className="material-symbols-outlined text-6xl mb-4 opacity-20">mail</span>
                <p className="text-slate-400">Generate a digest preview to get started</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
