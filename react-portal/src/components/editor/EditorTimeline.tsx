import React, { useMemo, useRef, useState } from 'react';
import { VideoTrackRow } from './VideoTrackRow';
import { EditPopover } from './EditPopover';
import type { EditOp, EditorSuggestion } from './types';
import { MIN_DRAG_SECONDS, fmtClock } from './types';

const RULER_H = 22;
const TRACK_H = 56;
const CUT_LANE_H = 30;
const SPEED_LANE_H = 30;
const SUGG_LANE_H = 30;
const LANES_H = TRACK_H + CUT_LANE_H + SPEED_LANE_H + SUGG_LANE_H;

const NICE_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

function niceStep(raw: number): number {
  for (const s of NICE_STEPS) if (s >= raw) return s;
  return NICE_STEPS[NICE_STEPS.length - 1];
}

interface EditorTimelineProps {
  videoId: string;
  duration: number;
  currentTime: number;
  edits: EditOp[];
  selectedEditId: string | null;
  onSeek: (t: number) => void;
  onSelectEdit: (id: string | null) => void;
  onCreateCut: (start: number, end: number) => void;
  onCreateTrim: (start: number, end: number) => void;
  onCreateSpeed: (start: number, end: number, factor: number) => void;
  /** Open suggestions (issue #259) rendered on a dashed amber lane below Speed. */
  suggestions: EditorSuggestion[];
  onSelectSuggestion: (id: string) => void;
}

interface DragRange {
  start: number;
  end: number;
}

interface PendingSelection extends DragRange {
  clientX: number;
  clientY: number;
}

/**
 * Bottom timeline zone: time ruler (click to seek), a video track row
 * (placeholder — see VideoTrackRow), and a cut lane. Drag-selecting a range
 * opens a floating popover offering Cut out / Trim to. Sub-1.5s drags are
 * treated as seeks.
 */
export const EditorTimeline: React.FC<EditorTimelineProps> = ({
  videoId,
  duration,
  currentTime,
  edits,
  selectedEditId,
  onSeek,
  onSelectEdit,
  onCreateCut,
  onCreateTrim,
  onCreateSpeed,
  suggestions,
  onSelectSuggestion,
}) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ startT: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dragPreview, setDragPreview] = useState<DragRange | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);

  const trim = useMemo(() => edits.find((e) => e.type === 'trim'), [edits]);
  const cuts = useMemo(() => edits.filter((e) => e.type === 'cut'), [edits]);
  const speeds = useMemo(() => edits.filter((e) => e.type === 'speed'), [edits]);
  const openSuggestions = useMemo(() => suggestions.filter((s) => s.state === 'open'), [suggestions]);

  const pctOf = (t: number) => (duration > 0 ? `${Math.min(100, Math.max(0, (t / duration) * 100))}%` : '0%');
  const widthPct = (s: number, e: number) =>
    duration > 0 ? `${Math.max(0, ((e - s) / duration) * 100)}%` : '0%';

  const timeAtClientX = (clientX: number): number => {
    const el = innerRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const px = clientX - rect.left;
    return Math.max(0, Math.min(duration, (px / rect.width) * duration));
  };

  const majorStep = duration > 0 ? niceStep(duration / (10 * zoom)) : 60;
  const minorStep = Math.max(1, majorStep / 2);

  const ticks = useMemo(() => {
    if (duration <= 0) return [] as { t: number; major: boolean }[];
    const out: { t: number; major: boolean }[] = [];
    for (let t = 0; t <= duration; t += minorStep) {
      out.push({ t, major: Math.abs((t / majorStep) % 1) < 0.001 });
    }
    return out;
  }, [duration, majorStep, minorStep]);

  const handleDragAreaMouseDown = (e: React.MouseEvent) => {
    if (duration <= 0 || e.button !== 0) return;
    setPending(null);
    const startT = timeAtClientX(e.clientX);
    draggingRef.current = { startT };
    setDragPreview({ start: startT, end: startT });

    const onMove = (ev: MouseEvent) => {
      const t = timeAtClientX(ev.clientX);
      const s0 = draggingRef.current?.startT ?? t;
      setDragPreview({ start: Math.min(s0, t), end: Math.max(s0, t) });
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const t = timeAtClientX(ev.clientX);
      const s0 = draggingRef.current?.startT ?? t;
      const s = Math.min(s0, t);
      const en = Math.max(s0, t);
      draggingRef.current = null;
      setDragPreview(null);
      if (en - s < MIN_DRAG_SECONDS) {
        onSeek(t);
        return;
      }
      setPending({ start: s, end: en, clientX: ev.clientX, clientY: ev.clientY });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="shrink-0 h-[246px] bg-[#141B28] border-t border-[#243043] flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 h-[38px] flex items-center gap-3 px-3.5 border-b border-[#243043]">
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[#5C6880]">Timeline</span>
        <span className="text-xs text-[#5C6880]">drag to select · click a region to inspect · Ctrl+Z undo</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setZoom((z) => Math.max(1, z / 2))}
            aria-label="Zoom out"
            className="w-[26px] h-[26px] rounded-md text-[#96A2B8] hover:bg-[#0F1520] hover:text-[#E8EDF6] text-[15px] flex items-center justify-center"
          >
            −
          </button>
          <span className="font-mono text-[11px] text-[#5C6880] w-[30px] text-center">{zoom}×</span>
          <button
            onClick={() => setZoom((z) => Math.min(8, z * 2))}
            aria-label="Zoom in"
            className="w-[26px] h-[26px] rounded-md text-[#96A2B8] hover:bg-[#0F1520] hover:text-[#E8EDF6] text-[15px] flex items-center justify-center"
          >
            +
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Lane labels */}
        <div className="shrink-0 w-[92px] border-r border-[#243043]" style={{ paddingTop: RULER_H }}>
          <div
            className="flex items-center pl-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-[#5C6880]"
            style={{ height: TRACK_H }}
          >
            Video
          </div>
          <div
            className="flex items-center pl-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-[#F0564A]"
            style={{ height: CUT_LANE_H }}
          >
            Cut
          </div>
          <div
            className="flex items-center pl-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-[#A78BFA]"
            style={{ height: SPEED_LANE_H }}
          >
            Speed
          </div>
          <div
            className="flex items-center pl-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-[#F5A524]"
            style={{ height: SUGG_LANE_H }}
          >
            Suggest
          </div>
        </div>

        {/* Scrollable timeline */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden relative">
          <div ref={innerRef} className="relative h-full" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
            {/* Ruler */}
            <div
              className="relative border-b border-[#243043] cursor-pointer"
              style={{ height: RULER_H }}
              onClick={(e) => onSeek(timeAtClientX(e.clientX))}
            >
              {ticks.map(({ t, major }) => (
                <React.Fragment key={t}>
                  <span
                    className={`absolute bottom-0 w-px ${major ? 'bg-[#5C6880] h-2.5' : 'bg-[#243043] h-1.5'}`}
                    style={{ left: pctOf(t) }}
                  />
                  {major && (
                    <span
                      className="absolute bottom-2 translate-x-1 font-mono text-[9.5px] text-[#5C6880]"
                      style={{ left: pctOf(t) }}
                    >
                      {fmtClock(t)}
                    </span>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Video track — filmstrip sprite (issue #257) */}
            <VideoTrackRow videoId={videoId} duration={duration} />

            {/* Cut lane background */}
            <div className="border-t border-[#243043]" style={{ height: CUT_LANE_H }} />

            {/* Speed lane background */}
            <div className="border-t border-[#243043]" style={{ height: SPEED_LANE_H }} />

            {/* Suggestions lane background (issue #259) */}
            <div className="border-t border-[#243043]" style={{ height: SUGG_LANE_H }} />

            {/* Trim dim overlay — dims everything outside the kept range */}
            {trim && (
              <>
                <div
                  className="absolute pointer-events-none bg-[#0B0F17]/75 border-r-2 border-primary"
                  style={{ top: RULER_H, height: LANES_H, left: 0, width: pctOf(trim.start_s) }}
                />
                <div
                  className="absolute pointer-events-none bg-[#0B0F17]/75 border-l-2 border-primary"
                  style={{ top: RULER_H, height: LANES_H, left: pctOf(trim.end_s), right: 0 }}
                />
              </>
            )}

            {/* Drag-select capture layer (regions render above it and stop
                propagation on mousedown so clicking a region selects it
                instead of starting a new drag). */}
            <div
              className="absolute cursor-crosshair"
              style={{ top: RULER_H, height: LANES_H, left: 0, right: 0 }}
              onMouseDown={handleDragAreaMouseDown}
            />

            {/* Cut regions */}
            {cuts.map((op) => (
              <div
                key={op.id}
                data-region
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdit(op.id);
                }}
                title={`${fmtClock(op.start_s)} – ${fmtClock(op.end_s)}`}
                className={`absolute rounded-md border flex items-center justify-center text-[10.5px] font-semibold cursor-pointer overflow-hidden whitespace-nowrap bg-[#F0564A]/20 border-[#F0564A] text-[#F0564A] ${
                  selectedEditId === op.id ? 'ring-2 ring-primary' : ''
                }`}
                style={{
                  top: RULER_H + TRACK_H + 4,
                  height: CUT_LANE_H - 8,
                  left: pctOf(op.start_s),
                  width: widthPct(op.start_s, op.end_s),
                }}
              >
                ✂
              </div>
            ))}

            {/* Speed regions */}
            {speeds.map((op) => (
              <div
                key={op.id}
                data-region
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdit(op.id);
                }}
                title={`${fmtClock(op.start_s)} – ${fmtClock(op.end_s)} · ${op.factor ?? 1}×`}
                className={`absolute rounded-md border flex items-center justify-center text-[10.5px] font-semibold cursor-pointer overflow-hidden whitespace-nowrap bg-[#A78BFA]/20 border-[#A78BFA] text-[#A78BFA] ${
                  selectedEditId === op.id ? 'ring-2 ring-primary' : ''
                }`}
                style={{
                  top: RULER_H + TRACK_H + CUT_LANE_H + 4,
                  height: SPEED_LANE_H - 8,
                  left: pctOf(op.start_s),
                  width: widthPct(op.start_s, op.end_s),
                }}
              >
                {op.factor ?? 1}×
              </div>
            ))}

            {/* Suggestion regions (issue #259) — dashed outline, distinct from
                committed edit ops; clicking one switches the side panel to
                the Suggestions tab rather than opening the cut/trim popover. */}
            {openSuggestions.map((s) => (
              <div
                key={s.id}
                data-region
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSuggestion(s.id);
                }}
                title={`${fmtClock(s.start_s)} – ${fmtClock(s.end_s)} · ${s.kind === 'gap' ? 'Silence' : 'Suggestion'}`}
                className="absolute rounded-md border border-dashed flex items-center justify-center text-[10.5px] font-semibold cursor-pointer overflow-hidden whitespace-nowrap bg-[#F5A524]/15 border-[#F5A524] text-[#F5A524]"
                style={{
                  top: RULER_H + TRACK_H + CUT_LANE_H + SPEED_LANE_H + 4,
                  height: SUGG_LANE_H - 8,
                  left: pctOf(s.start_s),
                  width: widthPct(s.start_s, s.end_s),
                }}
              >
                {s.kind === 'gap' ? '∅' : '✨'}
              </div>
            ))}

            {/* Drag preview */}
            {dragPreview && (
              <div
                className="absolute pointer-events-none bg-primary/15 border-l-2 border-r-2 border-primary"
                style={{
                  top: RULER_H,
                  height: LANES_H,
                  left: pctOf(dragPreview.start),
                  width: widthPct(dragPreview.start, dragPreview.end),
                }}
              />
            )}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none z-[6]"
              style={{ left: pctOf(currentTime) }}
            />
          </div>
        </div>
      </div>

      {pending && (
        <EditPopover
          clientX={pending.clientX}
          clientY={pending.clientY}
          rangeStart={pending.start}
          rangeEnd={pending.end}
          onCutOut={() => {
            onCreateCut(pending.start, pending.end);
            setPending(null);
          }}
          onTrimTo={() => {
            onCreateTrim(pending.start, pending.end);
            setPending(null);
          }}
          onSpeed={(factor) => {
            onCreateSpeed(pending.start, pending.end, factor);
            setPending(null);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
};
