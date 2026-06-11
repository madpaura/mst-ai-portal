import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { ArticleCardSkeleton } from '../components/Skeletons';
import { Pager } from '../components/Pager';
import { usePagedList } from '../hooks/usePagedList';
import { api } from '../api/client';
import { isLoggedIn } from '../api/client';
import { usePageView } from '../hooks/usePageView';

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  category: string;
  author_name: string | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  General: 'text-blue-600 dark:text-blue-400',
  Tutorial: 'text-green-600 dark:text-green-400',
  Announcement: 'text-amber-600 dark:text-amber-400',
  'Deep Dive': 'text-purple-600 dark:text-purple-400',
  'Best Practices': 'text-cyan-600 dark:text-cyan-400',
};

// First-paint batch size and grid page size (3-column grid → 4 clean rows).
const PAGE_SIZE = 12;

export const Articles: React.FC = () => {
  usePageView('/articles');
  const navigate = useNavigate();
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [fullLoaded, setFullLoaded] = useState(false);
  const fullLoadedRef = useRef(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    api.get<string[]>('/articles/categories').then(setCategories).catch(() => {});
    // Two-phase load: paint the first batch immediately, then swap in the
    // full list once the background request lands.
    api.get<Article[]>(`/articles?limit=${PAGE_SIZE}`)
      .then((batch) => {
        if (!fullLoadedRef.current) setArticles(batch);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    api.get<Article[]>('/articles')
      .then((all) => {
        fullLoadedRef.current = true;
        setArticles(all);
        setFullLoaded(true);
      })
      .catch(() => setFullLoaded(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = articles;
    if (activeCategory) {
      result = result.filter((a) => a.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.summary || '').toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q)
      );
    }
    return result;
  }, [articles, activeCategory, search]);

  // Paginate the grid; reset to page 1 when the filter or search changes.
  const paged = usePagedList(filtered, PAGE_SIZE, `${activeCategory ?? ''}|${search}`);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="bg-background-light dark:bg-background-dark text-text-strong min-h-screen font-sans">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-slate-900 dark:text-white">
                Articles
              </h1>
              <p className="mt-3 text-lg text-text-muted max-w-2xl">
                Insights, tutorials, and best practices from the team.
              </p>
            </div>
            {isLoggedIn() && (
              <button
                onClick={() => navigate('/articles/new')}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-all shadow-[0_0_15px_rgba(37,140,244,0.3)] shrink-0"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                Write Article
              </button>
            )}
          </div>
        </section>

        {/* Filters */}
        <section className="max-w-6xl mx-auto px-6 pb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-slate-200 dark:border-white/10 pt-6">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveCategory(null)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  !activeCategory
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-primary/10 hover:text-primary'
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    activeCategory === cat
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-primary/10 hover:text-primary'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
              <input
                type="text"
                placeholder="Search articles..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 pr-4 py-2 w-64 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
        </section>

        {loading ? (
          <section className="max-w-6xl mx-auto px-6 pb-24">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }, (_, i) => <ArticleCardSkeleton key={i} />)}
            </div>
          </section>
        ) : fullLoaded && filtered.length === 0 ? (
          <div className="text-center py-32">
            <span className="material-symbols-outlined text-5xl text-slate-600 mb-4 block">article</span>
            <p className="text-slate-500 text-lg">
              {search.trim() || activeCategory ? 'No articles match your filter.' : 'No articles published yet.'}
            </p>
          </div>
        ) : (
          <section className="max-w-6xl mx-auto px-6 pb-24">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {paged.visible.map((article) => (
                <article
                  key={article.id}
                  onClick={() => navigate(`/articles/${article.slug}`)}
                  className="group cursor-pointer bg-white dark:bg-card-dark border border-slate-200 dark:border-white/5 rounded-xl p-6 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-xs font-bold ${CATEGORY_COLORS[article.category] || 'text-slate-500'}`}>
                      {article.category}
                    </span>
                    <span className="text-xs text-slate-400">
                      {article.published_at ? formatDate(article.published_at) : formatDate(article.created_at)}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors leading-snug mb-2">
                    {article.title}
                  </h3>
                  {article.summary && (
                    <p className="text-sm text-text-muted leading-relaxed line-clamp-3">
                      {article.summary}
                    </p>
                  )}
                  {article.author_name && (
                    <p className="text-xs text-slate-400 mt-3">By {article.author_name}</p>
                  )}
                </article>
              ))}
              {!fullLoaded && Array.from({ length: 3 }, (_, i) => <ArticleCardSkeleton key={`sk-${i}`} />)}
            </div>
            {fullLoaded && paged.hasPager && (
              <Pager
                page={paged.page}
                pageCount={paged.pageCount}
                total={paged.total}
                showAll={paged.showAll}
                onPage={(p) => {
                  paged.setPage(p);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onToggleShowAll={() => paged.setShowAll(!paged.showAll)}
              />
            )}
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
};
