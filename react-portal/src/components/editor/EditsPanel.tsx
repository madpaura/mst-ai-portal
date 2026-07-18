import React from 'react';
import type { EditOp, EditorSuggestion } from './types';
import { fmtClock, opLabel } from './types';
import { SuggestionsPanel } from './SuggestionsPanel';

export type InspectorTab = 'edits' | 'suggestions';

interface EditsPanelProps {
  edits: EditOp[];
  selectedEditId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;

  // Tabs (issue #259 adds the Suggestions tab alongside Edits)
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;

  // Suggestions tab (issue #259)
  suggestions: EditorSuggestion[];
  hasAnalyzedSuggestions: boolean;
  analyzingSuggestions: boolean;
  analyzeSuggestionsError: string | null;
  suggestionThreshold: number;
  onSuggestionThresholdChange: (t: number) => void;
  onAnalyzeSuggestions: () => void;
  transcriptStatus: string | null;
  transcriptError: string | null;
  generatingTranscript: boolean;
  onGenerateTranscript: () => void;
  onAcceptSuggestion: (s: EditorSuggestion) => void;
  onIgnoreSuggestion: (s: EditorSuggestion) => void;
}

const SWATCH: Record<EditOp['type'], string> = {
  cut: '#F0564A',
  trim: 'rgb(37 140 244)',
  speed: '#A78BFA',
};

export const EditsPanel: React.FC<EditsPanelProps> = ({
  edits,
  selectedEditId,
  onSelect,
  onDelete,
  activeTab,
  onTabChange,
  suggestions,
  hasAnalyzedSuggestions,
  analyzingSuggestions,
  analyzeSuggestionsError,
  suggestionThreshold,
  onSuggestionThresholdChange,
  onAnalyzeSuggestions,
  transcriptStatus,
  transcriptError,
  generatingTranscript,
  onGenerateTranscript,
  onAcceptSuggestion,
  onIgnoreSuggestion,
}) => {
  const openSuggestionCount = suggestions.filter((s) => s.state === 'open').length;

  return (
    <aside className="w-[308px] shrink-0 bg-[#141B28] border-l border-[#243043] flex flex-col min-h-0">
      <div className="shrink-0 flex border-b border-[#243043]">
        {(
          [
            ['edits', 'Edits'],
            ['suggestions', `Suggestions${openSuggestionCount ? ` (${openSuggestionCount})` : ''}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            className={`flex-1 px-1 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'text-[#E8EDF6] border-primary'
                : 'text-[#96A2B8] border-transparent hover:text-[#E8EDF6]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5">
        {activeTab === 'edits' ? (
          edits.length === 0 ? (
            <div className="text-[12.5px] text-center leading-relaxed text-[#5C6880] px-3 py-6 border border-dashed border-[#243043] rounded-lg">
              No edits yet.
              <br />
              Drag on the timeline to select a region,
              <br />
              then choose Cut, Trim or Speed.
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
          )
        ) : (
          <SuggestionsPanel
            suggestions={suggestions}
            hasAnalyzed={hasAnalyzedSuggestions}
            analyzing={analyzingSuggestions}
            analyzeError={analyzeSuggestionsError}
            threshold={suggestionThreshold}
            onThresholdChange={onSuggestionThresholdChange}
            onAnalyze={onAnalyzeSuggestions}
            transcriptStatus={transcriptStatus}
            transcriptError={transcriptError}
            generatingTranscript={generatingTranscript}
            onGenerateTranscript={onGenerateTranscript}
            onAccept={onAcceptSuggestion}
            onIgnore={onIgnoreSuggestion}
          />
        )}
      </div>
    </aside>
  );
};
