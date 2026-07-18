import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { api, toApiError } from '../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface VideoEditorInfo {
  id: string;
  title: string;
  duration_s: number | null;
  status: string;
  raw_url: string;
  raw_available: boolean;
  source_width: number | null;
  source_height: number | null;
  aspect_ratio: number | null;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Standalone, full-page video editor shell (issue #255 tracer slice).
 *
 * Opened in a new browser tab from AdminVideos.tsx. Not wrapped in
 * AdminLayout — this page owns its own dark NLE-style chrome and its own
 * auth guard (mirrors AdminLayout's check; the real enforcement is the
 * `verify_video_access` dependency on the backend endpoint).
 *
 * This slice ships the shell + raw-file preview + basic transport only.
 * Timeline, lanes, and the edit list (cut/trim/speed) land in later issues.
 */
export const AdminVideoEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user, isAdmin, loading: authLoading } = useAuth();

  const [info, setInfo] = useState<VideoEditorInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<VideoEditorInfo>(`/admin/videos/${id}/editor-info`)
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        if (data.duration_s) setDuration(data.duration_s);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(toApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || playbackError) return;
    if (v.paused) {
      v.play().catch(() => setPlaybackError(true));
    } else {
      v.pause();
    }
  }, [playbackError]);

  // Spacebar toggles play/pause, unless focus is in a form control.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|button|select/i.test(target.tagName)) return;
      e.preventDefault();
      togglePlay();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [togglePlay]);

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    const strip = stripRef.current;
    if (!v || !strip || duration <= 0 || playbackError) return;
    const rect = strip.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
    setCurrentTime(v.currentTime);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  const isContent = user?.role === 'content';
  if (!user || (!isAdmin && !isContent)) {
    return <Navigate to="/login" replace />;
  }

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const aspect = info?.aspect_ratio && info.aspect_ratio > 0 ? info.aspect_ratio : 16 / 9;

  return (
    <div className="min-h-screen h-screen flex flex-col bg-[#0B0F17] text-[#E8EDF6] overflow-hidden">
      {/* Header */}
      <header className="h-[52px] shrink-0 flex items-center gap-3.5 px-4 bg-[#141B28] border-b border-[#243043]">
        <Link
          to="/admin/videos"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm text-[#96A2B8] hover:text-[#E8EDF6] hover:bg-[#0F1520] transition-colors"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Admin&nbsp;/&nbsp;Videos
        </Link>
        {info && (
          <div className="min-w-0">
            <div className="font-semibold text-[15px] truncate max-w-[36rem]">{info.title}</div>
            <div className="text-xs text-[#5C6880] flex items-center gap-2">
              <span className="capitalize">{info.status}</span>
              {info.duration_s ? (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums">{fmtTime(info.duration_s)}</span>
                </>
              ) : null}
              {info.source_width && info.source_height ? (
                <>
                  <span>·</span>
                  <span>{info.source_width}×{info.source_height}</span>
                </>
              ) : null}
            </div>
          </div>
        )}
        <div className="flex-1" />
        <span className="text-[10px] font-bold tracking-[0.1em] text-[#F5A524] border border-[#F5A524]/40 rounded-full px-2.5 py-0.5">
          EDITOR PREVIEW
        </span>
      </header>

      {/* Main */}
      <main className="flex-1 min-h-0 flex flex-col p-4 gap-3">
        {loadingInfo ? (
          <div className="flex-1 flex items-center justify-center text-[#5C6880]">Loading video…</div>
        ) : loadError ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-md text-center space-y-2 p-6 rounded-xl border border-red-500/30 bg-red-500/10">
              <span className="material-symbols-outlined text-red-400 text-3xl">error</span>
              <p className="text-sm text-red-300">{loadError}</p>
              <Link to="/admin/videos" className="inline-block mt-2 text-sm text-primary hover:underline">
                Back to Admin / Videos
              </Link>
            </div>
          </div>
        ) : info && !info.raw_available ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-md text-center space-y-2 p-6 rounded-xl border border-amber-500/30 bg-amber-500/10">
              <span className="material-symbols-outlined text-amber-400 text-3xl">warning</span>
              <p className="text-sm text-amber-300">
                No source file was found on disk for this video. Upload or re-upload the video before editing.
              </p>
            </div>
          </div>
        ) : (
          <>
            {playbackError && (
              <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
                <span className="material-symbols-outlined text-base">error</span>
                This source codec can&apos;t be previewed in the editor (the browser could not decode
                the raw file — likely HEVC/H.265 or another format outside browser codec support).
                Transcode the video first, or use a browser with broader codec support.
              </div>
            )}

            {/* Stage */}
            <div className="flex-1 min-h-0 rounded-lg border border-[#243043] bg-black flex items-center justify-center overflow-hidden">
              {info && (
                <video
                  ref={videoRef}
                  src={`${API_BASE}${info.raw_url}`}
                  className="max-w-full max-h-full"
                  style={{ aspectRatio: String(aspect) }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                  onLoadedMetadata={(e) => {
                    const el = e.target as HTMLVideoElement;
                    if (el.duration && Number.isFinite(el.duration)) setDuration(el.duration);
                  }}
                  onError={() => setPlaybackError(true)}
                />
              )}
            </div>

            {/* Transport */}
            <div className="shrink-0 flex items-center gap-3.5">
              <button
                onClick={togglePlay}
                disabled={playbackError}
                aria-label={playing ? 'Pause' : 'Play'}
                className="w-9 h-9 rounded-full bg-primary hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center shrink-0"
              >
                <span className="material-symbols-outlined text-lg">{playing ? 'pause' : 'play_arrow'}</span>
              </button>
              <span className="font-mono tabular-nums text-[13px] text-[#96A2B8] shrink-0">
                <b className="text-[#E8EDF6] font-semibold">{fmtTime(currentTime)}</b> / {fmtTime(duration)}
              </span>
              <div
                ref={stripRef}
                onClick={handleSeekClick}
                className={`flex-1 h-2 rounded-full bg-[#141B28] border border-[#243043] relative ${playbackError ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};
