import React from 'react';
import type { EditOp } from './types';
import { fmtClock, opLabel } from './types';

interface EditsPanelProps {
  edits: EditOp[];
  selectedEditId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const SWATCH: Record<EditOp['type'], string> = {
  cut: '#F0564A',
  trim: 'rgb(37 140 244)',
  speed: '#A78BFA',
};

export const EditsPanel: React.FC<EditsPanelProps> = ({ edits, selectedEditId, onSelect, onDelete }) => {
  return (
    <aside className="w-[308px] shrink-0 bg-[#141B28] border-l border-[#243043] flex flex-col min-h-0">
      <div className="shrink-0 px-3.5 pt-3.5 pb-2">
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[#5C6880]">Edits</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 pb-3.5">
        {edits.length === 0 ? (
          <div className="text-[12.5px] text-center leading-relaxed text-[#5C6880] px-3 py-6 border border-dashed border-[#243043] rounded-lg">
            No edits yet.
            <br />
            Drag on the timeline to select a region,
            <br />
            then choose Cut or Trim.
          </div>
        ) : (
          edits.map((op) => {
            const selected = selectedEditId === op.id;
            return (
              <div
                key={op.id}
                onClick={() => onSelect(op.id)}
                className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg border mb-1.5 cursor-pointer transition-colors ${
                  selected ? 'border-primary bg-primary/10' : 'border-[#243043] bg-[#0F1520] hover:border-[#5C6880]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded shrink-0"
                  style={{ background: SWATCH[op.type] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{opLabel(op)}</div>
                  <div className="text-[11.5px] text-[#96A2B8] font-mono tabular-nums">
                    {fmtClock(op.start_s)} – {fmtClock(op.end_s)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(op.id);
                  }}
                  title="Delete edit"
                  aria-label="Delete edit"
                  className="text-[#5C6880] hover:text-[#F0564A] hover:bg-[#F0564A]/15 rounded-md px-1.5 py-1"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
