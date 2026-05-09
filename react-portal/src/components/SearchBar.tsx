import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = (import.meta.env.VITE_API_URL as string) || '';

interface SuggestItem {
  type: string;
  id: string;
  title: string;
  description: string;
  url: string;
  thumbnail: string | null;
  category: string | null;
}

const TYPE_ICONS: Record<string, string> = {
  video: 'play_circle',
  article: 'article',
  solution: 'lightbulb',
  news: 'newspaper',
};

const TYPE_COLORS: Record<string, string> = {
  video: 'text-blue-500',
  article: 'text-green-500',
  solution: 'text-purple-500',
  news: 'text-orange-500',
};

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const SearchBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchSuggestions = useCallback(
    debounce(async (q: string) => {
      if (!q.trim()) { setSuggestions([]); setOpen(false); return; }
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/search/suggest?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const data: SuggestItem[] = await res.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 280),
    []
  );

  useEffect(() => {
    fetchSuggestions(query);
  }, [query, fetchSuggestions]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const goToSearch = (q: string) => {
    if (!q.trim()) return;
    setOpen(false);
    setQuery('');
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const goToItem = (url: string) => {
    setOpen(false);
    setQuery('');
    navigate(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        goToItem(suggestions[activeIndex].url);
      } else {
        goToSearch(query);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="relative w-52">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30 transition-all">
        <span className="material-symbols-outlined text-[18px] text-slate-400">search</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIndex(-1); }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder="Search..."
          className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none min-w-0"
        />
        {loading && (
          <span className="material-symbols-outlined text-[16px] text-slate-400 animate-spin">progress_activity</span>
        )}
        {query && !loading && (
          <button onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-[200] overflow-hidden"
        >
          <ul>
            {suggestions.map((item, i) => (
              <li key={`${item.type}-${item.id}`}>
                <button
                  className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === activeIndex
                      ? 'bg-slate-100 dark:bg-slate-800'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => goToItem(item.url)}
                >
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail.startsWith('http') ? item.thumbnail : `${API_BASE}${item.thumbnail}`}
                      alt=""
                      className="w-10 h-7 object-cover rounded flex-shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className={`w-10 h-7 flex items-center justify-center rounded flex-shrink-0 mt-0.5 bg-slate-100 dark:bg-slate-800 ${TYPE_COLORS[item.type] || 'text-slate-400'}`}>
                      <span className="material-symbols-outlined text-[18px]">{TYPE_ICONS[item.type] || 'search'}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{item.description}</p>
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide mt-1 flex-shrink-0 ${TYPE_COLORS[item.type] || 'text-slate-400'}`}>
                    {item.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            className="w-full flex items-center gap-2 px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 text-sm text-primary hover:bg-primary/5 transition-colors"
            onClick={() => goToSearch(query)}
          >
            <span className="material-symbols-outlined text-[16px]">search</span>
            See all results for "<span className="font-medium">{query}</span>"
          </button>
        </div>
      )}
    </div>
  );
};
