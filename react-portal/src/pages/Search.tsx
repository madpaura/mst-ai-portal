import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';

const API_BASE = (import.meta.env.VITE_API_URL as string) || '';

interface SearchResult {
  type: string;
  id: string;
  title: string;
  description: string;
  url: string;
  thumbnail: string | null;
  category: string | null;
  highlight: string;
}

interface SearchResponse {
  total: number;
  page: number;
  per_page: number;
  results: SearchResult[];
}

const TYPE_LABELS: Record<string, string> = {
  all: 'All',
  video: 'Videos',
  article: 'Articles',
  solution: 'Solutions',
  news: 'News',
  marketplace: 'Marketplace',
};

const TYPE_ICONS: Record<string, string> = {
  video: 'play_circle',
  article: 'article',
  solution: 'lightbulb',
  news: 'newspaper',
  marketplace: 'store',
};

const TYPE_COLORS: Record<string, string> = {
  video: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40',
  article: 'text-green-500 bg-green-50 dark:bg-green-950/40',
  solution: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40',
  news: 'text-orange-500 bg-orange-50 dark:bg-orange-950/40',
  marketplace: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40',
};

export const Search: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const type = searchParams.get('type') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState(q);

  const fetchResults = useCallback(async (query: string, t: string, p: number) => {
    if (!query.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, type: t, page: String(p) });
      const res = await fetch(`${API_BASE}/search?${params}`, { credentials: 'include' });
      const data: SearchResponse = await res.json();
      setResults(data);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults(q, type, page);
    setInputValue(q);
  }, [q, type, page, fetchResults]);

  const updateSearch = (updates: { q?: string; type?: string; page?: number }) => {
    const next = new URLSearchParams(searchParams);
    if (updates.q !== undefined) next.set('q', updates.q);
    if (updates.type !== undefined) next.set('type', updates.type);
    if (updates.page !== undefined) next.set('page', String(updates.page));
    if (updates.type && updates.type !== type) next.set('page', '1');
    if (updates.q && updates.q !== q) next.set('page', '1');
    setSearchParams(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) updateSearch({ q: inputValue.trim() });
  };

  const totalPages = results ? Math.ceil(results.total / results.per_page) : 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background-dark flex flex-col">
      <Navbar variant="solutions" />
      <div className="flex-1 pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4">
          {/* Search input */}
          <form onSubmit={handleSubmit} className="mb-8">
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all shadow-sm">
                <span className="material-symbols-outlined text-slate-400">search</span>
                <input
                  type="text"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  placeholder="Search videos, articles, solutions, marketplace..."
                  className="flex-1 bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none"
                  autoFocus
                />
                {inputValue && (
                  <button type="button" onClick={() => setInputValue('')} className="text-slate-400 hover:text-slate-600">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl transition-colors shadow-sm"
              >
                Search
              </button>
            </div>
          </form>

          {q && (
            <>
              {/* Type filter tabs */}
              <div className="flex gap-2 mb-6 flex-wrap">
                {Object.entries(TYPE_LABELS).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => updateSearch({ type: t })}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                      type === t
                        ? 'bg-primary text-white border-primary'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-primary hover:text-primary bg-white dark:bg-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Status line */}
              {!loading && results && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                  {results.total === 0
                    ? `No results for "${q}"`
                    : `${results.total} result${results.total !== 1 ? 's' : ''} for "${q}"`
                  }
                </p>
              )}

              {/* Loading skeleton */}
              {loading && (
                <div className="space-y-4">
                  {[1,2,3].map(n => (
                    <div key={n} className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-100 dark:border-slate-700 animate-pulse flex gap-4">
                      <div className="w-24 h-16 bg-slate-200 dark:bg-slate-700 rounded-lg flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full" />
                        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Results */}
              {!loading && results && results.results.length > 0 && (
                <div className="space-y-3">
                  {results.results.map((item) => (
                    <ResultCard key={`${item.type}-${item.id}`} item={item} />
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!loading && results && results.results.length === 0 && (
                <div className="text-center py-16">
                  <span className="material-symbols-outlined text-[56px] text-slate-300 dark:text-slate-600">search_off</span>
                  <p className="text-slate-500 dark:text-slate-400 mt-4 text-lg">No results found</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">Try different keywords or a different filter</p>
                </div>
              )}

              {/* Pagination */}
              {!loading && totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-10">
                  <button
                    disabled={page <= 1}
                    onClick={() => updateSearch({ page: page - 1 })}
                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400 px-2">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => updateSearch({ page: page + 1 })}
                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}

          {/* Empty state when no query */}
          {!q && (
            <div className="text-center py-20">
              <span className="material-symbols-outlined text-[64px] text-slate-300 dark:text-slate-600">search</span>
              <p className="text-slate-400 dark:text-slate-500 mt-4">Enter a search term above</p>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

const ResultCard: React.FC<{ item: SearchResult }> = ({ item }) => {
  const colorClass = TYPE_COLORS[item.type] || 'text-slate-500 bg-slate-50';
  const icon = TYPE_ICONS[item.type] || 'search';
  const API_BASE = (import.meta.env.VITE_API_URL as string) || '';

  return (
    <Link
      to={item.url}
      className="flex gap-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition-all group"
    >
      {/* Thumbnail */}
      {item.thumbnail ? (
        <img
          src={item.thumbnail.startsWith('http') ? item.thumbnail : `${API_BASE}${item.thumbnail}`}
          alt=""
          className="w-24 h-16 object-cover rounded-lg flex-shrink-0"
        />
      ) : (
        <div className={`w-24 h-16 flex items-center justify-center rounded-lg flex-shrink-0 ${colorClass}`}>
          <span className="material-symbols-outlined text-[28px]">{icon}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 group-hover:text-primary transition-colors line-clamp-1">
            {item.title}
          </h3>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 ${colorClass}`}>
            {item.type}
          </span>
        </div>
        {item.highlight ? (
          <p
            className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
            dangerouslySetInnerHTML={{ __html: item.highlight }}
          />
        ) : item.description ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{item.description}</p>
        ) : null}
        {item.category && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{item.category}</p>
        )}
      </div>
    </Link>
  );
};
