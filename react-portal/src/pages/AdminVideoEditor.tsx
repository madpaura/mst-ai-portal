import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { api, toApiError } from '../api/client';
import { EditorTimeline } from '../components/editor/EditorTimeline';
import { EditsPanel } from '../components/editor/EditsPanel';
import type { EditOp, EditorStyle } from '../components/editor/types';
import {
  DEFAULT_STYLE,
  UNDO_CAP,
  estimateOutputDuration,
  fmtClock as fmtTime,
  genEditId,
} from '../components/editor/types';

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

interface VideoEditorDraft {
  video_id: string;
  edits: EditOp[];
  muted: boolean;
  style: EditorStyle;
  updated_at: string;
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Standalone, full-page video editor shell (issue #255 tracer slice) plus
 * the non-destructive EDL core (issue #256): a timeline with cut/trim
 * regions, an Edits side panel, undo (capped at 5), and debounced autosave
 * of the draft. Nothing here touches the raw file — rendering the draft
 * into an actual export/apply lands in a later slice.
 *
 * Opened in a new browser tab from AdminVideos.tsx. Not wrapped in
 * AdminLayout — this page owns its own dark NLE-style chrome and its own
 * auth guard (mirrors AdminLayout's check; the real enforcement is the
 * `verify_video_access` dependency on the backend endpoints).
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

  // ── EDL draft state (issue #256) ──────────────────────────────────────
  const [edits, setEdits] = useState<EditOp[]>([]);
  const [muted, setMuted] = useState(false); // stored/persisted; UI lands in a later slice
  const [style, setStyle] = useState<EditorStyle>(DEFAULT_STYLE); // ditto
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [skipCuts, setSkipCuts] = useState(true);
  const [undoDepth, setUndoDepth] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const undoStackRef = useRef<EditOp[][]>([]);
  const justLoadedRef = useRef(true); // skips the autosave effect run caused by mount / draft load
  const mountedRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // Load the saved EDL draft (independent of editor-info — a missing/failed
  // draft just means "start from an empty one", not a page-level error).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<VideoEditorDraft>(`/admin/videos/${id}/editor-draft`)
      .then((data) => {
        if (cancelled) return;
        justLoadedRef.current = true;
        setEdits(data.edits ?? []);
        setMuted(!!data.muted);
        setStyle(data.style ?? DEFAULT_STYLE);
      })
      .catch(() => {
        // No draft yet, or it failed to load — proceed with an empty one.
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const saveDraft = useCallback(
    async (nextEdits: EditOp[], nextMuted: boolean, nextStyle: EditorStyle) => {
      if (!id) return;
      setSaveState('saving');
      try {
        await api.put(`/admin/videos/${id}/editor-draft`, {
          edits: nextEdits,
          muted: nextMuted,
          style: nextStyle,
        });
        if (mountedRef.current) setSaveState('saved');
      } catch {
        if (mountedRef.current) setSaveState('error');
      }
    },
    [id],
  );

  // Debounced autosave — fires on any edits/muted/style change, except the
  // one caused by mount or by the draft-load effect above.
  useEffect(() => {
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      return;
    }
    setSaveState('pending');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveDraft(edits, muted, style);
    }, 900);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, muted, style]);

  // ── Undo (capped at the last 5 actions — explicit product decision) ────
  const applyEdits = useCallback(
    (next: EditOp[]) => {
      const stack = undoStackRef.current;
      stack.push(edits);
      if (stack.length > UNDO_CAP) stack.shift();
      setUndoDepth(stack.length);
      setEdits(next);
    },
    [edits],
  );

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    const last = stack.pop();
    if (last === undefined) return;
    setUndoDepth(stack.length);
    setEdits(last);
    setSelectedEditId(null);
  }, []);

  const handleCreateCut = useCallback(
    (start: number, end: number) => {
      applyEdits([...edits, { id: genEditId(), type: 'cut', start_s: start, end_s: end }]);
    },
    [applyEdits, edits],
  );

  const handleCreateTrim = useCallback(
    (start: number, end: number) => {
      // Only one trim can exist — a new one replaces it.
      const withoutTrim = edits.filter((e) => e.type !== 'trim');
      applyEdits([...withoutTrim, { id: genEditId(), type: 'trim', start_s: start, end_s: end }]);
    },
    [applyEdits, edits],
  );

  const handleDeleteEdit = useCallback(
    (editId: string) => {
      applyEdits(edits.filter((e) => e.id !== editId));
      setSelectedEditId((cur) => (cur === editId ? null : cur));
    },
    [applyEdits, edits],
  );

  const outputDuration = useMemo(() => estimateOutputDuration(edits, duration), [edits, duration]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || playbackError) return;
    if (v.paused) {
      v.play().catch(() => setPlaybackError(true));
    } else {
      v.pause();
    }
  }, [playbackError]);

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v || playbackError) return;
      const clamped = Math.max(0, Math.min(duration || v.duration || 0, t));
      v.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [playbackError, duration],
  );

  // Spacebar toggles play/pause, Ctrl/Cmd+Z undoes — both unless focus is in
  // a form control.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|button|select/i.test(target.tagName)) return;
      e.preventDefault();
      togglePlay();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, undo]);

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const strip = stripRef.current;
    if (!strip || duration <= 0 || playbackError) return;
    const rect = strip.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(pct * duration);
  };

  // Preview-skips-cuts: jump over cut regions and clamp to trim bounds
  // during playback, when the toggle is on.
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.target as HTMLVideoElement;
    let t = v.currentTime;
    if (skipCuts) {
      const cut = edits.find((op) => op.type === 'cut' && t >= op.start_s && t < op.end_s);
      if (cut) {
        v.currentTime = cut.end_s;
        t = cut.end_s;
      }
      const trim = edits.find((op) => op.type === 'trim');
      if (trim) {
        if (t < trim.start_s) {
          v.currentTime = trim.start_s;
          t = trim.start_s;
        } else if (t >= trim.end_s) {
          v.currentTime = trim.end_s;
          t = trim.end_s;
          v.pause();
        }
      }
    }
    setCurrentTime(t);
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
  const editorReady = !loadingInfo && !loadError && !!info?.raw_available;

  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'error'
        ? 'Save failed'
        : saveState === 'pending'
          ? 'Unsaved changes'
          : 'Draft saved';

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
        {editorReady && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-[#5C6880] shrink-0 mr-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${saveState === 'error' ? 'bg-red-400' : 'bg-emerald-400'}`}
              />
              <span>{saveLabel}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 mr-1">
              <button
                onClick={undo}
                disabled={undoDepth === 0}
                title="Undo (Ctrl+Z) — last 5 kept"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium border border-[#243043] bg-[#0F1520] hover:border-[#5C6880] disabled:opacity-45 disabled:cursor-default transition-colors"
              >
                <span className="material-symbols-outlined text-base">undo</span>
                Undo
              </button>
              <div className="flex gap-[3px]" aria-hidden="true">
                {Array.from({ length: UNDO_CAP }, (_, i) => (
                  <span
                    key={i}
                    className={`w-[7px] h-[7px] rounded-[2px] ${i < undoDepth ? 'bg-primary' : 'bg-[#243043]'}`}
                  />
                ))}
              </div>
            </div>
          </>
        )}
        <span className="text-[10px] font-bold tracking-[0.1em] text-[#F5A524] border border-[#F5A524]/40 rounded-full px-2.5 py-0.5">
          EDITOR PREVIEW
        </span>
      </header>

      {/* Main */}
      <main className="flex-1 min-h-0 flex">
        <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
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
                    onTimeUpdate={handleTimeUpdate}
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
                <label className="flex items-center gap-1.5 text-[12.5px] text-[#96A2B8] cursor-pointer shrink-0 select-none">
                  <input
                    type="checkbox"
                    checked={skipCuts}
                    onChange={(e) => setSkipCuts(e.target.checked)}
                    className="accent-primary"
                  />
                  Preview skips cuts
                </label>
                <span className="font-mono tabular-nums text-[13px] text-[#5C6880] shrink-0">
                  output ≈ {fmtTime(outputDuration)}
                </span>
              </div>
            </>
          )}
        </div>

        {editorReady && (
          <EditsPanel
            edits={edits}
            selectedEditId={selectedEditId}
            onSelect={setSelectedEditId}
            onDelete={handleDeleteEdit}
          />
        )}
      </main>

      {editorReady && (
        <EditorTimeline
          duration={duration}
          currentTime={currentTime}
          edits={edits}
          selectedEditId={selectedEditId}
          onSeek={seekTo}
          onSelectEdit={setSelectedEditId}
          onCreateCut={handleCreateCut}
          onCreateTrim={handleCreateTrim}
        />
      )}
    </div>
  );
};
