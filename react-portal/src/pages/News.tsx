import React, { useState, useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

export const News: React.FC = () => {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api.get<NewsItem[]>('/api/solutions/news')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const featured = items[0] || null;
  const rest = items.slice(1);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        {/* Hero Header */}
        <section className="max-w-7xl mx-auto px-6 pt-20 pb-12">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">
            Newsroom
          </h1>
          <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl">
            The latest updates, releases, and announcements from the MST AI team.
          </p>
          <div className="h-1 w-20 bg-primary rounded-full mt-6" />
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <span className="material-symbols-outlined text-4xl text-slate-500 animate-spin">progress_activity</span>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-32">
            <span className="material-symbols-outlined text-5xl text-slate-600 mb-4 block">newspaper</span>
            <p className="text-slate-500 text-lg">No news articles yet.</p>
          </div>
        ) : (
          <>
            {/* Featured Article */}
            {featured && (
              <section className="max-w-7xl mx-auto px-6 pb-16">
                <div
                  className="relative group rounded-2xl overflow-hidden border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/50 cursor-pointer hover:border-primary/30 transition-all"
                  onClick={() => setExpandedId(expandedId === featured.id ? null : featured.id)}
                >
                  <div className="p-10 md:p-14">
                    <div className="flex items-center gap-3 mb-6">
                      <span className="text-sm text-slate-400 font-medium">
                        {formatDate(featured.published_at)}
                      </span>
                      <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full border capitalize ${SOURCE_STYLES[featured.source] || SOURCE_STYLES.manual}`}>
                        {featured.source}
                      </span>
                      {featured.badge && (
                        <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                          {featured.badge}
                        </span>
                      )}
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4 group-hover:text-primary transition-colors leading-tight">
                      {featured.title}
                    </h2>
                    <p className="text-lg text-slate-500 dark:text-slate-400 leading-relaxed max-w-3xl">
                      {featured.summary}
                    </p>
                    <div className="mt-6 flex items-center gap-2 text-primary font-medium text-sm">
                      {expandedId === featured.id ? 'Collapse' : 'Read more'}
                      <span className="material-symbols-outlined text-sm">
                        {expandedId === featured.id ? 'expand_less' : 'arrow_forward'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {expandedId === featured.id && featured.content && (
                    <div className="border-t border-slate-200 dark:border-white/5 px-10 md:px-14 py-10">
                      <div className="prose prose-slate dark:prose-invert max-w-3xl prose-headings:font-bold prose-p:text-slate-500 dark:prose-p:text-slate-400 prose-a:text-primary">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {featured.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Article Grid */}
            {rest.length > 0 && (
              <section className="max-w-7xl mx-auto px-6 pb-24">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {rest.map((item) => (
                    <article
                      key={item.id}
                      className="group rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/50 overflow-hidden cursor-pointer hover:border-primary/30 transition-all flex flex-col"
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    >
                      <div className="p-6 flex flex-col flex-1">
                        <div className="flex items-center gap-2 mb-4">
                          <span className="text-xs text-slate-400 font-medium">
                            {formatDate(item.published_at)}
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border capitalize ${SOURCE_STYLES[item.source] || SOURCE_STYLES.manual}`}>
                            {item.source}
                          </span>
                          {item.badge && (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3 group-hover:text-primary transition-colors leading-snug">
                          {item.title}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed flex-1">
                          {item.summary}
                        </p>
                        <div className="mt-4 flex items-center gap-1 text-primary text-sm font-medium">
                          {expandedId === item.id ? 'Collapse' : 'Read more'}
                          <span className="material-symbols-outlined text-sm">
                            {expandedId === item.id ? 'expand_less' : 'arrow_forward'}
                          </span>
                        </div>
                      </div>

                      {/* Expanded content */}
                      {expandedId === item.id && item.content && (
                        <div className="border-t border-slate-200 dark:border-white/5 px-6 py-6">
                          <div className="prose prose-sm prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-p:text-slate-500 dark:prose-p:text-slate-400 prose-a:text-primary">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {item.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
};
