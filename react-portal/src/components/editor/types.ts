// Shared types + helpers for the non-destructive video editor (issue #256).
//
// Mirrors the backend draft shape (api/video/schemas.py::VideoEditorDraftResponse):
//   { edits: [{ id, type: 'cut'|'trim'|'speed', start_s, end_s, factor? }], muted, style }
//
// Only `cut` and `trim` get UI in this slice. `speed` and `muted`/`style` are
// carried in the shape (and round-trip through the API) so later slices don't
// need another draft-shape migration.

export type EditOpType = 'cut' | 'trim' | 'speed';

export interface EditOp {
  id: string;
  type: EditOpType;
  start_s: number;
  end_s: number;
  factor?: number;
  /** Provenance tag (issue #259): 'suggestion' marks a cut created by
   * accepting a suggestion, purely informational for the UI. */
  source?: 'suggestion';
}

// ── Silence-gap suggestions (issue #259) ─────────────────────────────────
//
// Mirrors api/video/schemas.py::EditorSuggestion. `kind` is 'gap' this slice;
// issue #262 plugs an 'llm' kind (with a `reason`) into the same shape.

export type SuggestionKind = 'gap' | 'llm';
export type SuggestionState = 'open' | 'accepted' | 'ignored';

export interface EditorSuggestion {
  id: string;
  kind: SuggestionKind;
  start_s: number;
  end_s: number;
  gap_s?: number | null;
  reason?: string | null;
  state: SuggestionState;
}

export const DEFAULT_SUGGESTION_THRESHOLD_S = 2.0;

export function suggestionTagLabel(kind: SuggestionKind): string {
  return kind === 'gap' ? 'SILENCE' : 'LLM';
}

export function suggestionReason(s: EditorSuggestion): string {
  if (s.reason) return s.reason;
  if (s.kind === 'gap' && s.gap_s != null) return `Silence — ${s.gap_s}s gap between segments`;
  return 'Skippable section';
}

export interface EditorStyle {
  preset: string;
  pad_pct: number;
  radius_px: number;
}

export interface EditorDraft {
  edits: EditOp[];
  muted: boolean;
  style: EditorStyle;
}

export const DEFAULT_STYLE: EditorStyle = { preset: 'none', pad_pct: 0, radius_px: 0 };

export const DEFAULT_DRAFT: EditorDraft = { edits: [], muted: false, style: DEFAULT_STYLE };

// Sub-1.5s drags on the timeline are treated as seeks, not selections.
export const MIN_DRAG_SECONDS = 1.5;

// Product decision (issue #256): undo is capped at the last 5 actions.
export const UNDO_CAP = 5;

export function fmtClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function genEditId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Live output-duration estimate: source duration minus cut spans and trim
 * narrowing, with speed spans folded in (unused this slice, but the formula
 * stays correct if a `speed` op ever reaches the draft via the API). */
export function estimateOutputDuration(edits: EditOp[], sourceDuration: number): number {
  const trim = edits.find((e) => e.type === 'trim');
  const base = trim ? Math.max(0, trim.end_s - trim.start_s) : sourceDuration;
  const cutSeconds = edits
    .filter((e) => e.type === 'cut')
    .reduce((acc, e) => acc + Math.max(0, e.end_s - e.start_s), 0);
  const speedSaved = edits
    .filter((e) => e.type === 'speed' && e.factor)
    .reduce((acc, e) => acc + Math.max(0, e.end_s - e.start_s) * (1 - 1 / (e.factor as number)), 0);
  return Math.max(0, base - cutSeconds - speedSaved);
}

export function opLabel(op: EditOp): string {
  if (op.type === 'cut') return op.source === 'suggestion' ? 'Cut (suggestion)' : 'Cut out';
  if (op.type === 'trim') return 'Trim to';
  return `Speed ${op.factor ?? 1}×`;
}
