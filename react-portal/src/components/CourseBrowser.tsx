import React, { useState } from 'react';
import { api } from '../api/client';

// Ignite series browser (issue #243). Series are pure organization — no
// enroll/subscribe or progress tracking (that belongs to Courses/curriculum).

export interface SeriesInfo {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  video_count: number;
  thumbnail: string | null;
}

interface VideoPreview {
  id: string;
  slug: string;
  title: string;
  category: string;
  duration_s: number | null;
  thumbnail: string | null;
  sort_order: number;
}

interface SeriesBrowserProps {
  series: SeriesInfo[];
  onStartSeries: (seriesSlug: string) => void;
}

const formatDuration = (s: number | null): string => {
  if (!s) return '–';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const CourseBrowser: React.FC<SeriesBrowserProps> = ({
  series,
  onStartSeries,
}) => {
  const [selectedSeries, setSelectedSeries] = useState<SeriesInfo | null>(null);
  const [previewVideos, setPreviewVideos] = useState<VideoPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleSelectSeries = async (s: SeriesInfo) => {
    setSelectedSeries(s);
    setPreviewVideos([]);
    setPreviewLoading(true);
    try {
      const data = await api.get<{ videos: VideoPreview[] }>(`/video/series/${s.slug}`);
      setPreviewVideos(data.videos);
    } catch {
      setPreviewVideos([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const apiBase = import.meta.env.VITE_API_URL || '';

  if (selectedSeries) {
    const thumb = selectedSeries.thumbnail
      ? `${apiBase}${selectedSeries.thumbnail}`
      : null;

    return (
      <div className="max-w-4xl mx-auto">
        {/* Back */}
        <button
          onClick={() => setSelectedSeries(null)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary transition-colors mb-6"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          All Series
        </button>

        {/* Series hero */}
        <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark mb-6">
          {thumb && (
            <div className="w-full h-48 overflow-hidden">
              <img src={thumb} alt={selectedSeries.title} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{selectedSeries.title}</h1>
                {selectedSeries.description && (
                  <p className="text-sm text-slate-500 leading-relaxed">{selectedSeries.description}</p>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full">
                  {selectedSeries.video_count} {selectedSeries.video_count === 1 ? 'video' : 'videos'}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              {previewVideos.length > 0 && (
                <button
                  onClick={() => onStartSeries(selectedSeries.slug)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-sm font-bold transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">play_circle</span>
                  Start Watching
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Video list */}
        <h2 className="text-sm font-bold text-text uppercase tracking-wider mb-3">
          Series Content
        </h2>
        {previewLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
          </div>
        ) : previewVideos.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No videos published yet.</p>
        ) : (
          <div className="space-y-2">
            {previewVideos.map((v, idx) => {
              const vThumb = v.thumbnail ? `${apiBase}${v.thumbnail}` : null;
              return (
                <div
                  key={v.id}
                  className="flex items-center gap-4 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark"
                >
                  <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                    {idx + 1}
                  </div>
                  {vThumb ? (
                    <img src={vThumb} alt={v.title} className="w-16 h-10 object-cover rounded-lg shrink-0" />
                  ) : (
                    <div className="w-16 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-sm text-slate-400">play_circle</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{v.title}</p>
                    <p className="text-[11px] text-slate-400">{v.category} · {formatDuration(v.duration_s)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Video Series</h1>
          <p className="text-sm text-slate-500 mt-1">Browse videos grouped by series</p>
        </div>
      </div>

      {/* Series grid */}
      {series.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">video_library</span>
          <h2 className="text-xl font-bold text-text-faint mb-2">No Series Available</h2>
          <p className="text-sm text-text-faint">Series will appear here once created by an admin.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {series.map((s) => {
            const thumb = s.thumbnail ? `${apiBase}${s.thumbnail}` : null;

            return (
              <div
                key={s.id}
                onClick={() => handleSelectSeries(s)}
                className="group cursor-pointer rounded-2xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark overflow-hidden hover:border-primary/30 hover:shadow-lg transition-all duration-200"
              >
                {/* Thumbnail */}
                <div className="w-full h-40 bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
                  {thumb ? (
                    <img src={thumb} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">video_library</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {s.title}
                  </h3>
                  {s.description && (
                    <p className="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2">{s.description}</p>
                  )}

                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">play_circle</span>
                    {s.video_count} videos
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
