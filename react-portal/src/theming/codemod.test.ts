import { describe, it, expect } from 'vitest';
import {
    migrateClassName,
    PAIRED_RULES,
    GROUP_RULES,
    BARE_RULES,
    ALWAYS_DARK_MARKERS,
} from './codemod';

// Table-driven tests over the pure migration function. Each case asserts the
// exact migrated output: token applied, left raw, or untouched.
type Case = { name: string; input: string; expected: string };

const cases: Case[] = [
    // ── Paired patterns: surfaces ────────────────────────────────────────────
    {
        name: 'surface-muted: bg-slate-50 dark:bg-slate-800 → bg-surface-muted',
        input: 'bg-slate-50 dark:bg-slate-800',
        expected: 'bg-surface-muted',
    },
    // Coverage boundary: bg-white dark:bg-slate-900 is NOT pixel-identical to the
    // surface token (surface-dark = #131a22 ≠ slate-900 #0f172a) → left RAW.
    {
        name: 'boundary: bg-white dark:bg-slate-900 left raw (surface-dark mismatch)',
        input: 'bg-white dark:bg-slate-900',
        expected: 'bg-white dark:bg-slate-900',
    },
    // ── Paired patterns: text hierarchy ──────────────────────────────────────
    {
        name: 'text-strong',
        input: 'text-slate-900 dark:text-slate-100',
        expected: 'text-text-strong',
    },
    {
        name: 'text',
        input: 'text-slate-700 dark:text-slate-300',
        expected: 'text-text',
    },
    {
        name: 'text-muted',
        input: 'text-slate-500 dark:text-slate-400',
        expected: 'text-text-muted',
    },
    {
        name: 'text-faint',
        input: 'text-slate-400 dark:text-slate-500',
        expected: 'text-text-faint',
    },
    // ── Paired patterns: borders ─────────────────────────────────────────────
    {
        name: 'border-base',
        input: 'border-slate-200 dark:border-slate-700',
        expected: 'border-border-base',
    },
    {
        name: 'border-strong',
        input: 'border-slate-300 dark:border-slate-600',
        expected: 'border-border-strong',
    },
    // ── Coverage boundary: state badge tints left RAW (foreground shade differs)
    {
        name: 'boundary: danger badge tint left raw (token fg is -700, not -600/-400)',
        input: 'bg-red-500/10 text-red-600 dark:text-red-400',
        expected: 'bg-red-500/10 text-red-600 dark:text-red-400',
    },
    {
        name: 'boundary: real single-foreground badge (bg-red-500/10 text-red-400) left raw',
        input: 'bg-red-500/10 text-red-400 border-red-500/30',
        expected: 'bg-red-500/10 text-red-400 border-red-500/30',
    },
    // ── Order independence within the class list ─────────────────────────────
    {
        name: 'dark half before light half still collapses',
        input: 'dark:text-slate-100 text-slate-900',
        expected: 'text-text-strong',
    },
    // ── Prefix handling ──────────────────────────────────────────────────────
    {
        name: 'hover prefix collapses',
        input: 'hover:bg-slate-50 dark:hover:bg-slate-800',
        expected: 'hover:bg-surface-muted',
    },
    {
        name: 'group-hover prefix collapses',
        input: 'group-hover:text-slate-900 dark:group-hover:text-slate-100',
        expected: 'group-hover:text-text-strong',
    },
    {
        name: 'unprefixed and hover-prefixed muted pairs both collapse independently',
        input: 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800',
        expected: 'bg-surface-muted hover:bg-surface-muted',
    },
    // ── Off-canonical outliers: left RAW ─────────────────────────────────────
    {
        name: 'bare off-canonical text-slate-600 left raw',
        input: 'text-slate-600',
        expected: 'text-slate-600',
    },
    {
        name: 'bare off-canonical bg-slate-100 left raw',
        input: 'bg-slate-100',
        expected: 'bg-slate-100',
    },
    {
        name: 'asymmetric pair (text-slate-600 dark:text-slate-300) left raw',
        input: 'text-slate-600 dark:text-slate-300',
        expected: 'text-slate-600 dark:text-slate-300',
    },
    {
        name: 'half a pair (only light half present) left raw',
        input: 'text-slate-900',
        expected: 'text-slate-900',
    },
    {
        name: 'half a pair (only dark half present) left raw',
        input: 'dark:text-slate-100',
        expected: 'dark:text-slate-100',
    },
    {
        name: 'badge missing dark half left fully raw',
        input: 'bg-red-500/10 text-red-600',
        expected: 'bg-red-500/10 text-red-600',
    },
    // ── Bare exact-match singletons: NONE migrate in phase 1 ──────────────────
    {
        name: 'bare bg-white left raw (ambiguous singleton, not in BARE_RULES)',
        input: 'bg-white',
        expected: 'bg-white',
    },
    // ── Always-dark deny-list: whole string left RAW ─────────────────────────
    {
        name: 'deny-list: bg-slate-900 surface keeps neon text raw',
        input: 'bg-slate-900 text-slate-100 text-green-400',
        expected: 'bg-slate-900 text-slate-100 text-green-400',
    },
    {
        name: 'deny-list: bg-black keeps everything raw',
        input: 'bg-black text-slate-900 dark:text-slate-100',
        expected: 'bg-black text-slate-900 dark:text-slate-100',
    },
    {
        name: 'deny-list: bg-zinc-900 code block untouched',
        input: 'bg-zinc-900 border-slate-200 dark:border-slate-700 text-emerald-400',
        expected: 'bg-zinc-900 border-slate-200 dark:border-slate-700 text-emerald-400',
    },
    {
        name: 'deny-list: dark:-prefixed dark bg is NOT a marker (it is a pair half) — migration proceeds',
        input: 'dark:bg-slate-950 text-slate-900 dark:text-slate-100',
        expected: 'dark:bg-slate-950 text-text-strong',
    },
    {
        name: 'deny-list: prefixed bare marker (hover:bg-slate-900) also skips string',
        input: 'hover:bg-slate-900 text-slate-900 dark:text-slate-100',
        expected: 'hover:bg-slate-900 text-slate-900 dark:text-slate-100',
    },
    // ── Unknown / mixed classes preserved with migration applied ─────────────
    {
        name: 'mixed: unknown layout classes preserved, pair migrated in place',
        input: 'rounded-xl p-4 text-slate-900 dark:text-slate-100 font-bold',
        expected: 'rounded-xl p-4 text-text-strong font-bold',
    },
    {
        name: 'mixed: multiple families migrate, unknowns kept',
        input: 'flex bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 gap-2',
        expected: 'flex bg-surface-muted border-border-base gap-2',
    },
    {
        name: 'all-unknown string untouched',
        input: 'flex items-center gap-3 rounded-lg shadow-md',
        expected: 'flex items-center gap-3 rounded-lg shadow-md',
    },
    {
        name: 'empty string',
        input: '',
        expected: '',
    },
    {
        name: 'no duplicate token when token already present',
        input: 'text-text-strong text-slate-900 dark:text-slate-100',
        expected: 'text-text-strong',
    },
];

describe('migrateClassName', () => {
    for (const c of cases) {
        it(c.name, () => {
            expect(migrateClassName(c.input)).toBe(c.expected);
        });
    }

    it('whitespace is normalised to single spaces', () => {
        expect(migrateClassName('  flex   gap-2  ')).toBe('flex gap-2');
    });

    // Idempotency: running twice equals running once, for every case.
    describe('idempotency', () => {
        for (const c of cases) {
            it(`idempotent: ${c.name}`, () => {
                const once = migrateClassName(c.input);
                const twice = migrateClassName(once);
                expect(twice).toBe(once);
            });
        }
    });
});

describe('mapping table integrity', () => {
    it('every paired rule has light/dark/token', () => {
        for (const r of PAIRED_RULES) {
            expect(r.light).toBeTruthy();
            expect(r.dark).toBeTruthy();
            expect(r.token).toBeTruthy();
        }
    });

    it('GROUP_RULES is empty in phase 1 (badge fg shade differs — see boundaries)', () => {
        expect(GROUP_RULES.length).toBe(0);
    });

    it('BARE_RULES is empty in phase 1 (conservative)', () => {
        expect(BARE_RULES.length).toBe(0);
    });

    it('every paired rule token starts with bg-/text-/border-', () => {
        for (const r of PAIRED_RULES) {
            expect(/^(bg-|text-|border-)/.test(r.token)).toBe(true);
        }
    });

    it('deny-list covers the documented always-dark markers', () => {
        for (const m of [
            'bg-slate-900',
            'bg-slate-950',
            'bg-gray-900',
            'bg-gray-950',
            'bg-zinc-900',
            'bg-neutral-900',
            'bg-black',
        ]) {
            expect(ALWAYS_DARK_MARKERS).toContain(m);
        }
    });
});
