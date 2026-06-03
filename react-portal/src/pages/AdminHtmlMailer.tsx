import React, { useState, useRef, useMemo } from 'react';
import { api, toApiError } from '../api/client';

const SAVED_MAILER_EMAILS_KEY = 'mst_mailer_saved_emails';

function loadSavedEmails(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_MAILER_EMAILS_KEY) || '[]');
  } catch {
    return [];
  }
}

function persistSavedEmails(emails: string[]) {
  localStorage.setItem(SAVED_MAILER_EMAILS_KEY, JSON.stringify([...new Set(emails)]));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function inlineGoogleFonts(
  html: string,
  onProgress: (msg: string) => void,
): Promise<string> {
  const linkPattern = /<link[^>]*href=["']([^"']*fonts\.googleapis\.com[^"']*)["'][^>]*>/gi;
  const matches: Array<{ tag: string; url: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(html)) !== null) {
    matches.push({ tag: m[0], url: m[1] });
  }
  if (!matches.length) return html;

  let processed = html;
  for (let i = 0; i < matches.length; i++) {
    const { tag, url } = matches[i];
    onProgress(`Fetching font CSS ${i + 1}/${matches.length}…`);
    try {
      const cssResp = await fetch(url);
      if (!cssResp.ok) continue;
      let css = await cssResp.text();

      // Collect unique gstatic font URLs
      const fontPattern = /url\(['"]?(https:\/\/fonts\.gstatic\.com[^'")\s]+)['"]?\)/g;
      const fontUrls: string[] = [];
      let fm: RegExpExecArray | null;
      while ((fm = fontPattern.exec(css)) !== null) {
        if (!fontUrls.includes(fm[1])) fontUrls.push(fm[1]);
      }

      for (let j = 0; j < fontUrls.length; j++) {
        const fontUrl = fontUrls[j];
        onProgress(`Downloading font file ${j + 1}/${fontUrls.length}…`);
        try {
          const fontResp = await fetch(fontUrl);
          if (!fontResp.ok) continue;
          const buffer = await fontResp.arrayBuffer();
          const b64 = arrayBufferToBase64(buffer);
          const fmt = fontUrl.includes('.woff2') ? 'font/woff2' : 'font/woff';
          css = css.replaceAll(fontUrl, `data:${fmt};base64,${b64}`);
        } catch { /* skip individual font */ }
      }

      processed = processed.replace(tag, `<style>\n${css}\n</style>`);
    } catch { /* skip this link tag */ }
  }
  return processed;
}

export const AdminHtmlMailer: React.FC = () => {
  const [htmlContent, setHtmlContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [subject, setSubject] = useState('');
  const [toEmails, setToEmails] = useState('');
  const [bccEmails, setBccEmails] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [inlining, setInlining] = useState(false);
  const [inlineProgress, setInlineProgress] = useState('');
  const [fontsInlined, setFontsInlined] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savedEmails, setSavedEmails] = useState<string[]>(loadSavedEmails);
  const [showSaved, setShowSaved] = useState(false);
  const [activeEmailField, setActiveEmailField] = useState<'to' | 'bcc'>('bcc');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const hasExternalFonts = useMemo(
    () => htmlContent.includes('fonts.googleapis.com'),
    [htmlContent],
  );

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const parseEmails = (raw: string) =>
    raw.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes('@'));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFontsInlined(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setHtmlContent(text);
      if (!subject) {
        const match = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match) setSubject(match[1].trim());
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleInlineFonts = async () => {
    setInlining(true);
    setInlineProgress('Starting…');
    try {
      const processed = await inlineGoogleFonts(htmlContent, setInlineProgress);
      setHtmlContent(processed);
      setFontsInlined(true);
      const kb = (new Blob([processed]).size / 1024).toFixed(1);
      showMsg('success', `Fonts inlined — HTML is now ${kb} KB (self-contained)`);
    } catch (err: unknown) {
      showMsg('error', `Font inlining failed: ${toApiError(err)}`);
    } finally {
      setInlining(false);
      setInlineProgress('');
    }
  };

  const handleCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const found = Array.from(new Set(text.match(emailRegex) || []));
      if (!found.length) {
        showMsg('error', 'No valid email addresses found in the CSV');
        return;
      }
      const setter = activeEmailField === 'to' ? setToEmails : setBccEmails;
      const current = activeEmailField === 'to' ? toEmails : bccEmails;
      const existing = current.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
      setter([...new Set([...existing, ...found])].join('\n'));
      addEmailsToSaved(found);
      showMsg('success', `Loaded ${found.length} email(s) from CSV`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

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

  const toggleSavedEmailInField = (email: string, field: 'to' | 'bcc') => {
    const setter = field === 'to' ? setToEmails : setBccEmails;
    const current = field === 'to' ? toEmails : bccEmails;
    const existing = current.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
    if (existing.includes(email)) {
      setter(existing.filter(e => e !== email).join('\n'));
    } else {
      setter([...existing, email].join('\n'));
    }
  };

  const handleSend = async () => {
    if (!htmlContent) { showMsg('error', 'Please load an HTML file first'); return; }
    if (!subject.trim()) { showMsg('error', 'Subject is required'); return; }
    const to = parseEmails(toEmails);
    const bcc = parseEmails(bccEmails);
    if (!to.length && !bcc.length) { showMsg('error', 'Add at least one recipient (To or BCC)'); return; }

    setSending(true);
    try {
      const result = await api.post<{ success: boolean; message: string; sent_count: number }>(
        '/admin/send-html-email',
        { subject, html_content: htmlContent, to_emails: to, bcc_emails: bcc },
      );
      if (result.success) {
        showMsg('success', result.message);
        addEmailsToSaved([...to, ...bcc]);
      } else {
        showMsg('error', result.message);
      }
    } catch (err: unknown) {
      showMsg('error', toApiError(err) || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleDownloadEml = async () => {
    if (!htmlContent) { showMsg('error', 'Please load an HTML file first'); return; }
    if (!subject.trim()) { showMsg('error', 'Subject is required'); return; }
    setDownloading(true);
    try {
      const resp = await fetch('/admin/generate-eml', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, html_content: htmlContent, plain_text: '' }),
      });
      if (!resp.ok) throw new Error('Failed to generate EML');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = subject.replace(/[^a-z0-9]/gi, '_').slice(0, 60) + '.eml';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      showMsg('error', toApiError(err) || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const previewUrl = useMemo(
    () => htmlContent ? URL.createObjectURL(new Blob([htmlContent], { type: 'text/html' })) : null,
    [htmlContent],
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">HTML Mailer</h1>
        <p className="text-text-muted text-sm mt-1">
          Upload any HTML file and send it as a formatted email
        </p>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
          message.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          <span className="material-symbols-outlined text-base">
            {message.type === 'success' ? 'check_circle' : 'error'}
          </span>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: config */}
        <div className="space-y-4">
          {/* File upload */}
          <div className="glass-card p-4 rounded-xl border border-slate-200 dark:border-white/10">
            <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-base text-primary">upload_file</span>
              HTML File
            </h2>
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-border-strong hover:border-primary text-slate-600 dark:text-slate-400 hover:text-primary transition-colors text-sm"
            >
              <span className="material-symbols-outlined text-lg">html</span>
              {fileName ? fileName : 'Click to choose an HTML file'}
            </button>
            {htmlContent && (
              <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                {(new Blob([htmlContent]).size / 1024).toFixed(1)} KB loaded
                {fontsInlined && <span className="ml-1 text-emerald-500 font-medium">· fonts inlined</span>}
              </p>
            )}

            {/* Google Fonts warning + inline button */}
            {htmlContent && hasExternalFonts && !fontsInlined && (
              <div className="mt-3 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-400 text-base mt-0.5 shrink-0">warning</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-400">Google Fonts detected</p>
                  <p className="text-xs text-amber-300/70 mt-0.5">
                    Icons and custom fonts from fonts.googleapis.com won't render in email clients.
                    Inline them now to embed fonts directly in the HTML.
                  </p>
                  <button
                    onClick={handleInlineFonts}
                    disabled={inlining}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {inlining ? (
                      <>
                        <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {inlineProgress || 'Inlining…'}
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">download_for_offline</span>
                        Inline fonts for email
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Subject */}
          <div className="glass-card p-4 rounded-xl border border-slate-200 dark:border-white/10">
            <label className="text-sm font-semibold text-text mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-base text-primary">subject</span>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Email subject line"
              className="w-full mt-2 px-3 py-2 rounded-lg bg-panel-light dark:bg-input-dark border border-border-base text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Recipients */}
          <div className="glass-card p-4 rounded-xl border border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-primary">group</span>
                Recipients
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSaved(!showSaved)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">bookmarks</span>
                  Saved ({savedEmails.length})
                </button>
                <input ref={csvInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvChange} />
                <button
                  onClick={() => csvInputRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary transition-colors"
                  title={`Import CSV into ${activeEmailField.toUpperCase()} field`}
                >
                  <span className="material-symbols-outlined text-sm">upload</span>
                  CSV → {activeEmailField.toUpperCase()}
                </button>
              </div>
            </div>

            {showSaved && savedEmails.length > 0 && (
              <div className="mb-3 p-3 bg-panel-light dark:bg-panel-dark/50 rounded-lg border border-border-base">
                <p className="text-xs text-slate-500 mb-2">Click to toggle into To or BCC field:</p>
                <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                  {savedEmails.map(email => {
                    const inTo = toEmails.split(/[\n,;]+/).map(e => e.trim()).includes(email);
                    const inBcc = bccEmails.split(/[\n,;]+/).map(e => e.trim()).includes(email);
                    return (
                      <div key={email} className="flex items-center gap-0.5">
                        <button
                          onClick={() => toggleSavedEmailInField(email, 'to')}
                          className={`text-xs px-2 py-0.5 rounded-l border transition-colors ${
                            inTo ? 'bg-blue-500/20 border-blue-400/40 text-blue-300' : 'bg-slate-700/50 border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white'
                          }`}
                          title="Toggle in To"
                        >
                          To
                        </button>
                        <button
                          onClick={() => toggleSavedEmailInField(email, 'bcc')}
                          className={`text-xs px-2 py-0.5 border-y border-r transition-colors ${
                            inBcc ? 'bg-purple-500/20 border-purple-400/40 text-purple-300' : 'bg-slate-700/50 border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-900 dark:hover:text-white'
                          }`}
                          title="Toggle in BCC"
                        >
                          BCC
                        </button>
                        <span className="text-xs px-2 py-0.5 rounded-r border-y border-r border-slate-200 dark:border-slate-600 bg-panel-light dark:bg-panel-dark text-slate-600 dark:text-slate-300 max-w-[160px] truncate">{email}</span>
                        <button
                          onClick={() => removeSavedEmail(email)}
                          className="ml-0.5 text-slate-500 hover:text-red-400 transition-colors"
                          title="Remove from saved"
                        >
                          <span className="material-symbols-outlined text-xs">close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-text-muted mb-1 block">
                  To <span className="text-slate-400">(visible recipients)</span>
                </label>
                <textarea
                  value={toEmails}
                  onChange={e => setToEmails(e.target.value)}
                  onFocus={() => setActiveEmailField('to')}
                  placeholder="one@example.com&#10;two@example.com"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-panel-light dark:bg-input-dark border border-border-base text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted mb-1 block">
                  BCC <span className="text-slate-400">(hidden recipients)</span>
                </label>
                <textarea
                  value={bccEmails}
                  onChange={e => setBccEmails(e.target.value)}
                  onFocus={() => setActiveEmailField('bcc')}
                  placeholder="one@example.com&#10;two@example.com"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-panel-light dark:bg-input-dark border border-border-base text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono"
                />
                <p className="mt-1 text-xs text-text-muted">
                  {parseEmails(bccEmails).length + parseEmails(toEmails).length} total recipient(s)
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleSend}
              disabled={sending || !htmlContent}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {sending ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">send</span>
                  Send Email
                </>
              )}
            </button>
            <button
              onClick={handleDownloadEml}
              disabled={downloading || !htmlContent}
              className="flex items-center gap-2 px-4 py-2.5 border border-border-strong hover:border-primary text-text hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {downloading ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <span className="material-symbols-outlined text-base">download</span>
              )}
              Download .eml
            </button>
          </div>
        </div>

        {/* Right: preview */}
        <div className="glass-card rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden flex flex-col" style={{ minHeight: '600px' }}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold text-text flex items-center gap-2">
              <span className="material-symbols-outlined text-base text-primary">preview</span>
              Preview
            </h2>
            {htmlContent && (
              <span className="text-xs text-text-muted">{fileName}</span>
            )}
          </div>
          {htmlContent && previewUrl ? (
            <iframe
              key={previewUrl}
              src={previewUrl}
              title="Email preview"
              className="flex-1 w-full border-0"
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
              <span className="material-symbols-outlined text-5xl opacity-30">html</span>
              <p className="text-sm">Load an HTML file to preview it here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
