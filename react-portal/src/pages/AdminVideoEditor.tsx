import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { api, toApiError } from '../api/client';
import { EditorTimeline } from '../components/editor/EditorTimeline';
import { EditsPanel } from '../components/editor/EditsPanel';
import { ExportModal } from '../components/editor/ExportModal';
import type { EditorExportQualityOption, EditorExportStatus } from '../components/editor/ExportModal';
import type { InspectorTab } from '../components/editor/EditsPanel';
import type { EditOp, EditorStyle, EditorSuggestion } from '../components/editor/types';
import {
  DEFAULT_STYLE,
  DEFAULT_SUGGESTION_THRESHOLD_S,
  UNDO_CAP,
  estimateOutputDuration,
  fmtClock as fmtTime,
  genEditId,
} from '../components/editor/types';
import { stylePresetCss } from '../components/editor/stylePresets';

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
  // Apply-to-video staleness (issue #261).
  pipeline_stale: boolean;
  editor_applied_at: string | null;
}

interface VideoEditorDraft {
  video_id: string;
  edits: EditOp[];
  muted: boolean;
  style: EditorStyle;
  suggestions: EditorSuggestion[];
  updated_at: string;
}

interface AutoStatusResponse {
  transcript_status: string | null;
  transcript_error: string | null;
}

interface AnalyzeSuggestionsResponse {
  transcript_status: string;
  transcript_error: string | null;
  threshold_s: number;
  suggestions: EditorSuggestion[];
  warning?: string | null;
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Auto-status is polled (stale-poll `useRef` pattern, per CLAUDE.md) while
// the transcript is being (re)generated from the "Generate transcript first"
// flow (issue #259).
const TRANSCRIPT_POLL_MS = 4000;

// Undo snapshot (issue #258, widened for style by issue #263): covers
// `edits`, `muted` and `style` so the remove-audio toggle and the Style
// panel (preset pick / image upload / remove) all participate in the same
// capped-5 undo stack.
interface UndoSnapshot {
  edits: EditOp[];
  muted: boolean;
  style: EditorStyle;
}

// Browsers commonly reject/clamp HTMLMediaElement.playbackRate above 16 (the
// preset chips go up to 32× for export-time speed). The displayed preview
// rate is capped here; the real factor still applies at export.
const MAX_PREVIEW_PLAYBACK_RATE = 16;

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
  const stageRef = useRef<HTMLDivElement>(null);
  // ScreenArc-style stage geometry: the backdrop canvas (cw×ch) is the
  // largest source-aspect rect that fits the stage — the same shape the
  // worker renders to — so the backdrop previews as a proportional border
  // around the video rather than filling the stage's letterbox dead space.
  // The pad-inset video frame is derived from it inline at render time.
  // Explicit pixel sizing also lets low-resolution sources upscale to fill
  // the frame (a max-w/max-h <video> never grows past its intrinsic size).
  const [stageCanvas, setStageCanvas] = useState<{ cw: number; ch: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const aspectNow = info?.aspect_ratio && info.aspect_ratio > 0 ? info.aspect_ratio : 16 / 9;
    const compute = () => {
      const sw = el.clientWidth;
      const sh = el.clientHeight;
      if (!sw || !sh) return;
      let cw = sw;
      let ch = cw / aspectNow;
      if (ch > sh) {
        ch = sh;
        cw = ch * aspectNow;
      }
      setStageCanvas({ cw, ch });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [info]);

  // ── EDL draft state (issue #256) ──────────────────────────────────────
  const [edits, setEdits] = useState<EditOp[]>([]);
  const [muted, setMuted] = useState(false); // whole-video remove-audio toggle (issue #258)
  const [style, setStyle] = useState<EditorStyle>(DEFAULT_STYLE); // ditto
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [skipCuts, setSkipCuts] = useState(true);
  const [undoDepth, setUndoDepth] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // ── Suggestions (issue #259) ────────────────────────────────────────────
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>('edits');
  const [suggestions, setSuggestions] = useState<EditorSuggestion[]>([]);
  const [hasAnalyzedSuggestions, setHasAnalyzedSuggestions] = useState(false);
  const [analyzingSuggestions, setAnalyzingSuggestions] = useState(false);
  const [analyzeSuggestionsError, setAnalyzeSuggestionsError] = useState<string | null>(null);
  // issue #262: non-fatal notice when the LLM pass failed but gap
  // suggestions still came back — distinct from analyzeSuggestionsError,
  // which means the whole analyze request failed.
  const [analyzeSuggestionsWarning, setAnalyzeSuggestionsWarning] = useState<string | null>(null);
  const [suggestionThreshold, setSuggestionThreshold] = useState(DEFAULT_SUGGESTION_THRESHOLD_S);
  const [transcriptStatus, setTranscriptStatus] = useState<string | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [generatingTranscript, setGeneratingTranscript] = useState(false);
  // Stale-poll guard (per CLAUDE.md pattern): only the poll started for the
  // currently-open video id is allowed to keep applying state updates.
  const transcriptPollVideoIdRef = useRef<string | null>(null);

  // Undo snapshots cover `edits`, `muted` and `style` (issue #258 —
  // remove-audio, widened by issue #263 to also cover the Style panel —
  // participate in the same capped-5 undo stack as cut/trim/speed edits).
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const justLoadedRef = useRef(true); // skips the autosave effect run caused by mount / draft load
  const mountedRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);

  // ── Export mp4 / Apply to video (issue #260, apply added by #261) ──────
  // Both render modes share one modal, one job table/worker, and one status
  // poll — `renderMode` picks which POST endpoint + modal copy applies.
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [renderMode, setRenderMode] = useState<'download' | 'apply'>('download');
  const [exportQuality, setExportQuality] = useState('source');
  const [exportStarting, setExportStarting] = useState(false);
  const [exportStartError, setExportStartError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<EditorExportStatus | null>(null);

  // Regenerate transcript/chapters prompt (issue #261) — triggered from the
  // apply modal's success panel, and mirrored as a persistent banner (below)
  // for a return visit where `info.pipeline_stale` is still true.
  const [regeneratingStale, setRegeneratingStale] = useState(false);
  const [regenerateStaleError, setRegenerateStaleError] = useState<string | null>(null);
  const [staleBannerDismissed, setStaleBannerDismissed] = useState(false);

  // Stale poll / stale closure guard (CLAUDE.md pattern) — must be set
  // before the interval starts, and re-checked after every await so a poll
  // started for one video never writes state after the id changes.
  const activeExportIdRef = useRef<string | null>(null);
  const exportPollRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeExportIdRef.current = null;
      if (exportPollRef.current) window.clearInterval(exportPollRef.current);
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
        // A non-empty saved suggestions list means a prior analyze pass ran
        // (and was persisted) — show it without requiring another click.
        const savedSuggestions = data.suggestions ?? [];
        setSuggestions(savedSuggestions);
        if (savedSuggestions.length > 0) setHasAnalyzedSuggestions(true);
      })
      .catch(() => {
        // No draft yet, or it failed to load — proceed with an empty one.
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Initial transcript status (issue #259) — drives the Suggestions tab's
  // gate between "Analyze" and "Generate transcript first".
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<AutoStatusResponse>(`/admin/videos/${id}/auto-status`)
      .then((data) => {
        if (cancelled) return;
        setTranscriptStatus(data.transcript_status ?? 'pending');
        setTranscriptError(data.transcript_error ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setTranscriptStatus('pending');
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
  // Snapshots capture `edits`, `muted` and `style` so the remove-audio
  // toggle and Style panel changes undo/redo alongside cut/trim/speed
  // edits, without changing the cap.
  const pushUndoSnapshot = useCallback(() => {
    const stack = undoStackRef.current;
    stack.push({ edits, muted, style });
    if (stack.length > UNDO_CAP) stack.shift();
    setUndoDepth(stack.length);
  }, [edits, muted, style]);

  const applyEdits = useCallback(
    (next: EditOp[]) => {
      pushUndoSnapshot();
      setEdits(next);
    },
    [pushUndoSnapshot],
  );

  const toggleMuted = useCallback(() => {
    pushUndoSnapshot();
    setMuted((m) => !m);
  }, [pushUndoSnapshot]);

  // Style panel (issue #263): preset pick / image upload / remove push an
  // undo snapshot first (mirrors toggleMuted) — mockup behavior is that
  // discrete style actions are undoable, while a slider drag (handled by
  // handleStyleLiveChange below) does not spam the stack on every tick.
  const handleStyleChange = useCallback(
    (next: EditorStyle) => {
      pushUndoSnapshot();
      setStyle(next);
    },
    [pushUndoSnapshot],
  );

  const handleStyleLiveChange = useCallback((next: EditorStyle) => {
    setStyle(next);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    const last = stack.pop();
    if (last === undefined) return;
    setUndoDepth(stack.length);
    setEdits(last.edits);
    setMuted(last.muted);
    setStyle(last.style);
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

  const handleCreateSpeed = useCallback(
    (start: number, end: number, factor: number) => {
      applyEdits([...edits, { id: genEditId(), type: 'speed', start_s: start, end_s: end, factor }]);
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

  // Change an existing speed region's factor in place (issue #276). Goes
  // through applyEdits so it is one undoable step and autosaves like any
  // other edit change; picking the current factor again is a no-op.
  const handleChangeSpeedFactor = useCallback(
    (editId: string, factor: number) => {
      const op = edits.find((e) => e.id === editId);
      if (!op || op.type !== 'speed' || (op.factor ?? 1) === factor) return;
      applyEdits(edits.map((e) => (e.id === editId ? { ...e, factor } : e)));
    },
    [applyEdits, edits],
  );

  // ── Suggestions (issue #259) ────────────────────────────────────────────

  const runAnalyzeSuggestions = useCallback(async () => {
    if (!id) return;
    setAnalyzingSuggestions(true);
    setAnalyzeSuggestionsError(null);
    setAnalyzeSuggestionsWarning(null);
    try {
      // Gap suggestions and the LLM skippable-span pass (issue #262) both run
      // server-side in this one request — the LLM call can take a while, so
      // this button shows a spinner ("Analyzing…") for the duration; a
      // generous but bounded server-side timeout (see admin_router.py) keeps
      // it well under the reverse-proxy's read timeout.
      const data = await api.post<AnalyzeSuggestionsResponse>(
        `/admin/videos/${id}/editor-suggestions/analyze`,
        { threshold_s: suggestionThreshold, include_llm: true },
      );
      if (!mountedRef.current) return;
      setTranscriptStatus(data.transcript_status);
      setTranscriptError(data.transcript_error ?? null);
      setSuggestions(data.suggestions);
      setHasAnalyzedSuggestions(true);
      setAnalyzeSuggestionsWarning(data.warning ?? null);
    } catch (err) {
      if (!mountedRef.current) return;
      setAnalyzeSuggestionsError(toApiError(err));
    } finally {
      if (mountedRef.current) setAnalyzingSuggestions(false);
    }
  }, [id, suggestionThreshold]);

  const handleAcceptSuggestion = useCallback(
    (s: EditorSuggestion) => {
      // The cut op is a normal EDL edit — it goes through applyEdits so it
      // participates in the same capped-5 undo as any other cut/trim/speed,
      // just tagged with its origin (issue #259).
      applyEdits([
        ...edits,
        { id: genEditId(), type: 'cut', start_s: s.start_s, end_s: s.end_s, source: 'suggestion' },
      ]);
      setSuggestions((cur) => cur.map((x) => (x.id === s.id ? { ...x, state: 'accepted' } : x)));
      if (id) {
        api.patch(`/admin/videos/${id}/editor-suggestions/${s.id}`, { state: 'accepted' }).catch(() => {
          // Best-effort — the local suggestion state already reflects the
          // accept, and the cut op itself is saved via the normal draft PUT.
        });
      }
    },
    [applyEdits, edits, id],
  );

  const handleIgnoreSuggestion = useCallback(
    (s: EditorSuggestion) => {
      setSuggestions((cur) => cur.map((x) => (x.id === s.id ? { ...x, state: 'ignored' } : x)));
      if (id) {
        api.patch(`/admin/videos/${id}/editor-suggestions/${s.id}`, { state: 'ignored' }).catch(() => {});
      }
    },
    [id],
  );

  // Stale-poll pattern (CLAUDE.md): guard against navigating away mid-poll.
  const pollTranscriptStatus = useCallback(
    (videoId: string) => {
      const poll = async () => {
        if (transcriptPollVideoIdRef.current !== videoId) return; // navigated away mid-poll
        try {
          const data = await api.get<AutoStatusResponse>(`/admin/videos/${videoId}/auto-status`);
          if (transcriptPollVideoIdRef.current !== videoId) return; // check again after await
          const status = data.transcript_status ?? 'pending';
          setTranscriptStatus(status);
          setTranscriptError(data.transcript_error ?? null);
          if (status === 'pending' || status === 'processing') {
            window.setTimeout(poll, TRANSCRIPT_POLL_MS);
          } else {
            setGeneratingTranscript(false);
          }
        } catch {
          if (transcriptPollVideoIdRef.current !== videoId) return;
          setGeneratingTranscript(false);
        }
      };
      poll();
    },
    [],
  );

  const handleGenerateTranscript = useCallback(async () => {
    if (!id) return;
    setGeneratingTranscript(true);
    setAnalyzeSuggestionsError(null);
    transcriptPollVideoIdRef.current = id; // must set before starting the poll
    try {
      await api.post(`/admin/videos/${id}/auto-process/retry`, { kind: 'transcript' });
      setTranscriptStatus('pending');
      pollTranscriptStatus(id);
    } catch (err) {
      setGeneratingTranscript(false);
      setAnalyzeSuggestionsError(toApiError(err));
    }
  }, [id, pollTranscriptStatus]);

  useEffect(() => {
    return () => {
      transcriptPollVideoIdRef.current = null;
    };
  }, []);

  const handleSelectSuggestion = useCallback(() => {
    setActiveInspectorTab('suggestions');
  }, []);

  const outputDuration = useMemo(() => estimateOutputDuration(edits, duration), [edits, duration]);

  // ── Export mp4 (issue #260) ─────────────────────────────────────────────
  // Quality options are aspect-aware, mirroring the backend's
  // export_quality_options_for_aspect() split at aspect_ratio > 1.5.
  const exportQualityOptions = useMemo<EditorExportQualityOption[]>(() => {
    const w = info?.source_width;
    const h = info?.source_height;
    const sourceLabel = w && h ? `Source (${w}×${h})` : 'Source';
    const aspect = info?.aspect_ratio && info.aspect_ratio > 0 ? info.aspect_ratio : w && h ? w / h : 16 / 9;
    if (aspect > 1.5) {
      return [
        { value: 'source', label: sourceLabel },
        { value: '1440p', label: '1440p (2560×1440)' },
        { value: '1080p', label: '1080p (1920×1080)' },
        { value: '720p', label: '720p (1280×720)' },
      ];
    }
    return [
      { value: 'source', label: sourceLabel },
      { value: '1080p', label: '1080p-class (1440×1080)' },
      { value: '720p', label: '720p-class (960×720)' },
    ];
  }, [info?.source_width, info?.source_height, info?.aspect_ratio]);

  // Keep the selected quality valid if the option list changes underneath it
  // (e.g. editor-info arrives after the modal was already opened once).
  useEffect(() => {
    if (!exportQualityOptions.some((o) => o.value === exportQuality)) {
      setExportQuality(exportQualityOptions[0]?.value ?? 'source');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportQualityOptions]);

  // Refetch bootstrap info + the (now-cleared) draft after a successful
  // apply — the worker swapped a new original.mp4 in, updated duration, and
  // cleared video_editor_drafts server-side, so the editor's local state
  // needs to catch up (issue #261).
  const refreshAfterApply = useCallback(async () => {
    if (!id) return;
    try {
      const freshInfo = await api.get<VideoEditorInfo>(`/admin/videos/${id}/editor-info`);
      if (activeExportIdRef.current !== id) return;
      setInfo(freshInfo);
      if (freshInfo.duration_s) setDuration(freshInfo.duration_s);
    } catch {
      // Best-effort — the modal's success panel already reflects the apply.
    }
    try {
      const freshDraft = await api.get<VideoEditorDraft>(`/admin/videos/${id}/editor-draft`);
      if (activeExportIdRef.current !== id) return;
      justLoadedRef.current = true; // this reset shouldn't trigger another autosave
      setEdits(freshDraft.edits ?? []);
      setMuted(!!freshDraft.muted);
      setStyle(freshDraft.style ?? DEFAULT_STYLE);
      const freshSuggestions = freshDraft.suggestions ?? [];
      setSuggestions(freshSuggestions);
      setHasAnalyzedSuggestions(freshSuggestions.length > 0);
      setSelectedEditId(null);
    } catch {
      // Best-effort.
    }
  }, [id]);

  const startExportPoll = useCallback(() => {
    if (!id) return;
    activeExportIdRef.current = id;
    if (exportPollRef.current) window.clearInterval(exportPollRef.current);
    const poll = async () => {
      if (activeExportIdRef.current !== id) {
        if (exportPollRef.current) window.clearInterval(exportPollRef.current);
        return;
      }
      try {
        const data = await api.get<EditorExportStatus>(`/admin/videos/${id}/editor-export/status`);
        if (activeExportIdRef.current !== id) return;
        setExportStatus(data);
        if (data.status !== 'queued' && data.status !== 'processing' && exportPollRef.current) {
          window.clearInterval(exportPollRef.current);
          exportPollRef.current = null;
          if (data.mode === 'apply' && data.status === 'done') refreshAfterApply();
        }
      } catch {
        // Transient poll failure — leave the interval running, next tick retries.
      }
    };
    exportPollRef.current = window.setInterval(poll, 2000);
    poll();
  }, [id, refreshAfterApply]);

  const openExportModal = useCallback(
    (mode: 'download' | 'apply') => {
      setRenderMode(mode);
      setExportStartError(null);
      setRegenerateStaleError(null);
      setExportModalOpen(true);
      if (!id) return;
      activeExportIdRef.current = id;
      api
        .get<EditorExportStatus>(`/admin/videos/${id}/editor-export/status`)
        .then((data) => {
          if (activeExportIdRef.current !== id) return;
          setExportStatus(data);
          if (data.status === 'queued' || data.status === 'processing') startExportPoll();
        })
        .catch(() => {
          // No job yet, or the fetch failed — the modal just starts from its idle state.
        });
    },
    [id, startExportPoll],
  );

  const handleStartExport = useCallback(async () => {
    if (!id) return;
    setExportStarting(true);
    setExportStartError(null);
    try {
      const endpoint = renderMode === 'apply' ? 'editor-apply' : 'editor-export';
      const job = await api.post<{ id: number; status: string; mode?: string; progress_pct: number; quality: string | null }>(
        `/admin/videos/${id}/${endpoint}`,
        renderMode === 'apply' ? undefined : { quality: exportQuality },
      );
      if (activeExportIdRef.current !== id) return;
      setExportStatus({
        id: job.id,
        status: job.status as EditorExportStatus['status'],
        mode: (job.mode as 'download' | 'apply' | undefined) ?? renderMode,
        progress_pct: job.progress_pct,
        quality: job.quality ?? (renderMode === 'apply' ? 'source' : exportQuality),
        error: null,
        download_available: false,
        output_filename: null,
      });
      startExportPoll();
    } catch (err) {
      if (activeExportIdRef.current !== id) return;
      setExportStartError(toApiError(err));
    } finally {
      if (activeExportIdRef.current === id) setExportStarting(false);
    }
  }, [id, renderMode, exportQuality, startExportPoll]);

  const handleRegenerateStale = useCallback(async () => {
    if (!id) return;
    setRegeneratingStale(true);
    setRegenerateStaleError(null);
    try {
      await api.post(`/admin/videos/${id}/regenerate-stale`);
      if (activeExportIdRef.current !== id) return;
      setInfo((prev) => (prev ? { ...prev, pipeline_stale: false } : prev));
      setExportModalOpen(false);
    } catch (err) {
      if (activeExportIdRef.current !== id) return;
      setRegenerateStaleError(toApiError(err));
    } finally {
      if (activeExportIdRef.current === id) setRegeneratingStale(false);
    }
  }, [id]);

  const exportDownloadUrl = id ? `${API_BASE}/admin/videos/${id}/editor-export/download` : null;

  // One-shot check on load so the header button (and its "Rendering… N%"
  // label) reflects a render already in flight from a previous visit —
  // resumes the poll automatically rather than waiting for the user to
  // reopen the modal.
  useEffect(() => {
    if (!id) return;
    activeExportIdRef.current = id;
    let cancelled = false;
    api
      .get<EditorExportStatus>(`/admin/videos/${id}/editor-export/status`)
      .then((data) => {
        if (cancelled || activeExportIdRef.current !== id) return;
        setExportStatus(data);
        if (data.mode) setRenderMode(data.mode);
        if (data.status === 'queued' || data.status === 'processing') startExportPoll();
      })
      .catch(() => {
        // No job yet — fine, header button stays in its idle state.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Belt-and-braces sync for the remove-audio toggle: React's `muted` prop on
  // <video> only reliably sets the DOM property on the initial render in
  // some browsers, so re-apply it directly via the ref on every change.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted, info]);

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
  // during playback, when the toggle is on. Speed regions (issue #258) are
  // evaluated afterwards, against the (possibly skip-adjusted) time, so a
  // skip that lands inside a speed region picks up its rate immediately.
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

    const speedOp = edits.find(
      (op) => op.type === 'speed' && op.factor && t >= op.start_s && t < op.end_s,
    );
    const targetRate = speedOp ? Math.min(MAX_PREVIEW_PLAYBACK_RATE, speedOp.factor as number) : 1;
    if (v.playbackRate !== targetRate) {
      try {
        v.playbackRate = targetRate;
      } catch {
        // Some browsers reject out-of-range rates outright — leave the
        // previous rate in place rather than throwing out of the handler.
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
            <button
              onClick={toggleMuted}
              title="Remove audio from the whole video (undoable)"
              aria-pressed={muted}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium border transition-colors shrink-0 mr-1 ${
                muted
                  ? 'border-[#F0564A]/60 bg-[#F0564A]/15 text-[#F0564A]'
                  : 'border-[#243043] bg-[#0F1520] text-[#96A2B8] hover:border-[#5C6880] hover:text-[#E8EDF6]'
              }`}
            >
              <span className="material-symbols-outlined text-base">
                {muted ? 'volume_off' : 'volume_up'}
              </span>
              Remove audio
            </button>
            {(() => {
              const applyActive =
                exportStatus?.mode === 'apply' &&
                (exportStatus.status === 'queued' || exportStatus.status === 'processing');
              const exportActive =
                (exportStatus?.mode ?? 'download') === 'download' &&
                (exportStatus?.status === 'queued' || exportStatus?.status === 'processing');
              return (
                <>
                  <button
                    onClick={() => openExportModal('apply')}
                    title={
                      applyActive
                        ? `Applying… ${exportStatus?.progress_pct}%`
                        : 'Render the edit list in place, replacing the video (source resolution)'
                    }
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium border border-[#243043] bg-[#0F1520] hover:border-[#5C6880] text-[#E8EDF6] shrink-0"
                  >
                    <span className="material-symbols-outlined text-base">published_with_changes</span>
                    {applyActive ? `Applying… ${exportStatus?.progress_pct}%` : 'Apply to video'}
                  </button>
                  <button
                    onClick={() => openExportModal('download')}
                    title={
                      exportActive
                        ? `Rendering… ${exportStatus?.progress_pct}%`
                        : 'Render the edit list to a downloadable mp4'
                    }
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium bg-primary hover:bg-blue-500 text-white shrink-0"
                  >
                    <span className="material-symbols-outlined text-base">movie</span>
                    {exportActive ? `Rendering… ${exportStatus?.progress_pct}%` : 'Export mp4'}
                  </button>
                </>
              );
            })()}
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

              {/* Stale transcript/chapters prompt (issue #261) — persists across
                  visits as long as info.pipeline_stale is true; "Later" only
                  collapses this banner locally, it never clears the flag. */}
              {info?.pipeline_stale && !staleBannerDismissed && (
                <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-200">
                  <span className="material-symbols-outlined text-base shrink-0">warning</span>
                  <span className="flex-1">
                    Timestamps changed — the transcript, captions and chapters no longer match the
                    edited video. Regenerate them?
                  </span>
                  {regenerateStaleError && (
                    <span className="text-red-300 text-xs shrink-0">{regenerateStaleError}</span>
                  )}
                  <button
                    onClick={() => setStaleBannerDismissed(true)}
                    className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border border-amber-500/40 hover:bg-amber-500/10"
                  >
                    Later
                  </button>
                  <button
                    onClick={handleRegenerateStale}
                    disabled={regeneratingStale}
                    className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
                  >
                    {regeneratingStale ? 'Queuing…' : 'Regenerate transcript & chapters'}
                  </button>
                </div>
              )}

              {/* Stage — backdrop + padded/rounded frame (issue #263). The
                  backdrop is always rendered (matching the mockup, whose
                  'None' preset is a flat black CSS value, not "no div") so
                  padding without a preset still shows *something* behind
                  the inset video. */}
              <div
                ref={stageRef}
                className="flex-1 min-h-0 rounded-lg border border-[#243043] bg-black overflow-hidden relative flex items-center justify-center"
              >
                {muted && (
                  <span className="absolute top-2.5 right-3 z-10 text-[11px] font-semibold tracking-[0.04em] text-[#F0564A] bg-[#0B0F17]/80 border border-[#F0564A] rounded-full px-2.5 py-1">
                    AUDIO REMOVED
                  </span>
                )}
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    width: stageCanvas ? `${stageCanvas.cw}px` : '100%',
                    height: stageCanvas ? `${stageCanvas.ch}px` : '100%',
                    background: style.image
                      ? `center/cover no-repeat url(${API_BASE}${style.image})`
                      : stylePresetCss(style.preset),
                  }}
                >
                  {info && (
                    <video
                      ref={videoRef}
                      src={`${API_BASE}${info.raw_url}`}
                      className="max-w-full max-h-full"
                      style={{
                        width: stageCanvas
                          ? `${stageCanvas.cw * (1 - (2 * style.pad_pct) / 100)}px`
                          : undefined,
                        height: stageCanvas
                          ? `${stageCanvas.ch * (1 - (2 * style.pad_pct) / 100)}px`
                          : undefined,
                        maxWidth: 'none',
                        maxHeight: 'none',
                        aspectRatio: String(aspect),
                        // Match the worker's radius scaling (radius_px is
                        // relative to the source height) so preview ≈ export.
                        borderRadius: `${
                          stageCanvas && info.source_height
                            ? style.radius_px * (stageCanvas.ch / info.source_height)
                            : style.radius_px
                        }px`,
                      }}
                      muted={muted}
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

        {editorReady && id && (
          <EditsPanel
            edits={edits}
            selectedEditId={selectedEditId}
            onSelect={setSelectedEditId}
            onDelete={handleDeleteEdit}
            onChangeSpeedFactor={handleChangeSpeedFactor}
            activeTab={activeInspectorTab}
            onTabChange={setActiveInspectorTab}
            videoId={id}
            style={style}
            onStyleChange={handleStyleChange}
            onStyleLiveChange={handleStyleLiveChange}
            suggestions={suggestions}
            hasAnalyzedSuggestions={hasAnalyzedSuggestions}
            analyzingSuggestions={analyzingSuggestions}
            analyzeSuggestionsError={analyzeSuggestionsError}
            analyzeSuggestionsWarning={analyzeSuggestionsWarning}
            suggestionThreshold={suggestionThreshold}
            onSuggestionThresholdChange={setSuggestionThreshold}
            onAnalyzeSuggestions={runAnalyzeSuggestions}
            transcriptStatus={transcriptStatus}
            transcriptError={transcriptError}
            generatingTranscript={generatingTranscript}
            onGenerateTranscript={handleGenerateTranscript}
            onAcceptSuggestion={handleAcceptSuggestion}
            onIgnoreSuggestion={handleIgnoreSuggestion}
          />
        )}
      </main>

      {editorReady && id && (
        <EditorTimeline
          videoId={id}
          duration={duration}
          currentTime={currentTime}
          edits={edits}
          selectedEditId={selectedEditId}
          onSeek={seekTo}
          onSelectEdit={setSelectedEditId}
          onCreateCut={handleCreateCut}
          onCreateTrim={handleCreateTrim}
          onCreateSpeed={handleCreateSpeed}
          onUpdateSpeed={handleChangeSpeedFactor}
          suggestions={suggestions}
          onSelectSuggestion={handleSelectSuggestion}
        />
      )}

      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        mode={renderMode}
        edits={edits}
        muted={muted}
        style={style}
        quality={exportQuality}
        onQualityChange={setExportQuality}
        qualityOptions={exportQualityOptions}
        status={exportStatus}
        starting={exportStarting}
        startError={exportStartError}
        onStart={handleStartExport}
        downloadUrl={exportDownloadUrl}
        pipelineStale={!!info?.pipeline_stale}
        onRegenerateStale={handleRegenerateStale}
        regeneratingStale={regeneratingStale}
        regenerateError={regenerateStaleError}
      />
    </div>
  );
};
