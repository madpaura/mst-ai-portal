import React, { useState, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../api/client';

interface Announcement {
  id: string;
  title: string;
  content: string | null;
  badge: string | null;
  is_active: boolean;
  created_at: string;
}

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

const SAVED_EMAILS_KEY = 'mst_digest_saved_emails';

function loadSavedEmails(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_EMAILS_KEY) || '[]');
  } catch {
    return [];
  }
}

function persistSavedEmails(emails: string[]) {
  localStorage.setItem(SAVED_EMAILS_KEY, JSON.stringify([...new Set(emails)]));
}

export const AdminDigest: React.FC = () => {
  const [digestDays, setDigestDays] = useState(7);
  const [customContent, setCustomContent] = useState('');
  const [skipAnnouncements, setSkipAnnouncements] = useState(false);
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [editedSubject, setEditedSubject] = useState('');
  const [recipientEmails, setRecipientEmails] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingStep, setGeneratingStep] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingProgress, setSendingProgress] = useState('');
  const [loadingIssueId, setLoadingIssueId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [digestIssues, setDigestIssues] = useState<DigestIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);

  // Announcements
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnn, setLoadingAnn] = useState(false);
  const [showAnnForm, setShowAnnForm] = useState(false);
  const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);
  const [annForm, setAnnForm] = useState({ title: '', content: '', badge: '', is_active: true });
  const [savingAnn, setSavingAnn] = useState(false);

  // Saved emails
  const [savedEmails, setSavedEmails] = useState<string[]>(loadSavedEmails);
  const [showSavedEmails, setShowSavedEmails] = useState(false);

  // Batch send
  const [batchSize, setBatchSize] = useState(50);

  const csvInputRef = useRef<HTMLInputElement>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const setPreviewWithSubject = (data: DigestPreview) => {
    setPreview(data);
    setEditedSubject(data.subject);
  };

  // ── Saved email helpers ──────────────────────────────
  const addEmailsToSaved = (emails: string[]) => {
    const updated = [...new Set([...savedEmails, ...emails.filter(e => e.includes('@'))])];
    setSavedEmails(updated);
    persistSavedEmails(updated);
  };

  const removeSavedEmail = (email: string) => {
    const updated = savedEmails.filter(e => e !== email);
    setSavedEmails(updated);
    persistSavedEmails(updated);
  };

  const toggleSavedEmail = (email: string) => {
    const current = recipientEmails.split('\n').map(e => e.trim()).filter(Boolean);
    if (current.includes(email)) {
      setRecipientEmails(current.filter(e => e !== email).join('\n'));
    } else {
      setRecipientEmails([...current, email].join('\n'));
    }
  };

  const handleLoadCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      // Extract anything that looks like an email from the CSV
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const found = Array.from(new Set(text.match(emailRegex) || []));
      if (found.length === 0) {
        showMsg('error', 'No valid email addresses found in the CSV');
        return;
      }
      const current = recipientEmails.split('\n').map(e => e.trim()).filter(Boolean);
      const merged = [...new Set([...current, ...found])];
      setRecipientEmails(merged.join('\n'));
      addEmailsToSaved(found);
      showMsg('success', `Loaded ${found.length} email(s) from CSV`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Announcement handlers ──────────────────────────────
  const fetchAnnouncements = useCallback(async () => {
    setLoadingAnn(true);
    try {
      const data = await api.get<Announcement[]>('/admin/announcements');
      setAnnouncements(data);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoadingAnn(false);
    }
  }, []);

  const openCreateAnn = () => {
    setEditingAnn(null);
    setAnnForm({ title: '', content: '', badge: '', is_active: true });
    setShowAnnForm(true);
  };

  const openEditAnn = (ann: Announcement) => {
    setEditingAnn(ann);
    setAnnForm({ title: ann.title, content: ann.content || '', badge: ann.badge || '', is_active: ann.is_active });
    setShowAnnForm(true);
  };

  const handleSaveAnn = async () => {
    if (!annForm.title.trim()) { showMsg('error', 'Title is required'); return; }
    setSavingAnn(true);
    try {
      if (editingAnn) {
        await api.put(`/admin/announcements/${editingAnn.id}`, annForm);
        showMsg('success', 'Announcement updated');
      } else {
        await api.post('/admin/announcements', annForm);
        showMsg('success', 'Announcement created');
      }
      setShowAnnForm(false);
      await fetchAnnouncements();
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSavingAnn(false);
    }
  };

  const handleToggleAnn = async (ann: Announcement) => {
    try {
      await api.put(`/admin/announcements/${ann.id}`, { ...ann, is_active: !ann.is_active });
      setAnnouncements(prev => prev.map(a => a.id === ann.id ? { ...a, is_active: !a.is_active } : a));
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDeleteAnn = async (ann: Announcement) => {
    if (!confirm(`Delete announcement "${ann.title}"?`)) return;
    try {
      await api.delete(`/admin/announcements/${ann.id}`);
      showMsg('success', 'Announcement deleted');
      setAnnouncements(prev => prev.filter(a => a.id !== ann.id));
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  // ── Handlers ─────────────────────────────────────────
  const handleGeneratePreview = async () => {
    setGenerating(true);
    setGeneratingStep('Fetching content…');
    try {
      setTimeout(() => setGeneratingStep('Summarising with AI…'), 1500);
      setTimeout(() => setGeneratingStep('Building email…'), 4000);
      const data = await api.post<DigestPreview>('/admin/digest-preview', {
        days: digestDays,
        custom_content: customContent,
        skip_announcements: skipAnnouncements,
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
    setLoadingIssueId(issue.id);
    try {
      const data = await api.get<{ custom_content: string }>(`/admin/digest-issues/${issue.id}`);
      const custom = data.custom_content || '';
      setCustomContent(custom);
      setLoadingIssueId(null);

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
      showMsg('success', `Issue #${preview.issue_number} saved`);
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
    if (win) { win.document.write(DOMPurify.sanitize(preview.html_content)); win.document.close(); }
  };

  const handleDownloadPdf = () => {
    if (!preview) return;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<html><head><title>${editedSubject || preview.subject}</title><style>@media print{body{margin:0}}</style></head><body onload="setTimeout(()=>{window.print();},500)">${DOMPurify.sanitize(preview.html_content)}</body></html>`);
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
      showMsg('success', 'Downloaded .eml — open with Outlook, Thunderbird, or drag into Gmail');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleSendDigest = async () => {
    if (!preview) return;

    const emails = recipientEmails
      .split('\n')
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes('@'));

    if (emails.length === 0) {
      showMsg('error', 'Please enter at least one valid email address');
      return;
    }

    setSending(true);

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < emails.length; i += batchSize) {
      batches.push(emails.slice(i, i + batchSize));
    }

    let totalSent = 0;
    let lastIssueNumber = preview.issue_number;

    try {
      for (let b = 0; b < batches.length; b++) {
        setSendingProgress(`Sending batch ${b + 1}/${batches.length} (${batches[b].length} recipients)…`);
        const result = await api.post<{ success: boolean; message: string; sent_count: number }>(
          '/admin/send-digest',
          {
            recipient_emails: batches[b],
            subject: editedSubject || preview.subject,
            html_content: preview.html_content,
            plain_text: preview.plain_text,
            summary: preview.summary,
            days_covered: digestDays,
            custom_content: customContent,
            issue_number: lastIssueNumber,
            title: preview.title,
          },
        );
        totalSent += result.sent_count;
        // Save sent emails to quick-access
        addEmailsToSaved(batches[b]);
        // Small pause between batches to avoid rate limits
        if (b < batches.length - 1) {
          await new Promise(r => setTimeout(r, 800));
        }
      }

      showMsg('success', `Sent to ${totalSent}/${emails.length} recipients across ${batches.length} batch(es)`);
      setRecipientEmails('');
      setPreview(null);
      setEditedSubject('');
      setCustomContent('');
      await loadDigestIssues();
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setSending(false);
      setSendingProgress('');
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

  React.useEffect(() => {
    loadDigestIssues();
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const recipientList = recipientEmails.split('\n').map(e => e.trim()).filter(Boolean);
  const batchCount = batchSize > 0 ? Math.ceil(recipientList.length / batchSize) : 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Learning Digest</h1>
          <p className="text-slate-400">Create and send curated learning newsletters covering videos, articles, and platform updates</p>
        </div>

        {/* Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg border ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/20 text-green-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* Left Panel */}
          <div className="col-span-1 space-y-6">
            {/* Digest Settings */}
            <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6">
              <h2 className="text-lg font-bold mb-4">Digest Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Time Period (days)</label>
                  <input
                    type="number" min="1" max="30" value={digestDays}
                    onChange={(e) => setDigestDays(parseInt(e.target.value) || 7)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none"
                  />
                  <p className="text-xs text-slate-500 mt-1">Look back this many days for content</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Custom Message</label>
                  <textarea
                    value={customContent}
                    onChange={(e) => setCustomContent(e.target.value)}
                    placeholder="Add a personal message to include in the digest..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none"
                    rows={4}
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipAnnouncements}
                    onChange={(e) => setSkipAnnouncements(e.target.checked)}
                    className="w-4 h-4 accent-primary rounded"
                  />
                  <span className="text-xs text-slate-300">Skip announcements in digest</span>
                </label>
                <button
                  onClick={handleGeneratePreview}
                  disabled={generating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-sm rounded-lg transition-colors border border-primary/20 disabled:opacity-60"
                >
                  <span className={`material-symbols-outlined text-sm ${generating ? 'animate-spin' : ''}`} style={generating ? { animationDuration: '1s' } : {}}>
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
                  {[['Videos', preview.summary.videos_count], ['Articles', preview.summary.articles_count],
                    ['Components', preview.summary.components_count], ['Solutions', preview.summary.solutions_count]].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between">
                      <span className="text-slate-400">{k}:</span>
                      <span className="font-bold">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Previous Issues */}
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
                        {issue.sent_at && <span className="shrink-0 text-xs text-green-400 font-medium">Sent</span>}
                      </div>
                      <div className="text-xs text-slate-400">
                        {issue.recipient_count} recipients · {issue.days_covered}d · {new Date(issue.created_at).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          onClick={() => handleLoadIssue(issue.id)}
                          disabled={loadingIssueId === issue.id}
                          className="flex items-center gap-1 px-2 py-1 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors border border-white/10 disabled:opacity-50"
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
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>refresh</span>
                          Regen
                        </button>
                        <button
                          onClick={() => handleDeleteIssue(issue.id)}
                          className="ml-auto flex items-center gap-1 px-2 py-1 text-red-400 hover:text-red-300 text-xs rounded transition-colors"
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

          {/* Right Panel */}
          <div className="col-span-2 space-y-6">
            {preview ? (
              <>
                {/* Preview */}
                <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold">Preview</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={handleViewInNewTab} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10">
                        <span className="material-symbols-outlined text-sm">open_in_new</span>View
                      </button>
                      <button onClick={handleDownloadPdf} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10">
                        <span className="material-symbols-outlined text-sm">picture_as_pdf</span>PDF
                      </button>
                      <button onClick={handleOpenInEmailClient} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium rounded-lg transition-colors border border-blue-500/20">
                        <span className="material-symbols-outlined text-sm">forward_to_inbox</span>Email Client
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Subject</label>
                      <input
                        type="text" value={editedSubject}
                        onChange={(e) => setEditedSubject(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm font-semibold focus:border-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email Preview</label>
                      <div
                        className="bg-white rounded-lg p-4 text-slate-900 text-sm max-h-96 overflow-y-auto border border-white/10"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.html_content) }}
                      />
                    </div>
                  </div>
                </div>

                {/* Send Recipients */}
                <div className="bg-slate-800/50 rounded-xl border border-white/10 p-6 space-y-4">
                  <h2 className="text-lg font-bold">Send To Recipients</h2>

                  {/* Toolbar: CSV load + batch size */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => csvInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-white/10"
                      title="Load email addresses from a CSV file"
                    >
                      <span className="material-symbols-outlined text-sm">upload_file</span>
                      Load CSV
                    </button>
                    <input ref={csvInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleLoadCsv} />

                    {savedEmails.length > 0 && (
                      <button
                        onClick={() => setShowSavedEmails(v => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium rounded-lg transition-colors border border-primary/20"
                      >
                        <span className="material-symbols-outlined text-sm">bookmarks</span>
                        Saved ({savedEmails.length})
                      </button>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                      <label className="text-xs text-slate-400 whitespace-nowrap">Batch size:</label>
                      <input
                        type="number" min="1" max="500" value={batchSize}
                        onChange={(e) => setBatchSize(Math.max(1, parseInt(e.target.value) || 50))}
                        className="w-20 px-2 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-xs focus:border-primary outline-none"
                        title="Number of recipients per batch"
                      />
                    </div>
                  </div>

                  {/* Saved emails quick-select */}
                  {showSavedEmails && savedEmails.length > 0 && (
                    <div className="p-3 bg-slate-900/60 rounded-lg border border-white/5 space-y-1.5 max-h-48 overflow-y-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Saved Addresses</span>
                        <button
                          onClick={() => {
                            const current = recipientEmails.split('\n').map(e => e.trim()).filter(Boolean);
                            const merged = [...new Set([...current, ...savedEmails])];
                            setRecipientEmails(merged.join('\n'));
                          }}
                          className="text-xs text-primary hover:text-white transition-colors"
                        >
                          Add all
                        </button>
                      </div>
                      {savedEmails.map(email => {
                        const active = recipientList.includes(email);
                        return (
                          <div key={email} className="flex items-center gap-2">
                            <button
                              onClick={() => toggleSavedEmail(email)}
                              className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition-colors font-mono truncate ${
                                active ? 'bg-primary/15 text-primary border border-primary/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                              }`}
                            >
                              {active && <span className="mr-1">✓</span>}{email}
                            </button>
                            <button onClick={() => removeSavedEmail(email)} className="text-red-400/50 hover:text-red-400 transition-colors">
                              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>close</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Recipient textarea */}
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Recipient Emails (one per line)
                    </label>
                    <textarea
                      value={recipientEmails}
                      onChange={(e) => setRecipientEmails(e.target.value)}
                      placeholder={"user1@example.com\nuser2@example.com\nteam@example.com"}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none font-mono"
                      rows={5}
                    />
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-slate-500">
                        {recipientList.length} recipient{recipientList.length !== 1 ? 's' : ''}
                        {recipientList.length > 0 && batchCount > 1 && ` · ${batchCount} batches of ${batchSize}`}
                      </p>
                      {recipientList.length > 0 && (
                        <button
                          onClick={() => addEmailsToSaved(recipientList)}
                          className="text-xs text-slate-500 hover:text-primary transition-colors"
                        >
                          Save to quick-access
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={handleSendDigest}
                      disabled={sending || recipientList.length === 0}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 font-bold text-sm rounded-lg transition-colors border border-green-500/20 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">{sending ? 'hourglass_empty' : 'send'}</span>
                      {sending ? (sendingProgress || 'Sending…') : `Send${batchCount > 1 ? ` (${batchCount} batches)` : ''}`}
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
                      onClick={() => { setPreview(null); setEditedSubject(''); setRecipientEmails(''); }}
                      className="px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-bold text-sm rounded-lg transition-colors border border-white/10"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-slate-800/50 rounded-xl border border-white/10 p-12 text-center">
                <span className="material-symbols-outlined text-6xl mb-4 opacity-20 block">mail</span>
                <p className="text-slate-400">Generate a digest preview to get started, or load a previous issue</p>
              </div>
            )}
          </div>
        </div>

        {/* Announcements Management */}
        <div className="mt-6 bg-slate-800/50 rounded-xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">Announcements</h2>
              <p className="text-xs text-slate-400 mt-0.5">Active announcements are included in digest emails unless skipped above</p>
            </div>
            <button
              onClick={openCreateAnn}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-lg transition-colors border border-primary/20"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              New Announcement
            </button>
          </div>

          {/* Create / Edit form */}
          {showAnnForm && (
            <div className="mb-4 p-4 bg-slate-900/60 rounded-xl border border-white/10 space-y-3">
              <h3 className="text-sm font-bold text-slate-200">{editingAnn ? 'Edit Announcement' : 'New Announcement'}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Title *</label>
                  <input
                    type="text"
                    value={annForm.title}
                    onChange={(e) => setAnnForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Announcement title"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Badge (optional)</label>
                  <input
                    type="text"
                    value={annForm.badge}
                    onChange={(e) => setAnnForm(f => ({ ...f, badge: e.target.value }))}
                    placeholder="e.g. New, Update"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-primary outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Content</label>
                <textarea
                  value={annForm.content}
                  onChange={(e) => setAnnForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Announcement body text..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-primary outline-none resize-none"
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={annForm.is_active}
                    onChange={(e) => setAnnForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-xs text-slate-300">Active (included in digest)</span>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAnnForm(false)}
                    className="px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAnn}
                    disabled={savingAnn}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-lg border border-primary/20 transition-colors disabled:opacity-50"
                  >
                    {savingAnn ? 'Saving…' : (editingAnn ? 'Update' : 'Create')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Announcements list */}
          {loadingAnn ? (
            <p className="text-xs text-slate-400">Loading announcements…</p>
          ) : announcements.length === 0 ? (
            <p className="text-xs text-slate-400">No announcements yet. Create one to include in digest emails.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {announcements.map((ann) => (
                <div key={ann.id} className={`rounded-lg border p-4 transition-colors ${ann.is_active ? 'bg-slate-900/50 border-white/10' : 'bg-slate-900/20 border-white/5 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold text-white leading-snug">{ann.title}</span>
                    {ann.badge && (
                      <span className="shrink-0 text-xs px-1.5 py-0.5 bg-primary/20 text-primary rounded font-medium">{ann.badge}</span>
                    )}
                  </div>
                  {ann.content && (
                    <p className="text-xs text-slate-400 mb-3 line-clamp-2">{ann.content}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleAnn(ann)}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors border ${ann.is_active ? 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20' : 'bg-slate-700/40 border-white/10 text-slate-400 hover:bg-slate-700'}`}
                      title={ann.is_active ? 'Deactivate' : 'Activate'}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>{ann.is_active ? 'visibility' : 'visibility_off'}</span>
                      {ann.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => openEditAnn(ann)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-700/40 hover:bg-slate-700 text-slate-300 border border-white/10 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>edit</span>
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteAnn(ann)}
                      className="ml-auto text-red-400/50 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
