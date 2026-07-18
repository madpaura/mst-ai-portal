import React from 'react';
import type { EditorSuggestion } from './types';
import { fmtClock, suggestionTagLabel, suggestionReason } from './types';

interface SuggestionsPanelProps {
  suggestions: EditorSuggestion[];
  hasAnalyzed: boolean;
  analyzing: boolean;
  analyzeError: string | null;
  threshold: number;
  onThresholdChange: (t: number) => void;
  onAnalyze: () => void;

  /** null while the initial auto-status fetch is still in flight. */
  transcriptStatus: string | null;
  transcriptError: string | null;
  generatingTranscript: boolean;
  onGenerateTranscript: () => void;

  onAccept: (s: EditorSuggestion) => void;
  onIgnore: (s: EditorSuggestion) => void;
}

const TAG_CLASS: Record<EditorSuggestion['kind'], string> = {
  gap: 'text-[#F5A524] bg-[#F5A524]/15',
  llm: 'text-[#A78BFA] bg-[#A78BFA]/15',
};

/**
 * Suggestions tab body (issue #259): deterministic silence-gap suggestions
 * computed from the Whisper transcript. Structured so a second suggestion
 * source (LLM-flagged low-value spans, issue #262) can plug into the same
 * cards/list — suggestions already carry a `kind` and optional `reason`.
 */
export const SuggestionsPanel: React.FC<SuggestionsPanelProps> = ({
  suggestions,
  hasAnalyzed,
  analyzing,
  analyzeError,
  threshold,
  onThresholdChange,
  onAnalyze,
  transcriptStatus,
  transcriptError,
  generatingTranscript,
  onGenerateTranscript,
  onAccept,
  onIgnore,
}) => {
  const transcriptReady = transcriptStatus === 'ready';
  const transcriptInFlight = generatingTranscript || transcriptStatus === 'pending' || transcriptStatus === 'processing';
  const open = suggestions.filter((s) => s.state === 'open');
  const skippableSeconds = Math.round(open.reduce((acc, s) => acc + Math.max(0, s.end_s - s.start_s), 0));

  if (transcriptStatus === null) {
    return <div className="text-[12.5px] text-[#5C6880] px-1 py-2">Checking transcript…</div>;
  }

  if (!transcriptReady) {
    return (
      <div className="space-y-3">
        <div className="border border-dashed border-[#243043] rounded-lg px-3.5 py-4 text-center">
          <span className="material-symbols-outlined text-[#5C6880] text-2xl">subtitles_off</span>
          <p className="text-[12.5px] text-[#96A2B8] mt-2 leading-relaxed">
            Silence-gap suggestions need this video&apos;s transcript. Generate it first, then analyze.
          </p>
          {transcriptStatus === 'error' && transcriptError && (
            <p className="text-[11.5px] text-red-400 mt-1.5">{transcriptError}</p>
          )}
          {transcriptInFlight ? (
            <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-[#96A2B8]">
              <span className="w-3 h-3 rounded-full border-2 border-[#243043] border-t-primary animate-spin" />
              Generating transcript ({transcriptStatus ?? 'pending'})…
            </div>
          ) : (
            <button
              onClick={onGenerateTranscript}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-primary hover:bg-blue-500 text-white transition-colors"
            >
              <span className="material-symbols-outlined text-base">auto_awesome</span>
              Generate transcript
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[12px] text-[#5C6880]">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Transcript ready
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="sugg-threshold" className="text-[12px] text-[#96A2B8] shrink-0">
          Gap ≥
        </label>
        <input
          id="sugg-threshold"
          type="number"
          min={0.5}
          max={30}
          step={0.5}
          value={threshold}
          onChange={(e) => onThresholdChange(Math.max(0.5, Number(e.target.value) || 0.5))}
          className="w-16 px-2 py-1 rounded-md bg-[#0F1520] border border-[#243043] text-[12.5px] font-mono text-[#E8EDF6]"
        />
        <span className="text-[12px] text-[#5C6880]">sec</span>
      </div>

      <button
        onClick={onAnalyze}
        disabled={analyzing}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-primary hover:bg-blue-500 disabled:opacity-50 disabled:cursor-default text-white transition-colors"
      >
        <span className="material-symbols-outlined text-base">auto_awesome</span>
        {analyzing ? 'Analyzing…' : hasAnalyzed ? 'Re-analyze' : 'Analyze for skippable sections'}
      </button>
      {analyzeError && <p className="text-[11.5px] text-red-400">{analyzeError}</p>}

      {!hasAnalyzed ? (
        <p className="text-[12px] text-[#5C6880] leading-relaxed">
          Finds silent gaps from transcript timestamps. Nothing is cut until you accept a suggestion.
        </p>
      ) : (
        <>
          <div className="text-[12px] text-[#5C6880]">
            {open.length
              ? `${open.length} suggestion${open.length > 1 ? 's' : ''} · ~${skippableSeconds}s skippable`
              : 'All suggestions reviewed'}
          </div>
          <div className="space-y-2">
            {open.map((s) => (
              <div key={s.id} className="border border-[#243043] bg-[#0F1520] rounded-lg px-2.5 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[10px] font-bold tracking-[0.06em] px-1.5 py-0.5 rounded-full ${TAG_CLASS[s.kind]}`}
                  >
                    {suggestionTagLabel(s.kind)}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-[#5C6880]">
                    {fmtClock(s.start_s)} – {fmtClock(s.end_s)}
                  </span>
                </div>
                <div className="text-[12.5px] text-[#96A2B8] mb-2">{suggestionReason(s)}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAccept(s)}
                    className="flex-1 py-1.5 rounded-md text-[12px] font-semibold border border-[#F0564A]/45 text-[#F0564A] hover:bg-[#F0564A]/15 transition-colors"
                  >
                    ✂ Cut this
                  </button>
                  <button
                    onClick={() => onIgnore(s)}
                    className="flex-1 py-1.5 rounded-md text-[12px] font-semibold border border-[#243043] text-[#96A2B8] hover:bg-[#141B28] transition-colors"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
