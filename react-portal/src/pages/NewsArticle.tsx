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

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  source: string;
  source_url: string | null;
  badge: string | null;
  published_at: string;
}

const SOURCE_STYLES: Record<string, string> = {
  release: 'bg-green-500/10 text-green-500 border-green-500/20',
  rss: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  llm: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  manual: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

export const NewsArticle: React.FC = () => {
  const { newsId } = useParams<{ newsId: string }>();
  usePageView(`/news/${newsId}`);
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!newsId) return;
    api.get<NewsItem>(`/api/solutions/news/${newsId}`)
      .then((data) => {
        setItem(data);
        // Track news article view for analytics
        api.post('/analytics/event', {
          event_type: 'news_view',
          section: 'news',
          entity_id: newsId,
          entity_name: data.title,
        }).catch(() => {});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [newsId]);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen font-sans">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        <div className="max-w-4xl mx-auto px-6 pt-12 pb-24">
          {/* Back link */}
          <Link
            to="/news"
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-primary transition-colors mb-10"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to Articles
          </Link>

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <span className="material-symbols-outlined text-4xl text-slate-500 animate-spin">progress_activity</span>
            </div>
          ) : error || !item ? (
            <div className="text-center py-32">
              <span className="material-symbols-outlined text-5xl text-slate-600 mb-4 block">error</span>
              <p className="text-slate-500 text-lg">News article not found.</p>
            </div>
          ) : (
            <article>
              {/* Meta */}
              <div className="flex items-center gap-3 mb-6">
                <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full border capitalize ${SOURCE_STYLES[item.source] || SOURCE_STYLES.manual}`}>
                  {item.badge || item.source}
                </span>
                <span className="text-sm text-slate-400">
                  {formatDate(item.published_at)}
                </span>
              </div>

              {/* Title */}
              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white leading-tight mb-6">
                {item.title}
              </h1>

              {/* Summary */}
              <p className="text-xl text-slate-500 dark:text-slate-400 leading-relaxed mb-10 border-b border-slate-200 dark:border-white/10 pb-10">
                {item.summary}
              </p>

              {/* Content */}
              {item.content ? (
                <div className="howto-markdown text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight, rehypeRaw]}
                  >
                    {item.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-slate-500 italic">No detailed content available for this article.</p>
              )}

              {/* Source link */}
              {item.source_url && (
                <div className="mt-10 pt-6 border-t border-slate-200 dark:border-white/10">
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-primary hover:text-blue-400 text-sm font-medium transition-colors"
                  >
                    View original source
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                  </a>
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
