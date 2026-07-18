import React from 'react';
import type { EditOp, EditorStyle } from './types';
import { fmtClock, opLabel } from './types';

// Export mp4 confirm/progress modal (issue #260). Pure presentation — all
// state (quality selection, the POST to start a render, and the status
// poll) lives in AdminVideoEditor.tsx per the stale-poll pattern in
// CLAUDE.md. This component only renders whatever it's handed and reports
// user actions back via callbacks.

export interface EditorExportQualityOption {
  value: string;
  label: string;
}

export interface EditorExportStatus {
  id: number | null;
  status: 'none' | 'queued' | 'processing' | 'done' | 'error';
  progress_pct: number;
  quality: string | null;
  error: string | null;
  download_available: boolean;
  output_filename: string | null;
}

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
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
  downloadUrl: string | null;
}

const COLORS: Record<string, string> = {
  cut: '#F0564A',
  trim: '#3B82F6',
  speed: '#A78BFA',
};

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  onClose,
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
  downloadUrl,
}) => {
  if (!open) return null;

  const isActive = status?.status === 'queued' || status?.status === 'processing';
  const isDone = status?.status === 'done';
  const progressLabel =
    status?.status === 'queued' ? 'Queued — waiting for worker…' : 'Rendering export…';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isActive) onClose();
      }}
    >
      <div className="w-[440px] max-w-[92vw] rounded-2xl border border-[#243043] bg-[#141B28] p-6 text-[#E8EDF6]">
        <h2 className="m-0 mb-1 text-base font-semibold">Export mp4</h2>
        <p className="mb-4 text-[13px] text-[#96A2B8]">
          Renders the edit list to a downloadable mp4. The portal video is not modified.
        </p>

        {/* Edit-list summary */}
        <ul className="m-0 mb-4 list-none p-0">
          {edits.length === 0 && !muted && style.preset === 'none' && (
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
        </ul>

        {/* Quality picker + Start, hidden once a render is in flight */}
        {!isActive && (
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

        {status?.status === 'error' && !isActive && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">
            Render failed{status.error ? `: ${status.error}` : '.'}
          </div>
        )}

        {startError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">
            {startError}
          </div>
        )}

        {/* Download row */}
        {isDone && status?.download_available && downloadUrl && (
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

        <div className="flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#243043] bg-[#0F1520] px-3.5 py-1.5 text-[13px] font-medium hover:border-[#5C6880]"
          >
            {isActive ? 'Hide' : 'Cancel'}
          </button>
          {!isActive && (
            <button
              onClick={onStart}
              disabled={starting}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {starting ? 'Starting…' : isDone ? 'Render again' : 'Start render'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
