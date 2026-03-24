import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';
import { usePageView } from '../hooks/usePageView';

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

const CATEGORY_COLOR: Record<string, string> = {
  release: 'text-green-600 dark:text-green-400',
  rss: 'text-amber-600 dark:text-amber-400',
  llm: 'text-purple-600 dark:text-purple-400',
  manual: 'text-slate-500 dark:text-slate-400',
};

const INITIAL_LIST_COUNT = 10;

export const News: React.FC = () => {
  usePageView('/news');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.get<NewsItem[]>('/api/solutions/news')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const featured = items[0] || null;
  const sidebarItems = items.slice(1, 5);
  const listItems = items.slice(1);

  const filteredList = useMemo(() => {
    if (!search.trim()) return listItems;
    const q = search.toLowerCase();
    return listItems.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.summary.toLowerCase().includes(q) ||
        (it.badge || it.source).toLowerCase().includes(q)
    );
  }, [listItems, search]);

  const visibleList = showAll ? filteredList : filteredList.slice(0, INITIAL_LIST_COUNT);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const openArticle = (id: string) => {
    window.open(`/news/${id}`, '_blank');
  };

  const categoryLabel = (item: NewsItem) => item.badge || item.source;

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        {/* ── Hero: Newsroom title ─────────────────────── */}
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-10">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-slate-900 dark:text-white">
            Newsroom
          </h1>
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
            {/* ── Featured + Sidebar ───────────────────── */}
            <section className="max-w-6xl mx-auto px-6 pb-16">
              <div className="flex flex-col lg:flex-row gap-10 border-t border-slate-200 dark:border-white/10 pt-10">
                {/* Featured article — left side */}
                {featured && (
                  <div
                    className="flex-1 min-w-0 cursor-pointer group"
                    onClick={() => openArticle(featured.id)}
                  >
                    {/* Globe hero image */}
                    <img
                      src="/image.png"
                      alt="Global AI reach"
                      className="w-full aspect-[4/3] object-cover rounded-xl border border-slate-200 dark:border-white/5 mb-6"
                    />
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white leading-tight group-hover:text-primary transition-colors mb-3">
                      {featured.title}
                    </h2>
                    <div className="flex items-baseline gap-6 text-sm">
                      <span className="text-slate-400 whitespace-nowrap">
                        {formatDate(featured.published_at)}
                      </span>
                      <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                        {featured.summary}
                      </p>
                    </div>
                  </div>
                )}

                {/* Sidebar news cards — right side */}
                {sidebarItems.length > 0 && (
                  <div className="w-full lg:w-[380px] shrink-0 flex flex-col divide-y divide-slate-200 dark:divide-white/10">
                    {sidebarItems.map((item) => (
                      <article
                        key={item.id}
                        className="py-5 first:pt-0 cursor-pointer group"
                        onClick={() => openArticle(item.id)}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`text-xs font-bold capitalize ${CATEGORY_COLOR[item.source] || CATEGORY_COLOR.manual}`}>
                            {categoryLabel(item)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {formatDate(item.published_at)}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors leading-snug mb-1.5">
                          {item.title}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-3">
                          {item.summary}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ── Divider ──────────────────────────────── */}
            <div className="max-w-6xl mx-auto px-6">
              <hr className="border-slate-200 dark:border-white/10" />
            </div>

            {/* ── News table list ──────────────────────── */}
            <section className="max-w-6xl mx-auto px-6 pt-12 pb-24">
              {/* Header row: title + search */}
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">
                  News
                </h2>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                  <input
                    type="text"
                    placeholder="Search"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setShowAll(true); }}
                    className="pl-10 pr-4 py-2 w-56 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {/* Column headers */}
              <div className="hidden sm:grid grid-cols-[140px_160px_1fr] gap-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider pb-3 border-b border-slate-200 dark:border-white/10">
                <span>Date</span>
                <span>Category</span>
                <span>Title</span>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-200 dark:divide-white/10">
                {visibleList.map((item) => (
                  <article
                    key={item.id}
                    className="grid grid-cols-1 sm:grid-cols-[140px_160px_1fr] gap-1 sm:gap-4 py-4 cursor-pointer group"
                    onClick={() => openArticle(item.id)}
                  >
                    <span className="text-sm text-slate-400 whitespace-nowrap">
                      {formatDate(item.published_at)}
                    </span>
                    <span className={`text-sm font-semibold capitalize ${CATEGORY_COLOR[item.source] || CATEGORY_COLOR.manual}`}>
                      {categoryLabel(item)}
                    </span>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors leading-snug">
                      {item.title}
                    </span>
                  </article>
                ))}
              </div>

              {/* Empty search */}
              {filteredList.length === 0 && search.trim() && (
                <p className="text-center text-slate-500 py-8 text-sm">No results for &ldquo;{search}&rdquo;</p>
              )}

              {/* See more button */}
              {!showAll && filteredList.length > INITIAL_LIST_COUNT && (
                <button
                  onClick={() => setShowAll(true)}
                  className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-primary hover:text-primary transition-colors"
                >
                  See more
                  <span className="material-symbols-outlined text-sm">expand_more</span>
                </button>
              )}
            </section>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
};
