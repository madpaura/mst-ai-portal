import React, { useEffect, useRef } from 'react';
import { fmtClock } from './types';

interface EditPopoverProps {
  /** Viewport coordinates (from the mouseup that ended the drag-select). */
  clientX: number;
  clientY: number;
  rangeStart: number;
  rangeEnd: number;
  onCutOut: () => void;
  onTrimTo: () => void;
  onClose: () => void;
}

/**
 * Floating action popover shown after a drag-select on the timeline.
 *
 * Only "Cut out" / "Trim to" ship this slice. The action list is built from
 * a small config array precisely so a "Speed" entry can be appended later
 * (issue #256 spec) without restructuring this component — see `ACTIONS`.
 */
export const EditPopover: React.FC<EditPopoverProps> = ({
  clientX,
  clientY,
  rangeStart,
  rangeEnd,
  onCutOut,
  onTrimTo,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // Position is applied directly to the DOM node (not React state) so that
  // clamping the popover to the viewport, once we know its real rendered
  // size, doesn't trigger a second render.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, clientX - w / 2), window.innerWidth - w - 8);
    const top = Math.min(clientY + 10, window.innerHeight - h - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [clientX, clientY]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // Defer so the mouseup that opened the popover doesn't immediately close it.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDocMouseDown), 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onDocMouseDown);
      window.clearTimeout(t);
    };
  }, [onClose]);

  // Extension point: a `speed` entry (with a factor sub-menu, like the
  // mockup's chip row) can be appended here in a later slice without
  // changing the popover's layout or event wiring.
  const ACTIONS: Array<{ key: string; label: string; icon: string; className: string; onClick: () => void }> = [
    {
      key: 'cut',
      label: 'Cut out',
      icon: 'content_cut',
      className: 'text-[#F0564A] hover:bg-[#F0564A]/15 border-[#243043] hover:border-[#F0564A]/50',
      onClick: onCutOut,
    },
    {
      key: 'trim',
      label: 'Trim to',
      icon: 'crop',
      className: 'text-primary hover:bg-primary/15 border-[#243043] hover:border-primary/50',
      onClick: onTrimTo,
    },
  ];

  return (
    <div
      ref={ref}
      className="fixed z-20 bg-[#141B28] border border-[#243043] rounded-xl p-2 shadow-2xl"
      style={{ left: clientX, top: clientY + 10 }}
    >
      <div className="px-2 pt-1 pb-2 text-[11px] font-mono text-[#5C6880] tabular-nums">
        {fmtClock(rangeStart)} – {fmtClock(rangeEnd)}
      </div>
      <div className="flex gap-1.5">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={a.onClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${a.className}`}
          >
            <span className="material-symbols-outlined text-[15px]">{a.icon}</span>
            {a.label}
          </button>
        ))}
        <button
          onClick={onClose}
          aria-label="Cancel"
          className="flex items-center justify-center px-2.5 py-1.5 rounded-lg text-[#5C6880] hover:text-[#E8EDF6] hover:bg-[#0F1520]"
        >
          <span className="material-symbols-outlined text-[15px]">close</span>
        </button>
      </div>
    </div>
  );
};
