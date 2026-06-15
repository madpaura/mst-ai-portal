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

// Trending score: a like is a stronger signal than a passing visit.
const trendScore = (likes: number, views: number) => likes * 5 + views;

const fmtCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

type SortMode = 'trending' | 'latest';

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
  const [sortMode, setSortMode] = useState<SortMode>('trending');
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [serverLikes, setServerLikes] = useState<Record<string, number>>({});
  const [views, setViews] = useState<Record<string, number>>({});
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<string[]>('/articles/categories').then(setCategories).catch(() => {});
    // Like + view counts power the thumbs-up badges and the Trending sort.
    // The sort uses the server snapshot only, so liking a card doesn't make
    // the grid reshuffle under the user mid-browse.
    api.get<Record<string, number>>('/articles/like-counts')
      .then((d) => { setLikes(d); setServerLikes(d); })
      .catch(() => {});
    api.get<Record<string, number>>('/articles/view-stats').then(setViews).catch(() => {});
    if (isLoggedIn()) {
      api.get<string[]>('/articles/my-likes')
        .then((slugs) => setMyLikes(new Set(slugs)))
        .catch(() => {});
    }
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

  const toggleLike = async (slug: string) => {
    if (!isLoggedIn()) { navigate('/login'); return; }
    const liked = myLikes.has(slug);
    // Optimistic flip; revert on failure.
    setMyLikes((prev) => {
      const next = new Set(prev);
      if (liked) next.delete(slug); else next.add(slug);
      return next;
    });
    setLikes((prev) => ({ ...prev, [slug]: Math.max(0, (prev[slug] || 0) + (liked ? -1 : 1)) }));
    try {
      if (liked) await api.delete(`/articles/${slug}/likes`);
      else await api.post(`/articles/${slug}/likes`);
    } catch {
      setMyLikes((prev) => {
        const next = new Set(prev);
        if (liked) next.add(slug); else next.delete(slug);
        return next;
      });
      setLikes((prev) => ({ ...prev, [slug]: Math.max(0, (prev[slug] || 0) + (liked ? 1 : -1)) }));
    }
  };

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
    const pubDate = (a: Article) => +new Date(a.published_at || a.created_at);
    result = [...result];
    if (sortMode === 'trending') {
      result.sort((a, b) =>
        trendScore(serverLikes[b.slug] || 0, views[b.slug] || 0) - trendScore(serverLikes[a.slug] || 0, views[a.slug] || 0)
        || pubDate(b) - pubDate(a),
      );
    } else {
      result.sort((a, b) => pubDate(b) - pubDate(a));
    }
    return result;
  }, [articles, activeCategory, search, sortMode, serverLikes, views]);

  // Paginate the grid; reset to page 1 when the filter or search changes.
  const paged = usePagedList(filtered, PAGE_SIZE, `${activeCategory ?? ''}|${search}|${sortMode}`);

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
            <div className="flex items-center gap-3">
              {/* Sort toggle */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                {([['trending', 'trending_up', 'Trending'], ['latest', 'schedule', 'Latest']] as const).map(([mode, icon, label]) => (
                  <button
                    key={mode}
                    onClick={() => setSortMode(mode)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      sortMode === mode
                        ? 'bg-white dark:bg-slate-700 shadow-sm text-primary'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">{icon}</span>
                    {label}
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
                  <div className="flex items-center justify-between mt-3">
                    {article.author_name ? (
                      <p className="text-xs text-slate-400 truncate">By {article.author_name}</p>
                    ) : <span />}
                    <div className="flex items-center gap-3 shrink-0 text-xs text-slate-400">
                      {(views[article.slug] || 0) > 0 && (
                        <span className="flex items-center gap-1" title="Views">
                          <span className="material-symbols-outlined text-[15px]">visibility</span>
                          {fmtCount(views[article.slug])}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleLike(article.slug); }}
                        title={!isLoggedIn() ? 'Sign in to like' : myLikes.has(article.slug) ? 'Unlike' : 'Like'}
                        className={`flex items-center gap-1 transition-colors ${
                          myLikes.has(article.slug) ? 'text-primary' : 'hover:text-primary'
                        }`}
                      >
                        <span
                          className="material-symbols-outlined text-[15px]"
                          style={{ fontVariationSettings: myLikes.has(article.slug) ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          thumb_up
                        </span>
                        {fmtCount(likes[article.slug] || 0)}
                      </button>
                    </div>
                  </div>
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
