import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { api } from '../api/client';

interface Attachment {
  id: string;
  article_id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  url: string;
  created_at: string;
}

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  content?: string;
  category: string;
  author_name: string | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at?: string;
  attachments?: Attachment[];
}

const DEFAULT_CATEGORIES = ['General', 'Tutorial', 'Announcement', 'Deep Dive', 'Best Practices'];
const ALLOWED_TYPES = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx';
const MAX_SIZE_MB = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'picture_as_pdf';
  if (ext === 'doc' || ext === 'docx') return 'description';
  if (ext === 'ppt' || ext === 'pptx') return 'slideshow';
  if (ext === 'xls' || ext === 'xlsx') return 'table_chart';
  return 'attach_file';
}

export const AdminArticles: React.FC = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', category: 'General' });

  // Edit form
  const [editForm, setEditForm] = useState({
    title: '', slug: '', summary: '', content: '', category: '',
  });
  const [saving, setSaving] = useState(false);
  const [beautifying, setBeautifying] = useState(false);

  // Attachments
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchArticles = useCallback(async () => {
    try {
      const data = await api.get<Article[]>('/admin/articles');
      setArticles(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const selectArticle = async (article: Article) => {
    try {
      const full = await api.get<Article>(`/admin/articles/${article.id}`);
      setSelected(full);
      setEditForm({
        title: full.title,
        slug: full.slug,
        summary: full.summary || '',
        content: full.content || '',
        category: full.category,
      });
      setShowPreview(false);
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!createForm.title.trim()) return;
    try {
      const article = await api.post<Article>('/admin/articles', {
        title: createForm.title,
        category: createForm.category,
        content: '',
      });
      setArticles((prev) => [article, ...prev]);
      setShowCreate(false);
      setCreateForm({ title: '', category: 'General' });
      selectArticle(article);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await api.put<Article>(`/admin/articles/${selected.id}`, editForm);
      setSelected((prev) => prev ? { ...prev, ...updated } : updated);
      setArticles((prev) => prev.map((a) => a.id === updated.id ? { ...a, ...updated } : a));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected || !confirm('Delete this article?')) return;
    try {
      await api.delete(`/admin/articles/${selected.id}`);
      setArticles((prev) => prev.filter((a) => a.id !== selected.id));
      setSelected(null);
    } catch { /* ignore */ }
  };

  const handlePublish = async () => {
    if (!selected) return;
    try {
      if (selected.is_published) {
        await api.post(`/admin/articles/${selected.id}/unpublish`);
      } else {
        await api.post(`/admin/articles/${selected.id}/publish`);
      }
      await fetchArticles();
      const updated = await api.get<Article>(`/admin/articles/${selected.id}`);
      setSelected(updated);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Publish failed');
    }
  };

  const handleBeautify = async () => {
    if (!editForm.content.trim()) return;
    if (!confirm('This will rewrite your content using AI. Continue?')) return;
    setBeautifying(true);
    try {
      const res = await api.post<{ content: string }>('/articles/beautify', {
        content: editForm.content,
      });
      setEditForm((f) => ({ ...f, content: res.content }));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Beautify failed — is the LLM service running?');
    }
    setBeautifying(false);
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selected || !e.target.files?.length) return;
    const file = e.target.files[0];

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`File exceeds ${MAX_SIZE_MB} MB limit`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const attachment = await api.post<Attachment>(
        `/admin/articles/${selected.id}/attachments`,
        formData,
      );
      setSelected((prev) =>
        prev ? { ...prev, attachments: [...(prev.attachments || []), attachment] } : prev
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    }
    setUploading(false);
    e.target.value = '';
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!selected || !confirm('Delete this attachment?')) return;
    try {
      await api.delete(`/admin/articles/${selected.id}/attachments/${attachmentId}`);
      setSelected((prev) =>
        prev ? { ...prev, attachments: (prev.attachments || []).filter((a) => a.id !== attachmentId) } : prev
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const filteredArticles = articles.filter((a) =>
    a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="material-symbols-outlined text-4xl text-slate-500 animate-spin">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left Panel — Article List */}
      <div className="w-[340px] shrink-0 border-r border-white/10 flex flex-col bg-sidebar-dark">
        <div className="p-4 border-b border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Articles</h2>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-1 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-lg transition-colors border border-primary/20"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              New
            </button>
          </div>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">search</span>
            <input
              type="text"
              placeholder="Search articles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:border-primary outline-none"
            />
          </div>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="p-4 border-b border-white/10 space-y-2 bg-slate-800/50">
            <input
              type="text"
              placeholder="Article title"
              value={createForm.title}
              onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:border-primary outline-none"
              autoFocus
            />
            <select
              value={createForm.category}
              onChange={(e) => setCreateForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white focus:border-primary outline-none"
            >
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={handleCreate}
              className="w-full py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
            >
              Create Article
            </button>
          </div>
        )}

        {/* Article List */}
        <div className="flex-1 overflow-y-auto">
          {filteredArticles.map((article) => (
            <button
              key={article.id}
              onClick={() => selectArticle(article)}
              className={`w-full text-left p-4 border-b border-white/5 transition-colors ${
                selected?.id === article.id
                  ? 'bg-primary/10 border-l-2 border-l-primary'
                  : 'hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${article.is_published ? 'bg-green-400' : 'bg-amber-400'}`} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {article.category}
                </span>
              </div>
              <p className="text-sm text-white font-medium truncate">{article.title}</p>
              <p className="text-xs text-slate-500 mt-1">{formatDate(article.created_at)}</p>
            </button>
          ))}
          {filteredArticles.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">No articles found</p>
          )}
        </div>
      </div>

      {/* Right Panel — Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Toolbar */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  selected.is_published ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}>
                  {selected.is_published ? 'Published' : 'Draft'}
                </span>
                <h2 className="text-lg font-bold text-white truncate">{selected.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePublish}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-colors border ${
                    selected.is_published
                      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20'
                      : 'bg-green-500/10 hover:bg-green-500/20 text-green-400 border-green-500/20'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">
                    {selected.is_published ? 'unpublished' : 'publish'}
                  </span>
                  {selected.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">save</span>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg transition-colors border border-red-500/20"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
            </div>

            {/* Metadata row */}
            <div className="px-4 py-3 border-b border-white/10 shrink-0">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Title</label>
                  <input
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white focus:border-primary outline-none"
                  />
                </div>
                <div className="w-40">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Category</label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white focus:border-primary outline-none"
                  >
                    {DEFAULT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    {!DEFAULT_CATEGORIES.includes(editForm.category) && editForm.category && (
                      <option value={editForm.category}>{editForm.category}</option>
                    )}
                  </select>
                </div>
                <div className="w-48">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Slug</label>
                  <input
                    value={editForm.slug}
                    onChange={(e) => setEditForm((f) => ({ ...f, slug: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white focus:border-primary outline-none font-mono"
                  />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Summary</label>
                <input
                  value={editForm.summary}
                  onChange={(e) => setEditForm((f) => ({ ...f, summary: e.target.value }))}
                  placeholder="Brief summary for article cards..."
                  className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white placeholder-slate-600 focus:border-primary outline-none"
                />
              </div>
            </div>

            {/* Editor / Preview toggle */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 shrink-0">
              <button
                onClick={() => setShowPreview(false)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  !showPreview ? 'bg-primary/10 text-primary border border-primary/20' : 'text-slate-400 hover:text-white'
                }`}
              >
                Edit
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  showPreview ? 'bg-primary/10 text-primary border border-primary/20' : 'text-slate-400 hover:text-white'
                }`}
              >
                Preview
              </button>
              <div className="flex-1" />
              <button
                onClick={handleBeautify}
                disabled={beautifying || !editForm.content.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-40 text-purple-400 text-xs font-bold rounded-lg transition-colors border border-purple-500/20"
              >
                <span className="material-symbols-outlined text-sm">{beautifying ? 'progress_activity' : 'auto_fix_high'}</span>
                {beautifying ? 'Beautifying...' : 'Beautify with AI'}
              </button>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto">
              {showPreview ? (
                <div className="p-6 howto-markdown text-sm text-slate-300 leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight, rehypeRaw]}
                  >
                    {editForm.content || '*No content yet*'}
                  </ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={editForm.content}
                  onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                  placeholder="Write your article in Markdown..."
                  className="w-full h-full bg-transparent border-none resize-none text-white placeholder-slate-600 focus:ring-0 text-sm font-mono p-6 outline-none leading-relaxed"
                />
              )}
            </div>

            {/* Attachments section */}
            <div className="border-t border-white/10 px-4 py-3 shrink-0 bg-slate-900/40">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Attachments
                  <span className="ml-1.5 text-slate-600">
                    (PDF, Word, PPT, Excel — max {MAX_SIZE_MB} MB)
                  </span>
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-xs font-bold rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">
                    {uploading ? 'progress_activity' : 'upload_file'}
                  </span>
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_TYPES}
                  className="hidden"
                  onChange={handleUploadAttachment}
                />
              </div>

              {(selected.attachments || []).length === 0 ? (
                <p className="text-xs text-slate-600 italic">No attachments yet</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {(selected.attachments || []).map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-800/60 group"
                    >
                      <span className="material-symbols-outlined text-base text-slate-400">{fileIcon(att.filename)}</span>
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-xs text-slate-300 hover:text-primary truncate transition-colors"
                      >
                        {att.filename}
                      </a>
                      <span className="text-[10px] text-slate-600">{formatBytes(att.file_size)}</span>
                      <button
                        onClick={() => handleDeleteAttachment(att.id)}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <span className="material-symbols-outlined text-6xl mb-4 opacity-20">article</span>
            <p className="text-sm">Select an article or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
};
