import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';
import { usePageView } from '../hooks/usePageView';
import { useParams, Link } from 'react-router-dom';

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
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!articleSlug) return;
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

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen font-sans">
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
              <div className="flex items-center gap-3 mb-6">
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

              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white leading-tight mb-6">
                {article.title}
              </h1>

              {article.summary && (
                <p className="text-xl text-slate-500 dark:text-slate-400 leading-relaxed mb-10 border-b border-slate-200 dark:border-white/10 pb-10">
                  {article.summary}
                </p>
              )}

              <div className="howto-markdown text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight, rehypeRaw]}
                >
                  {article.content}
                </ReactMarkdown>
              </div>

              {article.attachments?.length > 0 && (
                <div className="mt-10 border-t border-slate-200 dark:border-white/10 pt-8">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Attachments
                  </h3>
                  <div className="flex flex-col gap-2">
                    {article.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 hover:border-primary/40 hover:bg-primary/5 transition-colors group"
                      >
                        <span className="material-symbols-outlined text-xl text-slate-400 group-hover:text-primary transition-colors">
                          attach_file
                        </span>
                        <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 group-hover:text-primary transition-colors truncate">
                          {att.filename}
                        </span>
                        <span className="material-symbols-outlined text-base text-slate-400 group-hover:text-primary transition-colors">
                          download
                        </span>
                      </a>
                    ))}
                  </div>
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
