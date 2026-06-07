import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Fuse from 'fuse.js';
import { Navbar } from '../components/Navbar';
import { api } from '../api/client';
import { useAuth } from '../api/auth';

// ── Types (mirror public /video endpoints) ──
interface ApiVideo {
  id: string;
  slug: string;
  title: string;
  category: string;
  duration_s: number | null;
  description: string | null;
  hls_path: string | null;
  thumbnail: string | null;
  course_id: string | null;
  sort_order: number;
  created_at: string;
  author_name: string | null;
}

interface ApiCourse {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  video_count: number;
  thumbnail: string | null;
  sort_order: number;
  is_featured: boolean;
}

interface Playlist {
  id: string;
  name: string;
  video_count: number;
  video_slugs: string[];
  created_at: string;
}

interface MyCourse {
  course_id: string;
  course_slug: string;
  course_title: string;
  total_videos: number;
  is_enrolled: boolean;
}

// Discover modes. "rated" = Top Rated (likes proxy until dedicated ratings land).
type DiscoverMode = 'all' | 'recent' | 'history' | 'trending' | 'saved' | 'rated';

const apiBase = import.meta.env.VITE_API_URL || '';

const fmtDuration = (s: number | null): string => {
  if (!s) return '–';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const fmtViews = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

const fmtRelDate = (iso: string): string => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${days < 730 ? '' : 's'} ago`;
};

// Deterministic gradient fallback when a video/course has no thumbnail.
const GRADIENTS = [
  'from-blue-900 to-blue-600',
  'from-emerald-900 to-emerald-600',
  'from-cyan-900 to-cyan-600',
  'from-slate-900 to-primary',
  'from-slate-900 to-violet-700',
  'from-teal-900 to-teal-600',
  'from-stone-900 to-amber-700',
  'from-green-950 to-green-700',
  'from-fuchsia-950 to-rose-700',
  'from-indigo-950 to-indigo-700',
];
const gradFor = (key: string): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
};

const CATEGORY_ICON: Record<string, string> = {
  ai: 'smart_toy',
  'ai & ml': 'smart_toy',
  agents: 'smart_toy',
  rag: 'search',
  'code-mate': 'cable',
  firmware: 'memory',
  architecture: 'architecture',
  'deep dive': 'science',
  onboarding: 'school',
  tools: 'deployed_code',
};
const iconFor = (category: string): string =>
  CATEGORY_ICON[category.toLowerCase()] || 'play_circle';

const initialsFromTitle = (title: string): string =>
  title.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'V';

// Read cached watch position (set by the player page).
const localPosition = (slug: string): number => {
  try {
    const v = localStorage.getItem(`mst_vpos_${slug}`);
    return v ? parseFloat(v) : 0;
  } catch { return 0; }
};

export const IgniteBrowse: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [videos, setVideos] = useState<ApiVideo[]>([]);
  const [courses, setCourses] = useState<ApiCourse[]>([]);
  const [views, setViews] = useState<Record<string, number>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [myCourses, setMyCourses] = useState<MyCourse[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtering: a single discover mode + an optional exclusive "scope"
  // (a course/series or a playlist) + a category + free-text search.
  // All of these are mirrored in the URL so browser-back from a video restores
  // the exact view (My Playlists / Saved / Series / a category / search …)
  // instead of falling back to the default browse page.
  const [mode, setMode] = useState<DiscoverMode>(() => (searchParams.get('view') as DiscoverMode) || 'all');
  const [category, setCategory] = useState<string>(() => searchParams.get('cat') || 'all');
  const [courseScope, setCourseScope] = useState<string | null>(() => searchParams.get('course'));
  const [playlistScope, setPlaylistScope] = useState<string | null>(() => searchParams.get('playlist'));
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  const updateSearch = (value: string) => setSearch(value);

  // Canonical serialization of the active view → URL query params.
  const viewParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('q', search);
    if (courseScope) p.set('course', courseScope);
    else if (playlistScope) p.set('playlist', playlistScope);
    else {
      if (mode !== 'all') p.set('view', mode);
      if (category !== 'all') p.set('cat', category);
    }
    return p;
  }, [search, courseScope, playlistScope, mode, category]);

  // Keep the URL in sync with the active view (replace — no history spam).
  useEffect(() => {
    setSearchParams(viewParams, { replace: true });
  }, [viewParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll restoration: persist the main panel's scroll per view (keyed by the
  // serialized view) so browser-back from a video returns to the exact position.
  const mainRef = useRef<HTMLElement>(null);
  const scrollRestoredRef = useRef(false);
  const scrollKey = `ignite_scroll:${viewParams.toString()}`;
  const saveScroll = () => {
    if (mainRef.current) {
      try { sessionStorage.setItem(scrollKey, String(mainRef.current.scrollTop)); } catch { /* ignore */ }
    }
  };

  // Playlist management UI state.
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editingPlaylistName, setEditingPlaylistName] = useState('');
  const [playlistMenuFor, setPlaylistMenuFor] = useState<string | null>(null); // video slug

  useEffect(() => {
    Promise.all([
      api.get<ApiCourse[]>('/video/courses'),
      api.get<ApiVideo[]>('/video/videos'),
    ])
      .then(([courseList, videoList]) => {
        setCourses(courseList);
        setVideos(videoList);
      })
      .catch(() => { /* graceful empty state */ })
      .finally(() => setLoading(false));
    // View counts power the views badge + Trending; like counts power Top Rated.
    api.get<Record<string, number>>('/video/videos/stats')
      .then(setViews).catch(() => {});
    api.get<Record<string, number>>('/video/videos/like-counts')
      .then(setLikes).catch(() => {});
    api.post('/analytics/pageview', { path: '/ignite' }).catch(() => {});
  }, []);

  // Load user-scoped library data once auth resolves.
  useEffect(() => {
    if (!user) {
      setSaved(new Set());
      setPlaylists([]);
      setMyCourses([]);
      return;
    }
    api.get<string[]>('/video/bookmarks')
      .then((slugs) => setSaved(new Set(slugs))).catch(() => {});
    api.get<Playlist[]>('/video/playlists').then(setPlaylists).catch(() => {});
    api.get<MyCourse[]>('/video/my-courses').then(setMyCourses).catch(() => {});
  }, [user]);

  // ── Scope/mode selection helpers (keep the four filters mutually consistent) ──
  // Any sidebar selection also exits search so the chosen view is shown.
  const selectMode = (m: DiscoverMode) => {
    updateSearch(''); setMode(m); setCourseScope(null); setPlaylistScope(null);
  };
  const selectCategory = (c: string) => {
    updateSearch(''); setCategory(c); setCourseScope(null); setPlaylistScope(null);
  };
  const selectCourse = (id: string) => {
    updateSearch(''); setCourseScope(id); setPlaylistScope(null); setMode('all'); setCategory('all');
    document.getElementById('all-videos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const selectPlaylist = (id: string) => {
    updateSearch(''); setPlaylistScope(id); setCourseScope(null); setMode('all'); setCategory('all');
    document.getElementById('all-videos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleSaved = async (slug: string) => {
    if (!user) { navigate('/login'); return; }
    const isSaved = saved.has(slug);
    setSaved((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(slug); else next.add(slug);
      return next;
    });
    try {
      if (isSaved) await api.delete(`/video/videos/${slug}/bookmark`);
      else await api.post(`/video/videos/${slug}/bookmark`);
    } catch {
      setSaved((prev) => {
        const next = new Set(prev);
        if (isSaved) next.add(slug); else next.delete(slug);
        return next;
      });
    }
  };

  // ── Playlist operations ──
  const upsertPlaylist = (p: Playlist) =>
    setPlaylists((prev) => {
      const i = prev.findIndex((x) => x.id === p.id);
      if (i === -1) return [...prev, p];
      const next = [...prev]; next[i] = p; return next;
    });

  const createPlaylist = async (name: string, addSlug?: string): Promise<Playlist | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      let pl = await api.post<Playlist>('/video/playlists', { name: trimmed });
      if (addSlug) pl = await api.post<Playlist>(`/video/playlists/${pl.id}/videos`, { slug: addSlug });
      upsertPlaylist(pl);
      return pl;
    } catch { return null; }
  };

  const deletePlaylist = async (id: string) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    if (playlistScope === id) selectMode('all');
    try { await api.delete(`/video/playlists/${id}`); } catch { /* ignore */ }
  };

  const renamePlaylist = async (id: string, name: string) => {
    const trimmed = name.trim();
    setEditingPlaylistId(null);
    if (!trimmed) return;
    try {
      const pl = await api.put<Playlist>(`/video/playlists/${id}`, { name: trimmed });
      upsertPlaylist(pl);
    } catch { /* ignore */ }
  };

  const togglePlaylistVideo = async (playlistId: string, slug: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    const has = pl?.video_slugs.includes(slug);
    try {
      const updated = has
        ? await api.delete<Playlist>(`/video/playlists/${playlistId}/videos/${slug}`)
        : await api.post<Playlist>(`/video/playlists/${playlistId}/videos`, { slug });
      upsertPlaylist(updated);
    } catch { /* ignore */ }
  };

  const courseTitle = useMemo(() => {
    const m: Record<string, string> = {};
    courses.forEach((c) => { m[c.id] = c.title || c.slug; });
    return m;
  }, [courses]);

  const coursesWithVideos = useMemo(
    () => courses.filter((c) => c.video_count > 0),
    [courses],
  );

  // Dynamic category list from published videos.
  const categories = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => v.category && set.add(v.category));
    return Array.from(set).sort();
  }, [videos]);

  // Continue-watching map: slug -> progress pct (0..100) from local positions.
  const progressBySlug = useMemo(() => {
    const m: Record<string, number> = {};
    videos.forEach((v) => {
      if (!v.duration_s) return;
      const pos = localPosition(v.slug);
      if (pos > 5) m[v.slug] = Math.min(100, Math.round((pos / v.duration_s) * 100));
    });
    return m;
  }, [videos]);

  const continueWatching = useMemo(
    () => videos.filter((v) => {
      const p = progressBySlug[v.slug];
      return p !== undefined && p > 0 && p < 100;
    }),
    [videos, progressBySlug],
  );

  // Subscribed (enrolled) courses that still have videos.
  const subscribedCourses = useMemo(
    () => myCourses.filter((c) => c.is_enrolled && c.total_videos > 0),
    [myCourses],
  );

  // Apply scope → mode → category → search to the grid.
  const filtered = useMemo(() => {
    let list = [...videos];
    if (playlistScope) {
      const pl = playlists.find((p) => p.id === playlistScope);
      const set = new Set(pl?.video_slugs || []);
      list = list.filter((v) => set.has(v.slug));
    } else if (courseScope) {
      list = list.filter((v) => v.course_id === courseScope);
    } else if (mode === 'recent') {
      list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    } else if (mode === 'trending') {
      list.sort((a, b) => (views[b.slug] || 0) - (views[a.slug] || 0));
    } else if (mode === 'rated') {
      list.sort((a, b) => (likes[b.slug] || 0) - (likes[a.slug] || 0));
    } else if (mode === 'history') {
      list = list.filter((v) => progressBySlug[v.slug] !== undefined);
    } else if (mode === 'saved') {
      list = list.filter((v) => saved.has(v.slug));
    }
    if (category !== 'all') list = list.filter((v) => v.category === category);
    return list;
  }, [videos, mode, category, progressBySlug, views, likes, saved, courseScope, playlistScope, playlists]);

  // Fuzzy search index (YouTube-style results). Includes the resolved course
  // title so a series name matches even though videos only store course_id.
  const fuse = useMemo(() => {
    const docs = videos.map((v) => ({
      v,
      title: v.title,
      series: v.course_id ? courseTitle[v.course_id] || '' : '',
      category: v.category,
      author: v.author_name || '',
      description: v.description || '',
    }));
    return new Fuse(docs, {
      includeScore: true,
      ignoreLocation: true,
      // Stricter than the default 0.6 — requires a genuine (near-word) match
      // so unrelated videos are excluded rather than everything matching.
      threshold: 0.3,
      minMatchCharLength: 2,
      keys: [
        { name: 'title', weight: 0.5 },
        { name: 'series', weight: 0.2 },
        { name: 'category', weight: 0.15 },
        { name: 'author', weight: 0.1 },
        { name: 'description', weight: 0.05 },
      ],
    });
  }, [videos, courseTitle]);

  const searchQuery = search.trim();
  const searching = searchQuery.length >= 2;
  const searchResults = useMemo(
    () => (searching ? fuse.search(searchQuery).map((r) => r.item.v) : []),
    [fuse, searchQuery, searching],
  );

  // Featured = admin-flagged course; else first populated course by sort_order.
  const featuredCourse = useMemo(() => {
    if (coursesWithVideos.length === 0) return null;
    return coursesWithVideos.find((c) => c.is_featured)
      ?? [...coursesWithVideos].sort((a, b) => a.sort_order - b.sort_order)[0];
  }, [coursesWithVideos]);

  const startCourse = (courseId: string | undefined) => {
    if (!courseId) return;
    const first = videos
      .filter((v) => v.course_id === courseId)
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    if (first) navigate(`/ignite/${first.slug}`);
  };

  const openVideo = (slug: string) => { saveScroll(); navigate(`/ignite/${slug}`); };

  // Restore saved scroll once content is rendered (before paint to avoid flicker).
  useLayoutEffect(() => {
    if (loading || scrollRestoredRef.current || !mainRef.current) return;
    const saved = sessionStorage.getItem(scrollKey);
    if (saved) mainRef.current.scrollTop = parseInt(saved, 10) || 0;
    scrollRestoredRef.current = true;
  }, [loading, scrollKey]);

  // Heading reflects the active scope/mode.
  const gridTitle =
    playlistScope ? (playlists.find((p) => p.id === playlistScope)?.name || 'Playlist')
    : courseScope ? (courseTitle[courseScope] || 'Series')
    : mode === 'recent' ? 'Recently Added'
    : mode === 'history' ? 'Watch History'
    : mode === 'trending' ? 'Trending'
    : mode === 'rated' ? 'Top Rated'
    : mode === 'saved' ? 'Saved'
    : 'All Videos';

  // ── Sidebar nav item ──
  const NavItem: React.FC<{
    icon: string; label: string; active?: boolean; badge?: number;
    disabled?: boolean; onClick?: () => void; title?: string;
  }> = ({ icon, label, active, badge, disabled, onClick, title }) => (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-primary-subtle text-primary'
          : disabled
          ? 'text-text-faint opacity-50 cursor-not-allowed'
          : 'text-text-muted hover:bg-surface-muted hover:text-text-strong'
      }`}
    >
      <span className="material-symbols-outlined text-[20px] w-[22px] text-center">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {badge !== undefined && (
        <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
      )}
    </button>
  );

  const navLabel = 'text-[10px] font-bold uppercase tracking-[0.12em] text-text-faint px-2.5 mb-2';

  // ── Video card ──
  const VideoCard: React.FC<{ v: ApiVideo }> = ({ v }) => {
    const pct = progressBySlug[v.slug];
    const thumb = v.thumbnail ? `${apiBase}${v.thumbnail}` : null;
    const author = v.author_name?.trim() || v.title;
    const viewCount = views[v.slug] || 0;
    const likeCount = likes[v.slug] || 0;
    const isSaved = saved.has(v.slug);
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => openVideo(v.slug)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVideo(v.slug); } }}
        className="group text-left cursor-pointer bg-surface border border-border-base rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:border-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <div className="relative aspect-video overflow-hidden">
          {thumb ? (
            <img src={thumb} alt={v.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${gradFor(v.category + v.id)} flex items-center justify-center transition-transform duration-300 group-hover:scale-105`}>
              <span className="material-symbols-outlined text-white/85 text-[44px]">{iconFor(v.category)}</span>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
            <div className="w-11 h-11 rounded-full bg-white/15 border border-white/40 backdrop-blur flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all">
              <span className="material-symbols-outlined text-white text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
            </div>
          </div>
          {/* Top-right controls: add-to-playlist + bookmark */}
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); if (!user) { navigate('/login'); return; } setPlaylistMenuFor(v.slug); }}
              title={user ? 'Add to playlist' : 'Sign in to use playlists'}
              className="w-8 h-8 rounded-full flex items-center justify-center backdrop-blur transition-all bg-black/55 text-white opacity-0 group-hover:opacity-100 hover:bg-black/75"
            >
              <span className="material-symbols-outlined text-[18px]">playlist_add</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); toggleSaved(v.slug); }}
              title={!user ? 'Sign in to save' : isSaved ? 'Remove from Saved' : 'Save'}
              className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur transition-all ${
                isSaved
                  ? 'bg-primary text-white opacity-100'
                  : 'bg-black/55 text-white opacity-0 group-hover:opacity-100 hover:bg-black/75'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0" }}>bookmark</span>
            </button>
          </div>
          <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[11px] font-semibold px-1.5 py-0.5 rounded backdrop-blur">
            {fmtDuration(v.duration_s)}
          </span>
        </div>
        <div className="p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-primary mb-1.5 truncate">
            {v.course_id ? courseTitle[v.course_id] || v.category : v.category}
          </div>
          <h3 className="text-[14.5px] font-semibold leading-snug text-text-strong line-clamp-2 mb-3">{v.title}</h3>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-text-muted min-w-0">
              <span
                className={`w-[22px] h-[22px] shrink-0 rounded-full bg-gradient-to-br ${gradFor(author)} flex items-center justify-center text-[9px] font-bold text-white`}
                title={author}
              >
                {initialsFromTitle(author)}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-surface-muted text-text-muted text-[10px] truncate">{v.category}</span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0 text-[11.5px] text-text-muted">
              {likeCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">favorite</span>
                  {fmtViews(likeCount)}
                </span>
              )}
              {viewCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">visibility</span>
                  {fmtViews(viewCount)}
                </span>
              )}
            </div>
          </div>
          {pct !== undefined && pct > 0 && pct < 100 && (
            <div className="mt-3 h-[3px] bg-surface-muted rounded overflow-hidden">
              <div className="h-full bg-primary rounded" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── YouTube-style search result row ──
  const SearchResultRow: React.FC<{ v: ApiVideo }> = ({ v }) => {
    const thumb = v.thumbnail ? `${apiBase}${v.thumbnail}` : null;
    const author = v.author_name?.trim();
    const viewCount = views[v.slug] || 0;
    const series = v.course_id ? courseTitle[v.course_id] : null;
    const pct = progressBySlug[v.slug];
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => openVideo(v.slug)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVideo(v.slug); } }}
        className="group flex flex-col sm:flex-row gap-4 p-2 rounded-xl cursor-pointer hover:bg-surface-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <div className="relative w-full sm:w-[260px] shrink-0 aspect-video rounded-lg overflow-hidden">
          {thumb ? (
            <img src={thumb} alt={v.title} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${gradFor(v.category + v.id)} flex items-center justify-center`}>
              <span className="material-symbols-outlined text-white/85 text-[40px]">{iconFor(v.category)}</span>
            </div>
          )}
          <span className="absolute bottom-1.5 right-1.5 bg-black/75 text-white text-[11px] font-semibold px-1.5 py-0.5 rounded backdrop-blur">
            {fmtDuration(v.duration_s)}
          </span>
          {pct !== undefined && pct > 0 && pct < 100 && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <h3 className="text-base sm:text-[17px] font-semibold leading-snug text-text-strong line-clamp-2 group-hover:text-primary transition-colors">{v.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-text-muted">
            {viewCount > 0 && <span>{fmtViews(viewCount)} views</span>}
            {viewCount > 0 && <span className="text-text-faint">·</span>}
            <span>{fmtRelDate(v.created_at)}</span>
          </div>
          {(series || author) && (
            <div className="mt-2 flex items-center gap-2 text-[12.5px] text-text-muted">
              {author && (
                <span className={`w-5 h-5 rounded-full bg-gradient-to-br ${gradFor(author)} flex items-center justify-center text-[8px] font-bold text-white`}>
                  {initialsFromTitle(author)}
                </span>
              )}
              <span className="truncate">{[author, series].filter(Boolean).join(' · ')}</span>
            </div>
          )}
          {v.description && (
            <p className="mt-1.5 text-[12.5px] text-text-muted line-clamp-2 hidden sm:block">{v.description}</p>
          )}
          <span className="mt-1.5 inline-block px-1.5 py-0.5 rounded bg-surface-muted text-text-muted text-[10px]">{v.category}</span>
        </div>
      </div>
    );
  };

  const sectionHeader = (title: string, right?: React.ReactNode) => (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold tracking-tight text-text-strong">{title}</h2>
      {right}
    </div>
  );

  const empty = !loading && videos.length === 0;
  const noResults = !loading && videos.length > 0 && filtered.length === 0;
  const scopeActive = !!(courseScope || playlistScope);
  const menuVideoSlug = playlistMenuFor;

  return (
    <div className="bg-canvas text-text-strong h-screen overflow-hidden flex flex-col font-sans">
      <Navbar variant="solutions" />

      <div className="flex flex-1 overflow-hidden pt-16">
        {/* Discovery sidebar */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-surface border-r border-border-base py-5 overflow-y-auto">
          <nav className="flex-1 px-3 space-y-6">
            <div>
              <div className={navLabel}>Discover</div>
              <div className="space-y-0.5">
                <NavItem icon="grid_view" label="Browse All" active={!scopeActive && mode === 'all' && category === 'all'} onClick={() => { selectMode('all'); setCategory('all'); }} />
                <NavItem icon="trending_up" label="Trending" active={!scopeActive && mode === 'trending'} onClick={() => selectMode('trending')} />
                <NavItem icon="star" label="Top Rated" active={!scopeActive && mode === 'rated'} onClick={() => selectMode('rated')} />
                <NavItem icon="schedule" label="Recently Added" active={!scopeActive && mode === 'recent'} onClick={() => selectMode('recent')} />
              </div>
            </div>

            {categories.length > 0 && (
              <div>
                <div className={navLabel}>Categories</div>
                <div className="space-y-0.5">
                  <NavItem icon="apps" label="All Categories" active={!scopeActive && category === 'all'} onClick={() => selectCategory('all')} />
                  {categories.map((c) => (
                    <NavItem key={c} icon={iconFor(c)} label={c} active={!scopeActive && category === c} onClick={() => selectCategory(c)} />
                  ))}
                </div>
              </div>
            )}

            {/* Part A — all courses/series with videos; click filters the grid */}
            {coursesWithVideos.length > 0 && (
              <div>
                <div className={navLabel}>Series</div>
                <div className="space-y-0.5">
                  {coursesWithVideos.map((c) => (
                    <NavItem
                      key={c.id}
                      icon="video_library"
                      label={c.title}
                      badge={c.video_count}
                      active={courseScope === c.id}
                      onClick={() => selectCourse(c.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Library */}
            <div>
              <div className={navLabel}>Library</div>
              <div className="space-y-0.5">
                <NavItem
                  icon="bookmark"
                  label="Saved"
                  active={!scopeActive && mode === 'saved'}
                  badge={user && saved.size > 0 ? saved.size : undefined}
                  disabled={!user}
                  title={user ? undefined : 'Sign in to save videos'}
                  onClick={() => selectMode('saved')}
                />
                <NavItem icon="history" label="Watch History" active={!scopeActive && mode === 'history'} onClick={() => selectMode('history')} />
              </div>
            </div>

            {/* Subscribed courses (enrollment) */}
            {user && subscribedCourses.length > 0 && (
              <div>
                <div className={navLabel}>Subscribed</div>
                <div className="space-y-0.5">
                  {subscribedCourses.map((c) => (
                    <NavItem
                      key={c.course_id}
                      icon="subscriptions"
                      label={c.course_title}
                      badge={c.total_videos}
                      active={courseScope === c.course_id}
                      onClick={() => selectCourse(c.course_id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* My Playlists (custom) */}
            <div>
              <div className="flex items-center justify-between px-2.5 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-faint">My Playlists</span>
                <button
                  onClick={() => { if (!user) { navigate('/login'); return; } setShowNewPlaylist((s) => !s); }}
                  title={user ? 'New playlist' : 'Sign in to create playlists'}
                  className="text-text-muted hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>

              {!user ? (
                <p className="px-2.5 text-xs text-text-faint">Sign in to create playlists.</p>
              ) : (
                <div className="space-y-0.5">
                  {showNewPlaylist && (
                    <div className="flex items-center gap-1 px-1 mb-1">
                      <input
                        autoFocus
                        value={newPlaylistName}
                        onChange={(e) => setNewPlaylistName(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') { await createPlaylist(newPlaylistName); setNewPlaylistName(''); setShowNewPlaylist(false); }
                          if (e.key === 'Escape') { setNewPlaylistName(''); setShowNewPlaylist(false); }
                        }}
                        placeholder="Playlist name"
                        className="flex-1 min-w-0 bg-canvas border border-border-base rounded-md px-2 py-1.5 text-sm text-text-strong placeholder-text-faint outline-none focus:border-primary/50"
                      />
                      <button
                        onClick={async () => { await createPlaylist(newPlaylistName); setNewPlaylistName(''); setShowNewPlaylist(false); }}
                        className="shrink-0 text-primary hover:text-primary/80"
                        title="Create"
                      >
                        <span className="material-symbols-outlined text-[20px]">check</span>
                      </button>
                    </div>
                  )}
                  {playlists.length === 0 && !showNewPlaylist && (
                    <p className="px-2.5 text-xs text-text-faint">No playlists yet.</p>
                  )}
                  {playlists.map((p) => (
                    editingPlaylistId === p.id ? (
                      <div key={p.id} className="flex items-center gap-1 px-1">
                        <input
                          autoFocus
                          value={editingPlaylistName}
                          onChange={(e) => setEditingPlaylistName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') renamePlaylist(p.id, editingPlaylistName);
                            if (e.key === 'Escape') setEditingPlaylistId(null);
                          }}
                          onBlur={() => renamePlaylist(p.id, editingPlaylistName)}
                          className="flex-1 min-w-0 bg-canvas border border-border-base rounded-md px-2 py-1.5 text-sm text-text-strong outline-none focus:border-primary/50"
                        />
                      </div>
                    ) : (
                      <div key={p.id} className="group/pl flex items-center">
                        <button
                          onClick={() => selectPlaylist(p.id)}
                          className={`flex-1 min-w-0 flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-all ${
                            playlistScope === p.id ? 'bg-primary-subtle text-primary' : 'text-text-muted hover:bg-surface-muted hover:text-text-strong'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[20px] w-[22px] text-center">playlist_play</span>
                          <span className="flex-1 text-left truncate">{p.name}</span>
                          <span className="text-[10px] text-text-faint">{p.video_count}</span>
                        </button>
                        <div className="flex items-center opacity-0 group-hover/pl:opacity-100 transition-opacity">
                          <button
                            onClick={() => { setEditingPlaylistId(p.id); setEditingPlaylistName(p.name); }}
                            title="Rename"
                            className="p-1 text-text-faint hover:text-primary"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          <button
                            onClick={() => deletePlaylist(p.id)}
                            title="Delete"
                            className="p-1 text-text-faint hover:text-danger"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </div>
                    )
                  ))}
                </div>
              )}
            </div>
          </nav>
        </aside>

        {/* Main */}
        <main ref={mainRef} onScroll={saveScroll} className="flex-1 overflow-y-auto relative">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

          {/* Search topbar */}
          <div className="sticky top-0 z-10 bg-canvas/80 backdrop-blur-xl border-b border-border-base px-6 lg:px-8 py-3.5 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-faint text-[20px] pointer-events-none">search</span>
              <input
                type="text"
                value={search}
                onChange={(e) => updateSearch(e.target.value)}
                placeholder="Search videos, series, topics…"
                className="w-full bg-surface border border-border-base rounded-lg pl-11 pr-4 py-2.5 text-sm text-text-strong placeholder-text-faint outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition"
              />
            </div>
          </div>

          <div className="relative z-[1] p-6 lg:p-8 max-w-[1400px] mx-auto">
            {loading ? (
              <div className="flex items-center justify-center py-32">
                <span className="material-symbols-outlined text-3xl text-text-faint animate-spin">progress_activity</span>
              </div>
            ) : empty ? (
              <div className="flex flex-col items-center justify-center py-32 text-center">
                <span className="material-symbols-outlined text-6xl text-text-faint mb-4">video_library</span>
                <h2 className="text-xl font-bold text-text-strong mb-2">No Content Available</h2>
                <p className="text-sm text-text-muted">Training videos will appear here once published by an admin.</p>
              </div>
            ) : searching ? (
              /* ── YouTube-style fuzzy search results ── */
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold tracking-tight text-text-strong">
                    Results for <span className="text-primary">“{searchQuery}”</span>
                  </h2>
                  <button onClick={() => updateSearch('')} className="text-[13px] font-semibold text-text-muted hover:text-primary flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                    Clear
                  </button>
                </div>
                {searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-text-muted">
                    <span className="material-symbols-outlined text-5xl text-text-faint mb-3">search_off</span>
                    <p className="text-base font-bold text-text-strong mb-1">No matches found</p>
                    <p className="text-sm">Try a different or shorter search term.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 max-w-4xl">
                    {searchResults.map((v) => <SearchResultRow key={v.id} v={v} />)}
                  </div>
                )}
              </section>
            ) : (
              <>
                {/* Featured hero — hidden while a scope filter is active */}
                {featuredCourse && !scopeActive && (
                  <button
                    onClick={() => startCourse(featuredCourse.id)}
                    className="group relative block w-full text-left h-[280px] sm:h-[320px] rounded-2xl overflow-hidden border border-border-base mb-10"
                  >
                    {featuredCourse.thumbnail ? (
                      <img src={`${apiBase}${featuredCourse.thumbnail}`} alt={featuredCourse.title} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#0a1f3a] via-[#07251c] to-[#0a0f14]" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/15 transition-colors">
                      <div className="w-16 h-16 rounded-full bg-white/15 border-2 border-white/35 backdrop-blur flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all">
                        <span className="material-symbols-outlined text-white text-[30px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 w-full sm:w-3/5 p-7 sm:p-8 bg-gradient-to-t from-black/90 to-transparent">
                      <span className="inline-flex items-center gap-1.5 bg-primary/20 border border-primary/35 text-[#8fc4ff] text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3">
                        <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                        Featured Series
                      </span>
                      <h1 className="text-2xl sm:text-[28px] font-bold leading-tight text-white mb-2.5">{featuredCourse.title}</h1>
                      <div className="flex items-center gap-3.5 text-sm text-white/65">
                        <span>{featuredCourse.video_count} {featuredCourse.video_count === 1 ? 'episode' : 'episodes'}</span>
                        {featuredCourse.description && <span className="hidden sm:inline truncate max-w-xs">· {featuredCourse.description}</span>}
                      </div>
                    </div>
                  </button>
                )}

                {/* Category filter pills */}
                {categories.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-7">
                    <button
                      onClick={() => selectCategory('all')}
                      className={`px-4 py-1.5 rounded-full text-[13px] border transition ${
                        !scopeActive && category === 'all'
                          ? 'bg-primary-subtle border-primary/40 text-primary font-semibold'
                          : 'bg-surface border-border-base text-text-muted hover:text-text-strong hover:border-primary/40'
                      }`}
                    >
                      All Videos
                    </button>
                    {categories.map((c) => (
                      <button
                        key={c}
                        onClick={() => selectCategory(c)}
                        className={`px-4 py-1.5 rounded-full text-[13px] border transition ${
                          !scopeActive && category === c
                            ? 'bg-primary-subtle border-primary/40 text-primary font-semibold'
                            : 'bg-surface border-border-base text-text-muted hover:text-text-strong hover:border-primary/40'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* Continue Watching — only on the default view */}
                {continueWatching.length > 0 && !scopeActive && mode === 'all' && category === 'all' && (
                  <section className="mb-10">
                    {sectionHeader('Continue Watching')}
                    <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>
                      {continueWatching.map((v) => <VideoCard key={v.id} v={v} />)}
                    </div>
                  </section>
                )}

                {/* All Videos / scoped grid */}
                <section id="all-videos" className="mb-10 scroll-mt-20">
                  {sectionHeader(
                    gridTitle,
                    <div className="flex items-center gap-3">
                      {scopeActive && (
                        <button onClick={() => { selectMode('all'); setCategory('all'); }} className="text-[13px] font-semibold text-text-muted hover:text-primary flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">close</span>
                          Clear
                        </button>
                      )}
                      <span className="text-[13px] font-semibold text-primary">
                        {filtered.length} video{filtered.length !== 1 ? 's' : ''}
                      </span>
                    </div>,
                  )}
                  {noResults || ((mode === 'history' || mode === 'saved' || scopeActive) && filtered.length === 0) ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center text-text-muted">
                      <span className="material-symbols-outlined text-5xl text-text-faint mb-3">
                        {playlistScope ? 'playlist_play' : mode === 'history' ? 'history' : mode === 'saved' ? 'bookmark' : 'movie'}
                      </span>
                      <p className="text-base font-bold text-text-strong mb-1">
                        {playlistScope ? 'This playlist is empty'
                          : mode === 'history' ? 'Nothing watched yet'
                          : mode === 'saved' ? 'No saved videos'
                          : 'No results found'}
                      </p>
                      <p className="text-sm">
                        {playlistScope ? 'Use the + on any video to add it here.'
                          : mode === 'history' ? 'Videos you start will show up here.'
                          : mode === 'saved' ? 'Tap the bookmark on any video to save it here.'
                          : 'Try different keywords or clear the filters.'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>
                      {filtered.map((v) => <VideoCard key={v.id} v={v} />)}
                    </div>
                  )}
                </section>

                {/* Playlists & Series — hidden while a scope filter is active */}
                {coursesWithVideos.length > 0 && !scopeActive && (
                  <section id="playlists-section" className="mb-6">
                    {sectionHeader('Playlists & Series')}
                    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                      {coursesWithVideos.map((c) => {
                        const thumb = c.thumbnail ? `${apiBase}${c.thumbnail}` : null;
                        return (
                          <button
                            key={c.id}
                            onClick={() => selectCourse(c.id)}
                            className="group shrink-0 w-[190px] text-left"
                          >
                            <div className="relative w-[190px] h-[114px] rounded-xl overflow-hidden border border-border-base mb-2.5 transition-transform group-hover:scale-[1.03]">
                              {thumb ? (
                                <img src={thumb} alt={c.title} className="w-full h-full object-cover" />
                              ) : (
                                <div className={`w-full h-full bg-gradient-to-br ${gradFor(c.title)} flex items-center justify-center`}>
                                  <span className="material-symbols-outlined text-white/85 text-[34px]">{iconFor(c.title)}</span>
                                </div>
                              )}
                              <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[10.5px] font-semibold px-2 py-1 backdrop-blur flex items-center gap-1">
                                <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                                {c.video_count} videos
                              </span>
                            </div>
                            <div className="text-[13px] font-semibold leading-snug text-text-strong line-clamp-2 group-hover:text-primary transition-colors">{c.title}</div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Add-to-playlist modal */}
      {menuVideoSlug && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { setPlaylistMenuFor(null); setNewPlaylistName(''); }}
        >
          <div
            className="w-full max-w-sm bg-surface border border-border-base rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-base">
              <h3 className="text-sm font-bold text-text-strong flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">playlist_add</span>
                Add to playlist
              </h3>
              <button onClick={() => { setPlaylistMenuFor(null); setNewPlaylistName(''); }} className="text-text-muted hover:text-text-strong">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto p-2">
              {playlists.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-6">No playlists yet — create one below.</p>
              ) : (
                playlists.map((p) => {
                  const inPlaylist = p.video_slugs.includes(menuVideoSlug);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePlaylistVideo(p.id, menuVideoSlug)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-muted transition-colors text-left"
                    >
                      <span className={`material-symbols-outlined text-[20px] ${inPlaylist ? 'text-primary' : 'text-text-faint'}`}
                        style={{ fontVariationSettings: inPlaylist ? "'FILL' 1" : "'FILL' 0" }}>
                        {inPlaylist ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm font-medium text-text-strong">{p.name}</span>
                      <span className="text-[11px] text-text-faint">{p.video_count}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-border-base p-3">
              <div className="flex items-center gap-2">
                <input
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newPlaylistName.trim()) {
                      await createPlaylist(newPlaylistName, menuVideoSlug);
                      setNewPlaylistName('');
                    }
                  }}
                  placeholder="New playlist name"
                  className="flex-1 min-w-0 bg-canvas border border-border-base rounded-lg px-3 py-2 text-sm text-text-strong placeholder-text-faint outline-none focus:border-primary/50"
                />
                <button
                  onClick={async () => { if (newPlaylistName.trim()) { await createPlaylist(newPlaylistName, menuVideoSlug); setNewPlaylistName(''); } }}
                  disabled={!newPlaylistName.trim()}
                  className="shrink-0 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IgniteBrowse;
