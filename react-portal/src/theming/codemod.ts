// ─────────────────────────────────────────────────────────────────────────────
// Theming codemod — pure className migration engine (PRD #150 / slice #152)
//
// `migrateClassName(input)` rewrites a component's className string from raw
// Tailwind palette classes + hand-written `dark:` pairs to the semantic tokens
// established in slice #151 (see THEMING.md / index.css / tailwind.config.js).
//
// Design goals (phase 1 = PIXEL-IDENTICAL):
//   • Collapse known symmetric light+dark PAIRS to a single token.
//   • Migrate a BARE singleton only when its value is the exact canonical light
//     value of a token AND that mapping is provably context-free safe.
//   • Leave OFF-CANONICAL outliers (e.g. `text-slate-600`, `bg-slate-100`) raw.
//   • Honour an ALWAYS-DARK deny-list: if the className contains an intentional
//     dark surface marker (`bg-slate-900`, `bg-black`, …), skip colour migration
//     of that whole string (those neon/text colours are tuned for dark and must
//     stay raw).
//   • Never duplicate a class; preserve unknown classes and ordering as far as
//     practical; idempotent (running twice == running once).
//
// The MAPPING TABLE below is the canonical, reviewable spec. Both the table and
// the function are exported so tests and tooling can introspect them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A paired (symmetric light+dark) migration rule. `light` and `dark` are the two
 * raw classes (sans any variant prefix) that, when both present in a className
 * string under the SAME variant prefix, collapse to `token`.
 *
 * Examples (prefix = ""):  light:`text-slate-900` dark:`text-slate-100` → `text-text-strong`
 *          (prefix = "hover:"): `hover:bg-slate-50` + `dark:hover:bg-slate-800` → `hover:bg-surface-muted`
 */
export interface PairedRule {
    /** raw class used in light mode (no variant prefix) */
    light: string;
    /** raw class used in dark mode (no variant prefix, i.e. the part after `dark:`) */
    dark: string;
    /** semantic token class the pair collapses to (no variant prefix) */
    token: string;
}

/**
 * A multi-class paired rule: badge tints carry a fill AND a foreground that must
 * be matched together. All `light` classes plus all `dark` classes (each `dark`
 * class prefixed with `dark:`) must be present; they collapse to `tokens`.
 *
 * e.g. `bg-red-500/10 text-red-600 dark:text-red-400` → `bg-danger-subtle text-danger`
 */
export interface GroupRule {
    /** raw classes present in light mode (no variant prefix) */
    light: string[];
    /** raw classes present only under `dark:` (no variant prefix) */
    dark: string[];
    /** semantic token classes the group collapses to (no variant prefix) */
    tokens: string[];
}

/**
 * A bare-singleton rule: a single raw class that maps to a token on EXACT value
 * match, safely and context-free. Kept deliberately tiny — most bare slate
 * classes are ambiguous (a `bg-white` could be a card surface or a deliberate
 * always-white chip) so they are NOT in this table.
 */
export interface BareRule {
    /** raw class (no variant prefix) */
    raw: string;
    /** semantic token class (no variant prefix) */
    token: string;
}

// ── Always-dark deny-list ────────────────────────────────────────────────────
// If any of these bare bg markers appears in a className string, the string is an
// intentional always-dark surface (code block, terminal, hero) — skip ALL colour
// migration for that string. Variant-prefixed forms are matched too.
export const ALWAYS_DARK_MARKERS: readonly string[] = [
    'bg-slate-900',
    'bg-slate-950',
    'bg-gray-900',
    'bg-gray-950',
    'bg-zinc-900',
    'bg-neutral-900',
    'bg-black',
] as const;

// ── Paired (symmetric) rules ─────────────────────────────────────────────────
// Each entry: a light raw class + a dark raw class (the part after `dark:`) that
// collapse to one token. Variant prefixes (hover:, focus:, group-hover:, etc.)
// are applied generically at match time — see PREFIXES.
// PIXEL-IDENTITY NOTE. Every rule here was verified so that BOTH its light and
// dark token values exactly equal the raw classes they replace (phase-1 mandate).
// Two seemingly-obvious mappings are DELIBERATELY EXCLUDED because they are NOT
// pixel-identical — see "Deliberate coverage boundaries" at the bottom of this
// file:
//   • `bg-white dark:bg-slate-900` → `bg-surface`  (surface-dark is #131a22, not
//     slate-900 #0f172a — would shift dark card backgrounds).
//   • state badge tints `bg-<c>-500/10 text-<c>-600 dark:text-<c>-400` →
//     `bg-<c>-subtle text-<c>` (the `-subtle` rgba fills match, but the token
//     foreground is the -700 legibility shade, not the raw -600/-400 — would
//     shift badge text colour).
export const PAIRED_RULES: readonly PairedRule[] = [
    // surfaces
    { light: 'bg-slate-50', dark: 'bg-slate-800', token: 'bg-surface-muted' },
    // text (4-rank hierarchy)
    { light: 'text-slate-900', dark: 'text-slate-100', token: 'text-text-strong' },
    { light: 'text-slate-700', dark: 'text-slate-300', token: 'text-text' },
    { light: 'text-slate-500', dark: 'text-slate-400', token: 'text-text-muted' },
    { light: 'text-slate-400', dark: 'text-slate-500', token: 'text-text-faint' },
    // borders
    { light: 'border-slate-200', dark: 'border-slate-700', token: 'border-border-base' },
    { light: 'border-slate-300', dark: 'border-slate-600', token: 'border-border-strong' },
] as const;

// ── Group (multi-class) rules ────────────────────────────────────────────────
// Multi-class collapse rules (e.g. state badge tints) would live here. NONE ship
// in phase 1: the state `-subtle` rgba fills match `bg-<c>-500/10`, but the token
// FOREGROUNDS are the PR#149 -700 legibility shades, which differ from the raw
// `-600`/`-400` foregrounds badges use today — so collapsing them would shift the
// badge text colour and break pixel-identity. They are an explicit phase-2 item.
// The structure is kept so the table can grow when value-reconciliation lands.
export const GROUP_RULES: readonly GroupRule[] = [] as const;

// ── Bare singleton rules (exact-match-only, context-free safe) ────────────────
// Deliberately empty for phase 1: no bare slate value can be migrated without
// knowing whether it is a symmetric-pair half (handled above) or an intentional
// raw colour. Leaving raw is always the safe choice. The structure exists so the
// table can grow if a provably-safe bare mapping is later identified.
export const BARE_RULES: readonly BareRule[] = [] as const;

// Variant prefixes we migrate generically. A pair must share the SAME prefix on
// both halves (the dark half is `dark:<prefix><dark>`). Order longest-first so
// `group-hover:` is tried before `hover:` etc. (tidy; not strictly required).
const PREFIXES: readonly string[] = [
    'group-hover:',
    'focus-within:',
    'focus-visible:',
    'hover:',
    'focus:',
    'active:',
    'disabled:',
    '',
];

/**
 * Split a className string into tokens, preserving order. Collapses runs of
 * whitespace; ignores empty fragments.
 */
function tokenize(input: string): string[] {
    return input.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * True if the string is an intentional always-dark surface. The marker must be a
 * BARE (light-applicable) bg, optionally with a non-dark variant prefix — that is
 * what paints the surface dark in BOTH modes. A `dark:bg-slate-900` is NOT a
 * marker: it is just the dark half of a normal surface pair (e.g.
 * `bg-white dark:bg-slate-900`) and must remain migratable.
 */
function hasAlwaysDarkMarker(classes: string[]): boolean {
    const set = new Set(classes);
    for (const marker of ALWAYS_DARK_MARKERS) {
        for (const p of PREFIXES) {
            if (set.has(p + marker)) return true;
        }
    }
    return false;
}

/**
 * Migrate a className string to semantic tokens. Pure: same input → same output.
 */
export function migrateClassName(input: string): string {
    if (!input) return input;

    const original = tokenize(input);

    // Deny-list: an intentional always-dark surface — leave the whole string raw.
    if (hasAlwaysDarkMarker(original)) {
        return input;
    }

    // Keep a result list for ordering plus a presence Set for O(1) lookups. We
    // remove consumed classes and insert tokens at the position of the FIRST
    // consumed class, so ordering is preserved as much as practical.
    const classes = [...original];
    const present = new Set(classes);

    // Replace a set of consumed classes with token classes. Inserts the tokens at
    // the earliest index among the consumed classes; removes the rest. Skips any
    // token that is already present (never duplicates).
    const consume = (toRemove: string[], toAdd: string[]) => {
        const indices = toRemove
            .map((c) => classes.indexOf(c))
            .filter((i) => i >= 0)
            .sort((a, b) => a - b);
        if (indices.length === 0) return;
        const insertAt = indices[0];
        const removedBefore = indices.filter((i) => i < insertAt).length;
        // remove from highest index down to keep earlier indices valid
        for (let i = indices.length - 1; i >= 0; i--) {
            classes.splice(indices[i], 1);
        }
        const pos = Math.min(insertAt - removedBefore, classes.length);
        const additions = toAdd.filter((t) => !classes.includes(t));
        classes.splice(pos, 0, ...additions);
        for (const c of toRemove) present.delete(c);
        for (const t of toAdd) present.add(t);
    };

    // 1) Group rules (state badge tints) — before single pairs so fill +
    //    foreground collapse together.
    for (const rule of GROUP_RULES) {
        for (const prefix of PREFIXES) {
            const lightClasses = rule.light.map((c) => prefix + c);
            const darkClasses = rule.dark.map((c) => 'dark:' + prefix + c);
            const needed = [...lightClasses, ...darkClasses];
            if (needed.every((c) => present.has(c))) {
                const tokens = rule.tokens.map((t) => prefix + t);
                consume(needed, tokens);
            }
        }
    }

    // 2) Paired symmetric rules.
    for (const rule of PAIRED_RULES) {
        for (const prefix of PREFIXES) {
            const lightClass = prefix + rule.light;
            const darkClass = 'dark:' + prefix + rule.dark;
            if (present.has(lightClass) && present.has(darkClass)) {
                consume([lightClass, darkClass], [prefix + rule.token]);
            }
        }
    }

    // 3) Bare singleton rules (exact match only).
    for (const rule of BARE_RULES) {
        for (const prefix of PREFIXES) {
            const bareClass = prefix + rule.raw;
            if (present.has(bareClass)) {
                consume([bareClass], [prefix + rule.token]);
            }
        }
    }

    return classes.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Deliberate coverage boundaries (read before extending the table)
//
// The codemod is intentionally conservative so phase-1 stays PIXEL-IDENTICAL.
// The following are knowingly NOT migrated — they are phase-2 normalization
// decisions, not codemod bugs:
//
//  1. `bg-white dark:bg-slate-900` → `bg-surface`. EXCLUDED. The `surface` token's
//     dark value is #131a22 (the legacy card-dark), but `bg-slate-900` is #0f172a.
//     Auto-migrating would darken/shift every dark card. (Slice #151's Navbar left
//     this same pair raw for the same reason.) Migrate by hand once the value is
//     reconciled.
//  2. State badge tints (`bg-<c>-500/10 text-<c>-600 dark:text-<c>-400` →
//     `bg-<c>-subtle text-<c>`). EXCLUDED. Subtle fills match, but token
//     foregrounds are the -700 legibility shades, not the raw -600/-400 used
//     today. Also, real badges mostly carry a single `text-<c>-400` (no light
//     half), relying on the PR#149 light override — an asymmetric shape the
//     codemod leaves raw by design.
//  3. Bare singletons (`bg-white`, `bg-slate-50`, `text-slate-500`, …). EXCLUDED
//     (BARE_RULES empty). A bare class can't be proven to be a surface/text role
//     vs. an intentional fixed colour without context, so leaving raw is safe.
//  4. Asymmetric pairs (`text-slate-600 dark:text-slate-300`,
//     `hover:bg-slate-50 dark:hover:bg-slate-800/60`, opacity-modified darks).
//     EXCLUDED — only exact symmetric pairs collapse.
//  5. Brand pins (`bg-accent`, `text-accent`, `border-accent` and opacity vars).
//     EXCLUDED — these are pinned to literal neon in light mode by index.css for
//     un-migrated call sites; migrating them is a manual per-call-site decision.
//
// What DOES migrate (all verified light+dark value-identical): the 7 symmetric
// pairs in PAIRED_RULES — surface-muted, the 4 text ranks, and the 2 borders.
// ─────────────────────────────────────────────────────────────────────────────
