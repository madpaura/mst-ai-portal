import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from '../components/Navbar';
import { api } from '../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';
const mediaUrl = (url: string | null | undefined) =>
  url ? (url.startsWith('/') ? `${API_BASE}${url}` : url) : '';

interface Meme {
  id: string;
  group_id: string;
  title: string | null;
  image_url: string;
  link_url: string | null;
  sort_order: number;
}

interface MemeGroup {
  id: string;
  title: string;
  slug: string;
  category: string;
  sort_order: number;
  meme_count: number;
  thumbnail: string | null;
}

interface MemeGroupWithMemes extends MemeGroup {
  memes: Meme[];
}

export const Memes: React.FC = () => {
  const [groups, setGroups] = useState<MemeGroup[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [loading, setLoading] = useState(true);

  // Lightbox state
  const [lightbox, setLightbox] = useState<{ group: MemeGroupWithMemes; index: number } | null>(null);
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<MemeGroup[]>('/memes/groups'),
      api.get<string[]>('/memes/categories'),
    ]).then(([g, c]) => {
      setGroups(g);
      setCategories(['All', ...c]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filteredGroups = activeCategory === 'All'
    ? groups
    : groups.filter((g) => g.category === activeCategory);

  const openGroup = async (group: MemeGroup) => {
    setLoadingGroup(group.id);
    try {
      const full = await api.get<MemeGroupWithMemes>(`/memes/groups/${group.slug}`);
      if (full.memes.length > 0) setLightbox({ group: full, index: 0 });
    } finally {
      setLoadingGroup(null);
    }
  };

  const closeLightbox = () => setLightbox(null);

  const prev = useCallback(() => {
    if (!lightbox) return;
    setLightbox((lb) => lb ? { ...lb, index: (lb.index - 1 + lb.group.memes.length) % lb.group.memes.length } : null);
  }, [lightbox]);

  const next = useCallback(() => {
    if (!lightbox) return;
    setLightbox((lb) => lb ? { ...lb, index: (lb.index + 1) % lb.group.memes.length } : null);
  }, [lightbox]);

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox, prev, next]);

  const currentMeme = lightbox?.group.memes[lightbox.index];

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 font-sans">
      <Navbar variant="solutions" />
      <div className="pt-24 pb-16 max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">Memes</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Browse meme collections — click any card to view the series.</p>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2 mb-8">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-all ${
                activeCategory === cat
                  ? 'bg-primary text-white shadow-[0_0_12px_rgba(37,140,244,0.4)]'
                  : 'bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-primary/50 hover:text-primary'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="text-center py-24">
            <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-700 block mb-3">sentiment_dissatisfied</span>
            <p className="text-slate-500">No meme collections yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => openGroup(group)}
                disabled={loadingGroup === group.id}
                className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all text-left"
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  {group.thumbnail ? (
                    <img
                      src={mediaUrl(group.thumbnail)}
                      alt={group.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600">image</span>
                    </div>
                  )}
                  {loadingGroup === group.id && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-2xl animate-spin">progress_activity</span>
                    </div>
                  )}
                  {/* Play overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-3xl opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                      play_circle
                    </span>
                  </div>
                </div>
                {/* Info */}
                <div className="p-3">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{group.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-medium">{group.category}</span>
                    <span className="text-[10px] text-slate-400">{group.meme_count} {group.meme_count === 1 ? 'image' : 'images'}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && currentMeme && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center"
          onClick={closeLightbox}
        >
          <div
            className="relative max-w-3xl w-full mx-4 flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top bar */}
            <div className="w-full flex items-center justify-between mb-3 px-1">
              <div>
                <p className="text-white font-bold text-sm">{lightbox.group.title}</p>
                {currentMeme.title && (
                  <p className="text-slate-400 text-xs">{currentMeme.title}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-xs">{lightbox.index + 1} / {lightbox.group.memes.length}</span>
                {currentMeme.link_url && (
                  <a
                    href={currentMeme.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    title="Open link"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                  </a>
                )}
                <button onClick={closeLightbox} className="text-slate-400 hover:text-white transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            {/* Image */}
            <div className="relative w-full">
              {currentMeme.link_url ? (
                <a href={currentMeme.link_url} target="_blank" rel="noopener noreferrer" title="Open link">
                  <img
                    src={mediaUrl(currentMeme.image_url)}
                    alt={currentMeme.title || lightbox.group.title}
                    className="w-full max-h-[70vh] object-contain rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                  />
                </a>
              ) : (
                <img
                  src={mediaUrl(currentMeme.image_url)}
                  alt={currentMeme.title || lightbox.group.title}
                  className="w-full max-h-[70vh] object-contain rounded-xl"
                />
              )}

              {/* Prev / Next */}
              {lightbox.group.memes.length > 1 && (
                <>
                  <button
                    onClick={prev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    onClick={next}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </>
              )}
            </div>

            {/* Dot indicators */}
            {lightbox.group.memes.length > 1 && (
              <div className="flex gap-1.5 mt-4">
                {lightbox.group.memes.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setLightbox((lb) => lb ? { ...lb, index: i } : null)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${i === lightbox.index ? 'bg-primary w-4' : 'bg-slate-600 hover:bg-slate-400'}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
