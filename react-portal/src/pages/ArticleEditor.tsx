import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';

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
  created_at: string;
  updated_at: string;
}

const DEFAULT_CATEGORIES = ['General', 'Tutorial', 'Announcement', 'Deep Dive', 'Best Practices'];

export const ArticleEditor: React.FC = () => {
  const { articleId } = useParams<{ articleId?: string }>();
  const navigate = useNavigate();
  const isEdit = !!articleId;

  const [form, setForm] = useState({
    title: '', summary: '', content: '', category: 'General',
  });
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [beautifying, setBeautifying] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!articleId) return;
    api.get<Article>(`/articles/my/${articleId}`)
      .then((a) => {
        setForm({
          title: a.title,
          summary: a.summary || '',
          content: a.content,
          category: a.category,
        });
      })
      .catch(() => navigate('/articles'))
      .finally(() => setLoading(false));
  }, [articleId, navigate]);

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
      alert(err instanceof Error ? err.message : 'Save failed');
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
      alert(err instanceof Error ? err.message : 'Beautify failed — is the LLM service running?');
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
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen font-sans">
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

          {/* Content */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden min-h-[500px]">
            {showPreview ? (
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
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Write your article in Markdown..."
                className="w-full min-h-[500px] bg-transparent border-none resize-none text-slate-900 dark:text-white placeholder-slate-400 focus:ring-0 text-sm font-mono p-6 outline-none leading-relaxed"
              />
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
