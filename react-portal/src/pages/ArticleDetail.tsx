import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api, isLoggedIn } from '../api/client';
import { usePageView } from '../hooks/usePageView';
import { useParams, Link, useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Attachment {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  url: string;
}

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
  attachments: Attachment[];
}

const CATEGORY_STYLES: Record<string, string> = {
  General: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  Tutorial: 'bg-green-500/10 text-green-500 border-green-500/20',
  Announcement: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  'Deep Dive': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  'Best Practices': 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
};

export const ArticleDetail: React.FC = () => {
  const { articleSlug } = useParams<{ articleSlug: string }>();
  usePageView(`/articles/${articleSlug}`);
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [userLiked, setUserLiked] = useState(false);

  useEffect(() => {
    if (!articleSlug) return;
    api.get<{ like_count: number; user_liked: boolean }>(`/articles/${articleSlug}/likes`)
      .then((d) => { setLikeCount(d.like_count); setUserLiked(d.user_liked); })
      .catch(() => {});
    api.get<Article>(`/articles/${articleSlug}`)
      .then((data) => {
        setArticle(data);
        api.post('/analytics/event', {
          event_type: 'article_view',
          section: 'articles',
          entity_id: data.id,
          entity_name: data.title,
        }).catch(() => {});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [articleSlug]);

  const toggleLike = async () => {
    if (!isLoggedIn()) { navigate('/login'); return; }
    if (!articleSlug) return;
    const wasLiked = userLiked;
    // Optimistic flip; revert on failure.
    setUserLiked(!wasLiked);
    setLikeCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    try {
      const d = wasLiked
        ? await api.delete<{ like_count: number; user_liked: boolean }>(`/articles/${articleSlug}/likes`)
        : await api.post<{ like_count: number; user_liked: boolean }>(`/articles/${articleSlug}/likes`);
      setLikeCount(d.like_count);
      setUserLiked(d.user_liked);
    } catch {
      setUserLiked(wasLiked);
      setLikeCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="bg-background-light dark:bg-background-dark text-text-strong min-h-screen font-sans">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        <div className="max-w-4xl mx-auto px-6 pt-12 pb-24">
          <Link
            to="/articles"
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-primary transition-colors mb-10"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to Articles
          </Link>

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <span className="material-symbols-outlined text-4xl text-slate-500 animate-spin">progress_activity</span>
            </div>
          ) : error || !article ? (
            <div className="text-center py-32">
              <span className="material-symbols-outlined text-5xl text-slate-600 mb-4 block">error</span>
              <p className="text-slate-500 text-lg">Article not found.</p>
            </div>
          ) : (
            <article>
              <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full border ${CATEGORY_STYLES[article.category] || 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                    {article.category}
                  </span>
                  <span className="text-sm text-slate-400">
                    {article.published_at ? formatDate(article.published_at) : formatDate(article.created_at)}
                  </span>
                  {article.author_name && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600">|</span>
                      <span className="text-sm text-slate-400">By {article.author_name}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={toggleLike}
                    title={!isLoggedIn() ? 'Sign in to like' : userLiked ? 'Unlike' : 'Like this article'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-colors ${
                      userLiked
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-slate-200 dark:border-white/10 text-slate-400 hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    <span
                      className="material-symbols-outlined text-[18px]"
                      style={{ fontVariationSettings: userLiked ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      thumb_up
                    </span>
                    {likeCount}
                  </button>
                  {article.attachments?.length > 0 && (
                    article.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:border-primary/40 hover:bg-primary/5 transition-colors group"
                        title={att.filename}
                      >
                        <span className="material-symbols-outlined text-sm text-slate-400 group-hover:text-primary transition-colors">attach_file</span>
                        <span className="text-xs text-text-muted group-hover:text-primary transition-colors max-w-[140px] truncate">
                          {att.filename}
                        </span>
                        <span className="material-symbols-outlined text-sm text-slate-400 group-hover:text-primary transition-colors">download</span>
                      </a>
                    ))
                  )}
                </div>
              </div>

              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white leading-tight mb-6">
                {article.title}
              </h1>

              {article.summary && (
                <p className="text-xl text-text-muted leading-relaxed mb-10 border-b border-slate-200 dark:border-white/10 pb-10">
                  {article.summary}
                </p>
              )}

              {article.pdf_url ? (
                <div>
                  <object
                    data={`${API_BASE}${article.pdf_url}`}
                    type="application/pdf"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white"
                    style={{ height: '80vh' }}
                  >
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                      <span className="material-symbols-outlined text-5xl text-slate-400">picture_as_pdf</span>
                      <p className="text-slate-500">Your browser cannot display PDFs inline.</p>
                    </div>
                  </object>
                  <a
                    href={`${API_BASE}${article.pdf_url}`}
                    download={article.pdf_filename || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-sm font-medium text-primary border border-primary/20 rounded-lg hover:bg-primary/5 transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">download</span>
                    Download {article.pdf_filename || 'PDF'}
                  </a>
                </div>
              ) : (
                <div className="howto-markdown text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight, rehypeRaw]}
                  >
                    {article.content}
                  </ReactMarkdown>
                </div>
              )}

            </article>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};
