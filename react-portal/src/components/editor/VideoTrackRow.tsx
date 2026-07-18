import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';

const POLL_MS = 4000;

type FilmstripStatus = 'ready' | 'generating' | 'unavailable' | 'error';

interface FilmstripMeta {
  status: FilmstripStatus;
  sprite_url?: string | null;
  tile_count?: number | null;
  cols?: number | null;
  rows?: number | null;
  tile_width?: number | null;
  tile_height?: number | null;
  interval_s?: number | null;
}

interface VideoTrackRowProps {
  videoId: string;
  duration: number;
}

/**
 * Video track row — renders the timeline filmstrip sprite (issue #257).
 *
 * On mount, fetches GET /admin/videos/{id}/filmstrip. The backend runs a
 * fast ffmpeg sampling pass on first request and caches the sprite, so this
 * polls (stale-poll `useRef` pattern, per CLAUDE.md / AdminVideos.tsx) while
 * `status === 'generating'`, showing a subtle striped placeholder — not a
 * blocking spinner — until tiles are ready.
 *
 * Tiles are rendered as CSS background-position slices of the single sprite
 * image, sized with pure percentages (of both the tile div and the sprite
 * itself) so they scale correctly at every timeline zoom level without any
 * pixel remeasurement.
 */
export const VideoTrackRow: React.FC<VideoTrackRowProps> = ({ videoId, duration }) => {
  const [meta, setMeta] = useState<FilmstripMeta | null>(null);
  const activeVideoIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeVideoIdRef.current = videoId;
    setMeta(null);
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);

    const poll = async () => {
      if (activeVideoIdRef.current !== videoId) return; // navigated away mid-poll
      try {
        const data = await api.get<FilmstripMeta>(`/admin/videos/${videoId}/filmstrip`);
        if (activeVideoIdRef.current !== videoId) return; // check again after await
        setMeta(data);
        if (data.status === 'generating') {
          pollTimerRef.current = window.setTimeout(poll, POLL_MS);
        }
      } catch {
        if (activeVideoIdRef.current !== videoId) return;
        // Leave the placeholder up; no retry loop on a hard failure here —
        // the endpoint itself caps regeneration attempts server-side.
      }
    };

    poll();

    return () => {
      activeVideoIdRef.current = null;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, [videoId]);

  const ready =
    meta?.status === 'ready' &&
    !!meta.sprite_url &&
    !!meta.cols &&
    !!meta.rows &&
    !!meta.tile_count;

  const placeholderLabel =
    meta?.status === 'error'
      ? 'Filmstrip unavailable'
      : meta?.status === 'unavailable'
        ? null
        : 'Generating filmstrip…';

  return (
    <div className="relative h-14 bg-black border-b border-[#243043] overflow-hidden select-none">
      {!ready && (
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, #141B28 0, #141B28 92px, #0B0F17 92px, #0B0F17 94px)',
          }}
        />
      )}
      {!ready && placeholderLabel && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[#5C6880] tracking-wide">
          {placeholderLabel}
        </div>
      )}
      {ready && duration > 0 && (
        <FilmstripTiles
          spriteUrl={`${API_BASE}${meta!.sprite_url}`}
          cols={meta!.cols as number}
          rows={meta!.rows as number}
          tileCount={meta!.tile_count as number}
          intervalS={meta!.interval_s || duration / (meta!.tile_count as number)}
          duration={duration}
        />
      )}
    </div>
  );
};

interface FilmstripTilesProps {
  spriteUrl: string;
  cols: number;
  rows: number;
  tileCount: number;
  intervalS: number;
  duration: number;
}

/**
 * One absolutely-positioned div per sampled frame. `backgroundSize` blows
 * the sprite up to `cols`×`rows` times the div's own size (in %), so each
 * grid cell maps to exactly one div-width/height; `backgroundPosition`
 * percentages then land on the `col`/`row` fraction of the (image size − box
 * size) span — the standard CSS-sprite-sheet trick — so no JS pixel
 * measurement or ResizeObserver is needed at any zoom level.
 */
const FilmstripTiles: React.FC<FilmstripTilesProps> = ({
  spriteUrl,
  cols,
  rows,
  tileCount,
  intervalS,
  duration,
}) => {
  const tiles: React.ReactNode[] = [];
  for (let i = 0; i < tileCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const start = i * intervalS;
    if (start >= duration) break;
    const end = Math.min(duration, start + intervalS);
    const startPct = (start / duration) * 100;
    const widthPct = ((end - start) / duration) * 100;
    const bgPosX = cols > 1 ? (col / (cols - 1)) * 100 : 0;
    const bgPosY = rows > 1 ? (row / (rows - 1)) * 100 : 0;
    tiles.push(
      <div
        key={i}
        className="absolute inset-y-0"
        style={{
          left: `${startPct}%`,
          width: `${widthPct}%`,
          backgroundImage: `url(${spriteUrl})`,
          backgroundSize: `${cols * 100}% ${rows * 100}%`,
          backgroundPosition: `${bgPosX}% ${bgPosY}%`,
          backgroundRepeat: 'no-repeat',
        }}
      />,
    );
  }
  return <>{tiles}</>;
};
