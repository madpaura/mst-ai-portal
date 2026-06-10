import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api, toApiError } from '../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  category: string;
  author_name: string | null;
  is_published: boolean;
  published_at: string | null;
  pdf_url: string | null;
  pdf_filename: string | null;
  created_at: string;
  updated_at: string;
}

interface InlineUpload {
  url: string;
  filename: string;
  mime_type: string;
  file_size: number;
}

const DEFAULT_CATEGORIES = ['General', 'Tutorial', 'Announcement', 'Deep Dive', 'Best Practices'];

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const ArticleEditor: React.FC = () => {
  const { articleId } = useParams<{ articleId?: string }>();
  const navigate = useNavigate();
  const isEdit = !!articleId;

  const [form, setForm] = useState({
    title: '', summary: '', content: '', category: 'General',
    pdf_url: '', pdf_filename: '',
  });
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [beautifying, setBeautifying] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [dragOver, setDragOver] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const turndown = useMemo(() => {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    });
    td.use(gfm);
    return td;
  }, []);

  useEffect(() => {
    if (!articleId) return;
    api.get<Article>(`/articles/my/${articleId}`)
      .then((a) => {
        setForm({
          title: a.title,
          summary: a.summary || '',
          content: a.content,
          category: a.category,
          pdf_url: a.pdf_url || '',
          pdf_filename: a.pdf_filename || '',
        });
      })
      .catch(() => navigate('/articles'))
      .finally(() => setLoading(false));
  }, [articleId, navigate]);

  const isPdfMode = !!form.pdf_url;

  // ── Markdown insertion helpers ─────────────────────────────

  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    setForm((f) => {
      const pos = ta && document.activeElement === ta ? ta.selectionStart : f.content.length;
      const before = f.content.slice(0, pos);
      const after = f.content.slice(ta && document.activeElement === ta ? ta.selectionEnd : pos);
      const needsNewline = before.length > 0 && !before.endsWith('\n') && text.startsWith('!');
      const next = before + (needsNewline ? '\n' : '') + text + after;
      requestAnimationFrame(() => {
        if (ta) {
          const cursor = (before + (needsNewline ? '\n' : '') + text).length;
          ta.selectionStart = ta.selectionEnd = cursor;
        }
      });
      return { ...f, content: next };
    });
  };

  const uploadInline = (file: File) => api.upload<InlineUpload>('/articles/uploads', file);

  const uploadAndInsertImage = async (file: File) => {
    const label = file.name || 'image';
    const token = `![Uploading ${label}…]()`;
    insertAtCursor(`${token}\n`);
    try {
      const res = await uploadInline(file);
      setForm((f) => ({ ...f, content: f.content.replace(token, `![${res.filename}](${res.url})`) }));
    } catch (err: unknown) {
      setForm((f) => ({ ...f, content: f.content.replace(`${token}\n`, '').replace(token, '') }));
      alert(err instanceof Error ? toApiError(err) : 'Image upload failed');
    }
  };

  // Convert pasted HTML to markdown; embedded data-URI images are uploaded
  // and replaced with portal URLs so the markdown stays lightweight.
  const htmlToMarkdown = async (html: string): Promise<string> => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imgs = Array.from(doc.querySelectorAll('img'));
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('data:image/')) {
        try {
          const blob = await (await fetch(src)).blob();
          const ext = MIME_TO_EXT[blob.type] || 'png';
          const file = new File([blob], `pasted-image.${ext}`, { type: blob.type });
          const res = await uploadInline(file);
          img.setAttribute('src', res.url);
        } catch {
          img.remove(); // unsupported/oversized embedded image — drop it
        }
      } else if (src.startsWith('file:') || src.startsWith('blob:')) {
        img.remove(); // local references are unreachable from the portal
      }
    }
    return turndown.turndown(doc.body.innerHTML).trim();
  };

  // ── Paste / drop handlers ──────────────────────────────────

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    const imageFiles = Array.from(cd.files).filter((f) => f.type.startsWith('image/'));
    const html = cd.getData('text/html');

    // Screenshot / copied image (no meaningful HTML alongside it)
    if (imageFiles.length > 0 && !html.trim()) {
      e.preventDefault();
      for (const f of imageFiles) await uploadAndInsertImage(f);
      return;
    }

    if (html.trim()) {
      e.preventDefault();
      try {
        const md = await htmlToMarkdown(html);
        insertAtCursor(md || cd.getData('text/plain'));
      } catch {
        insertAtCursor(cd.getData('text/plain'));
      }
    }
    // Plain text → default browser paste
  };

  const handlePdfDrop = async (file: File) => {
    setUploadingPdf(true);
    try {
      const res = await uploadInline(file);
      setForm((f) => ({ ...f, pdf_url: res.url, pdf_filename: res.filename }));
    } catch (err: unknown) {
      alert(err instanceof Error ? toApiError(err) : 'PDF upload failed');
    }
    setUploadingPdf(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const pdf = files.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdf) {
      await handlePdfDrop(pdf);
      return;
    }
    for (const f of files.filter((f) => f.type.startsWith('image/'))) {
      await uploadAndInsertImage(f);
    }
  };

  // ── Save / beautify ────────────────────────────────────────

  const handleSave = async () => {
    if (!form.title.trim()) {
      alert('Title is required');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put<Article>(`/articles/my/${articleId}`, form);
      } else {
        const article = await api.post<Article>('/articles', form);
        navigate(`/articles/${article.slug}`);
        return;
      }
      navigate('/articles');
    } catch (err: unknown) {
      alert(err instanceof Error ? toApiError(err) : 'Save failed');
    }
    setSaving(false);
  };

  const handleBeautify = async () => {
    if (!form.content.trim()) return;
    if (!confirm('This will rewrite your content using AI. Continue?')) return;
    setBeautifying(true);
    try {
      const res = await api.post<{ content: string }>('/articles/beautify', {
        content: form.content,
      });
      setForm((f) => ({ ...f, content: res.content }));
    } catch (err: unknown) {
      alert(err instanceof Error ? toApiError(err) : 'Beautify failed — is the LLM service running?');
    }
    setBeautifying(false);
  };

  if (loading) {
    return (
      <div className="bg-background-light dark:bg-background-dark min-h-screen font-sans flex items-center justify-center">
        <span className="material-symbols-outlined text-4xl text-slate-500 animate-spin">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="bg-background-light dark:bg-background-dark text-text-strong min-h-screen font-sans">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        <div className="max-w-4xl mx-auto px-6 pt-12 pb-24">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
              {isEdit ? 'Edit Article' : 'Write Article'}
            </h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/articles')}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-sm">publish</span>
                {saving ? 'Saving...' : isEdit ? 'Update' : 'Publish'}
              </button>
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-4 mb-6">
            <input
              type="text"
              placeholder="Article title..."
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-lg font-bold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary transition-colors"
            />
            <div className="flex gap-3">
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-primary transition-colors"
              >
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Brief summary (optional)..."
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>

          {/* Editor toolbar */}
          {!isPdfMode && (
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setShowPreview(false)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  !showPreview
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Write
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  showPreview
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Preview
              </button>
              <div className="flex-1" />
              <button
                onClick={handleBeautify}
                disabled={beautifying || !form.content.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-40 text-purple-500 dark:text-purple-400 text-sm font-medium rounded-lg transition-colors border border-purple-500/20"
              >
                <span className="material-symbols-outlined text-sm">{beautifying ? 'progress_activity' : 'auto_fix_high'}</span>
                {beautifying ? 'Beautifying...' : 'Beautify with AI'}
              </button>
            </div>
          )}

          {/* Content */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`bg-white dark:bg-slate-900 border rounded-xl overflow-hidden min-h-[500px] transition-colors ${
              dragOver
                ? 'border-primary border-dashed border-2 bg-primary/5'
                : 'border-slate-200 dark:border-white/10'
            }`}
          >
            {uploadingPdf ? (
              <div className="flex flex-col items-center justify-center min-h-[500px] gap-3">
                <span className="material-symbols-outlined text-4xl text-primary animate-spin">progress_activity</span>
                <p className="text-sm text-slate-500">Uploading PDF...</p>
              </div>
            ) : isPdfMode ? (
              <div className="flex flex-col min-h-[500px]">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                  <span className="material-symbols-outlined text-red-500">picture_as_pdf</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {form.pdf_filename || 'document.pdf'}
                    </p>
                    <p className="text-xs text-slate-500">
                      This article will display the PDF instead of markdown content.
                    </p>
                  </div>
                  <button
                    onClick={() => setForm((f) => ({ ...f, pdf_url: '', pdf_filename: '' }))}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-red-500/20"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                    Remove PDF
                  </button>
                </div>
                <iframe
                  src={`${API_BASE}${form.pdf_url}`}
                  title={form.pdf_filename || 'PDF preview'}
                  className="flex-1 w-full min-h-[600px] bg-white"
                />
              </div>
            ) : showPreview ? (
              <div className="p-6 howto-markdown text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight, rehypeRaw]}
                >
                  {form.content || '*Start writing to see a preview...*'}
                </ReactMarkdown>
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                onPaste={handlePaste}
                placeholder="Write your article in Markdown... Paste rich text (it converts to Markdown automatically), paste or drop images, or drop a PDF to display the PDF itself."
                className="w-full min-h-[500px] bg-transparent border-none resize-none text-slate-900 dark:text-white placeholder-slate-400 focus:ring-0 text-sm font-mono p-6 outline-none leading-relaxed"
              />
            )}
          </div>

          {!isPdfMode && (
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">info</span>
              Paste rich text from Word, web pages or emails — it is converted to Markdown.
              Paste or drag &amp; drop images to embed them. Drop a PDF to publish it as the article body.
            </p>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};
