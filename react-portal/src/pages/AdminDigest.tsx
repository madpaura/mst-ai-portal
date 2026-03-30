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
  issue_number?: number;
  title?: string;
}

interface DigestIssue {
  id: number;
  issue_number: number;
  title: string;
  subject: string;
  created_at: string;
  sent_at: string | null;
  recipient_count: number;
  days_covered: number;
}

export const AdminDigest: React.FC = () => {
  const [digestDays, setDigestDays] = useState(7);
  const [customContent, setCustomContent] = useState('');
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [editedSubject, setEditedSubject] = useState('');
  const [recipientEmails, setRecipientEmails] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingStep, setGeneratingStep] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingIssueId, setLoadingIssueId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [digestIssues, setDigestIssues] = useState<DigestIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const setPreviewWithSubject = (data: DigestPreview) => {
    setPreview(data);
    setEditedSubject(data.subject);
  };

  const handleGeneratePreview = async () => {
    setGenerating(true);
    setGeneratingStep('Fetching content…');
    try {
      setTimeout(() => setGeneratingStep('Summarising with AI…'), 1500);
      setTimeout(() => setGeneratingStep('Building email…'), 4000);
      const data = await api.post<DigestPreview>('/admin/digest-preview', {
        days: digestDays,
        custom_content: customContent,
      });
      setPreviewWithSubject(data);
      showMsg('success', 'Digest preview generated!');
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setGenerating(false);
      setGeneratingStep('');
    }
  };

  const handleLoadIssue = async (issueId: number) => {
    setLoadingIssueId(issueId);
    try {
      const data = await api.get<{
        id: number;
        issue_number: number;
        title: string;
        subject: string;
        html_content: string;
        plain_text: string;
        summary: DigestPreview['summary'];
        days_covered: number;
        custom_content: string;
      }>(`/admin/digest-issues/${issueId}`);
      setPreviewWithSubject({
        subject: data.subject,
        html_content: data.html_content,
        plain_text: data.plain_text,
        summary: data.summary,
        issue_number: data.issue_number,
        title: data.title,
      });
      setDigestDays(data.days_covered);
      setCustomContent(data.custom_content || '');
      showMsg('success', `Loaded issue #${data.issue_number}`);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoadingIssueId(null);
    }
  };

  const handleRegenerateIssue = async (issue: DigestIssue) => {
    setDigestDays(issue.days_covered);
    // Load custom_content from full issue first, then regenerate
    setLoadingIssueId(issue.id);
    try {
      const data = await api.get<{ custom_content: string }>(`/admin/digest-issues/${issue.id}`);
      const custom = data.custom_content || '';
      setCustomContent(custom);
      setLoadingIssueId(null);

      // Now generate with the loaded settings
      setGenerating(true);
      setGeneratingStep('Fetching content…');
      setTimeout(() => setGeneratingStep('Summarising with AI…'), 1500);
      setTimeout(() => setGeneratingStep('Building email…'), 4000);
      const newPreview = await api.post<DigestPreview>('/admin/digest-preview', {
        days: issue.days_covered,
        custom_content: custom,
      });
      setPreviewWithSubject(newPreview);
      showMsg('success', 'Regenerated digest with same settings');
    } catch (err: any) {
      showMsg('error', err.message);
      setLoadingIssueId(null);
    } finally {
      setGenerating(false);
      setGeneratingStep('');
    }
  };

  const handleSaveDraft = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await api.post('/admin/save-digest', {
        subject: editedSubject || preview.subject,
        html_content: preview.html_content,
        plain_text: preview.plain_text,
        summary: preview.summary,
        days_covered: digestDays,
        custom_content: customContent,
        issue_number: preview.issue_number,
        title: preview.title,
      });
      showMsg('success', `Issue #${preview.issue_number} saved to previous issues`);
      await loadDigestIssues();
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSaving(false);
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
        <html><head><title>${editedSubject || preview.subject}</title>
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
        body: JSON.stringify({ subject: editedSubject || preview.subject, html_content: preview.html_content, plain_text: preview.plain_text }),
      });
      if (!res.ok) throw new Error('Failed to generate .eml');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (editedSubject || preview.subject).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_').slice(0, 60) + '.eml';
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
          subject: editedSubject || preview.subject,
          html_content: preview.html_content,
          plain_text: preview.plain_text,
          summary: preview.summary,
          days_covered: digestDays,
          custom_content: customContent,
          issue_number: preview.issue_number,
          title: preview.title,
        },
      );
      showMsg('success', result.message);
      if (result.success) {
        setRecipientEmails('');
        setPreview(null);
        setEditedSubject('');
        setCustomContent('');
        await loadDigestIssues();
      }
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSending(false);
    }
  };

  const loadDigestIssues = async () => {
    setLoadingIssues(true);
    try {
      const issues = await api.get<DigestIssue[]>('/admin/digest-issues');
      setDigestIssues(issues);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoadingIssues(false);
    }
  };

  const handleDeleteIssue = async (issueId: number) => {
    if (!confirm('Are you sure you want to delete this digest issue?')) return;

    try {
      await api.delete(`/admin/digest-issues/${issueId}`);
      showMsg('success', 'Digest issue deleted');
      await loadDigestIssues();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  // Load issues on component mount
  React.useEffect(() => {
    loadDigestIssues();
  }, []);

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
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-sm rounded-lg transition-colors border border-primary/20 disabled:opacity-60"
                >
                  <span
                    className={`material-symbols-outlined text-sm ${generating ? 'animate-spin' : ''}`}
                    style={generating ? { animationDuration: '1s' } : {}}
                  >
                    {generating ? 'autorenew' : 'refresh'}
                  </span>
                  {generating ? (generatingStep || 'Generating…') : 'Generate Digest'}
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

            {/* Digest Issues */}
            <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6">
              <h3 className="text-sm font-bold mb-4">Previous Issues</h3>
              {loadingIssues ? (
                <p className="text-xs text-slate-400">Loading...</p>
              ) : digestIssues.length === 0 ? (
                <p className="text-xs text-slate-400">No previous issues</p>
              ) : (
                <div className="space-y-3">
                  {digestIssues.map((issue) => (
                    <div key={issue.id} className="bg-slate-900/50 rounded-lg p-3 border border-white/5">
                      <div className="flex items-start justify-between mb-1 gap-1">
                        <span className="text-xs font-bold text-white leading-snug">{issue.title}</span>
                        {issue.sent_at && (
                          <span className="shrink-0 text-xs text-green-400 font-medium">Sent</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {issue.recipient_count} recipients · {issue.days_covered}d · {new Date(issue.created_at).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          onClick={() => handleLoadIssue(issue.id)}
                          disabled={loadingIssueId === issue.id}
                          className="flex items-center gap-1 px-2 py-1 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors border border-white/10 disabled:opacity-50"
                          title="Load this issue into preview"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>
                            {loadingIssueId === issue.id ? 'hourglass_empty' : 'upload'}
                          </span>
                          Load
                        </button>
                        <button
                          onClick={() => handleRegenerateIssue(issue)}
                          disabled={generating || loadingIssueId !== null}
                          className="flex items-center gap-1 px-2 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-xs rounded transition-colors border border-primary/20 disabled:opacity-50"
                          title="Regenerate with the same settings"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>refresh</span>
                          Regen
                        </button>
                        <button
                          onClick={() => handleDeleteIssue(issue.id)}
                          className="ml-auto flex items-center gap-1 px-2 py-1 text-red-400 hover:text-red-300 text-xs rounded transition-colors"
                          title="Delete this issue"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                      <input
                        type="text"
                        value={editedSubject}
                        onChange={(e) => setEditedSubject(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm font-semibold focus:border-primary outline-none"
                      />
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
                        {sending ? 'Sending…' : 'Send Digest'}
                      </button>
                      <button
                        onClick={handleSaveDraft}
                        disabled={saving}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-bold text-sm rounded-lg transition-colors border border-blue-500/20 disabled:opacity-50"
                        title="Save without sending"
                      >
                        <span className="material-symbols-outlined text-sm">save</span>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setPreview(null);
                          setEditedSubject('');
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
                <p className="text-slate-400">Generate a digest preview to get started, or load a previous issue</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
