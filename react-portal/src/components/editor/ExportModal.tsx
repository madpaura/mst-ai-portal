import React from 'react';
import type { EditOp, EditorStyle } from './types';
import { fmtClock, opLabel } from './types';
import { stylePresetName } from './stylePresets';

// Export mp4 / Apply to video confirm/progress modal (issue #260, extended
// for apply by issue #261). Pure presentation — all state (quality
// selection, the POST to start a render, and the status poll) lives in
// AdminVideoEditor.tsx per the stale-poll pattern in CLAUDE.md. This
// component only renders whatever it's handed and reports user actions back
// via callbacks. `mode` picks between the two render flows that share this
// one modal, mirroring the shared job table/worker/status-endpoint on the
// backend — 'apply' hides the quality picker (source resolution only) and,
// once done, offers the regenerate-transcript-and-chapters prompt instead
// of a download link.

export interface EditorExportQualityOption {
  value: string;
  label: string;
}

export interface EditorExportStatus {
  id: number | null;
  status: 'none' | 'queued' | 'processing' | 'done' | 'error' | 'cancelled';
  mode?: 'download' | 'apply';
  progress_pct: number;
  quality: string | null;
  error: string | null;
  download_available: boolean;
  output_filename: string | null;
}

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'download' | 'apply';
  edits: EditOp[];
  muted: boolean;
  style: EditorStyle;
  quality: string;
  onQualityChange: (quality: string) => void;
  qualityOptions: EditorExportQualityOption[];
  status: EditorExportStatus | null;
  starting: boolean;
  startError: string | null;
  onStart: () => void;
  // Cancels the in-flight render (export or apply) — the worker terminates
  // ffmpeg within ~1s of the job being marked 'cancelled'. Distinct from
  // onClose/"Hide", which just dismisses the modal and leaves the render
  // running in the background.
  onCancel?: () => void;
  cancelling?: boolean;
  cancelError?: string | null;
  downloadUrl: string | null;
  // Apply-only (issue #261): whether the freshly-reloaded video info still
  // shows pipeline_stale=true after the apply completed (there's nothing to
  // regenerate if the video never had a transcript/chapters to begin with).
  pipelineStale?: boolean;
  onRegenerateStale?: () => void;
  regeneratingStale?: boolean;
  regenerateError?: string | null;
}

const COLORS: Record<string, string> = {
  cut: '#F0564A',
  trim: '#3B82F6',
  speed: '#A78BFA',
};

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  onClose,
  mode,
  edits,
  muted,
  style,
  quality,
  onQualityChange,
  qualityOptions,
  status,
  starting,
  startError,
  onStart,
  onCancel,
  cancelling = false,
  cancelError = null,
  downloadUrl,
  pipelineStale = false,
  onRegenerateStale,
  regeneratingStale = false,
  regenerateError = null,
}) => {
  if (!open) return null;

  // Mirrors the worker's style_is_active() (issue #263): 'none' preset with
  // padding/radius already nonzero still renders a (black) backdrop, so it
  // counts as "styling active" for the summary too.
  const styleActive = style.preset !== 'none' || !!style.image || style.pad_pct > 0 || style.radius_px > 0;

  const isApply = mode === 'apply';
  // status is "latest render job for this video, of either mode" (the two
  // flows share one job table/status endpoint) — a completed download export
  // must never be read as a completed apply, or vice versa. Only one render
  // can be in flight at a time, so an active job always belongs to whichever
  // mode is currently open, but a *finished* job can easily be stale for the
  // mode showing right now (this was the bug: opening Apply right after a
  // download export showed a fake "Applied" success with no apply ever run).
  const statusMatchesMode = status?.mode === mode;
  const isActive = statusMatchesMode && (status?.status === 'queued' || status?.status === 'processing');
  const isDone = statusMatchesMode && status?.status === 'done';
  const isCancelled = statusMatchesMode && status?.status === 'cancelled';
  const progressLabel =
    status?.status === 'queued'
      ? 'Queued — waiting for worker…'
      : isApply
        ? 'Rendering on worker…'
        : 'Rendering export…';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isActive) onClose();
      }}
    >
      <div className="w-[440px] max-w-[92vw] rounded-2xl border border-[#243043] bg-[#141B28] p-6 text-[#E8EDF6]">
        <h2 className="m-0 mb-1 text-base font-semibold">{isApply ? 'Apply to video' : 'Export mp4'}</h2>
        <p className="mb-4 text-[13px] text-[#96A2B8]">
          {isApply
            ? 'Renders the edit list into a new original.mp4 (the old file is backed up), then queues a re-transcode. This replaces the published video.'
            : 'Renders the edit list to a downloadable mp4. The portal video is not modified.'}
        </p>

        {/* Edit-list summary */}
        <ul className="m-0 mb-4 list-none p-0">
          {edits.length === 0 && !muted && !styleActive && (
            <li className="py-1.5 text-[13px] text-[#96A2B8] border-b border-[#243043]">
              No edits — render would be a plain copy.
            </li>
          )}
          {edits.map((op) => (
            <li
              key={op.id}
              className="flex items-center gap-2 py-1.5 text-[13px] text-[#96A2B8] border-b border-[#243043]"
            >
              <span
                className="inline-block h-[9px] w-[9px] rounded-[3px] shrink-0"
                style={{ background: COLORS[op.type] }}
              />
              <span className="truncate">{opLabel(op)}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-[#5C6880]">
                {fmtClock(op.start_s)} – {fmtClock(op.end_s)}
              </span>
            </li>
          ))}
          {muted && (
            <li className="flex items-center gap-2 py-1.5 text-[13px] text-[#96A2B8] border-b border-[#243043]">
              <span className="inline-block h-[9px] w-[9px] rounded-[3px] shrink-0 bg-[#F0564A]" />
              Remove audio track
              <span className="ml-auto shrink-0 font-mono text-[11px] text-[#5C6880]">whole video</span>
            </li>
          )}
          {styleActive && (
            <li className="flex items-center gap-2 py-1.5 text-[13px] text-[#96A2B8] border-b border-[#243043]">
              <span className="inline-block h-[9px] w-[9px] rounded-[3px] shrink-0 bg-primary" />
              <span className="truncate">
                Background {style.image ? '"Custom image"' : `"${stylePresetName(style.preset)}"`} · pad{' '}
                {style.pad_pct}% · corners {style.radius_px}px
              </span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-[#5C6880]">whole video</span>
            </li>
          )}
        </ul>

        {/* Quality picker + Start, hidden once a render is in flight — Apply
            always renders at source resolution, so it has no quality picker. */}
        {!isActive && !isApply && (
          <div className="mb-4 flex items-center gap-2.5">
            <label htmlFor="export-quality" className="text-[13px] text-[#96A2B8]">
              Export quality
            </label>
            <select
              id="export-quality"
              value={quality}
              onChange={(e) => onQualityChange(e.target.value)}
              className="rounded-md border border-[#243043] bg-[#0F1520] px-2 py-1 text-[12px] text-[#E8EDF6]"
            >
              {qualityOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Progress */}
        {isActive && (
          <div className="mb-4">
            <div className="mb-1.5 mt-1 h-2 overflow-hidden rounded-full bg-[#0F1520]">
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${status?.progress_pct ?? 0}%` }}
              />
            </div>
            <div className="flex justify-between text-[12px] text-[#96A2B8]">
              <span>{progressLabel}</span>
              <span className="font-mono tabular-nums">{status?.progress_pct ?? 0}%</span>
            </div>
          </div>
        )}

        {statusMatchesMode && status?.status === 'error' && !isActive && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">
            Render failed{status.error ? `: ${status.error}` : '.'}
          </div>
        )}

        {isCancelled && (
          <div className="mb-4 rounded-lg border border-[#243043] bg-[#0F1520] px-3.5 py-2.5 text-[13px] text-[#96A2B8]">
            Render cancelled.
          </div>
        )}

        {startError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">
            {startError}
          </div>
        )}

        {cancelError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">
            {cancelError}
          </div>
        )}

        {/* Download row — download mode only; apply has no standalone file */}
        {isDone && !isApply && status?.download_available && downloadUrl && (
          <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-[#243043] bg-[#0F1520] px-3.5 py-2.5 text-[13px]">
            <span>📦</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12px]">
                {status.output_filename ?? 'export.mp4'}
              </div>
              <div className="text-[12px] text-[#5C6880]">
                {status.quality ? `${status.quality} · ` : ''}H.264/AAC
              </div>
            </div>
            <a
              href={downloadUrl}
              className="shrink-0 font-semibold text-primary no-underline hover:underline"
            >
              Download
            </a>
          </div>
        )}

        {/* Apply success panel (issue #261) — cuts/speed edits shift
            downstream timestamps, so a stale transcript/chapters prompt
            replaces the download row once the swap into original.mp4 is
            done. Nothing regenerates without an explicit click here. */}
        {isDone && isApply && (
          <>
            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-[13px] text-emerald-300">
              <span className="material-symbols-outlined text-base">check_circle</span>
              Applied — the video has been updated and a re-transcode is queued.
            </div>
            {pipelineStale && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-200">
                <b>Timestamps changed.</b> The transcript, captions and chapters no longer
                match the edited video. Regenerate them now?
              </div>
            )}
            {regenerateError && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">
                {regenerateError}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2.5">
          {isDone && isApply ? (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-[#243043] bg-[#0F1520] px-3.5 py-1.5 text-[13px] font-medium hover:border-[#5C6880]"
              >
                {pipelineStale ? 'Later' : 'Done'}
              </button>
              {pipelineStale && (
                <button
                  onClick={onRegenerateStale}
                  disabled={regeneratingStale}
                  className="rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {regeneratingStale ? 'Queuing…' : 'Regenerate transcript & chapters'}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-[#243043] bg-[#0F1520] px-3.5 py-1.5 text-[13px] font-medium hover:border-[#5C6880]"
              >
                {isActive ? 'Hide' : 'Close'}
              </button>
              {isActive && onCancel && (
                <button
                  onClick={onCancel}
                  disabled={cancelling}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-1.5 text-[13px] font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {cancelling ? 'Cancelling…' : 'Cancel render'}
                </button>
              )}
              {!isActive && (
                <button
                  onClick={onStart}
                  disabled={starting}
                  className="rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {starting ? 'Starting…' : isDone ? 'Render again' : 'Start render'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
