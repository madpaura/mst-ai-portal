# Theming — token vocabulary (phase 1)

Single source of truth for colour in the portal. Components reference **semantic
tokens** (`bg-surface`, `text-muted`, `border-border-base`, …) instead of raw
Tailwind palette classes plus hand-written `dark:` pairs.

Implements PRD #150, slice #151 (token foundation + Navbar tracer).

## The theme × mode model

Two independent classes on `<html>` (managed by `src/context/theme.tsx`):

| Axis | Class | Values |
|---|---|---|
| **Theme** | `.theme-simple` (absent = default) | `default`, `simple` (chosen by backend `portal_theme`) |
| **Mode** | `.dark` (absent = light) | `light`, `dark` (user toggle, persisted in `localStorage`) |

The two axes are **orthogonal**: every theme defines both a light and a dark value
set. That produces four CSS-variable blocks in `src/index.css`:

```
:root                default · light
.dark                default · dark
.theme-simple        simple  · light
.dark.theme-simple   simple  · dark
```

**Dark mode is a variable flip, not a prefix.** A token's *value* changes under
`.dark`, so a single class (`text-strong`) is correct in both modes.

> **Rule: no `dark:` colour prefixes on migrated code.** If you find yourself
> writing `bg-X dark:bg-Y`, that pair is exactly what a token replaces. (Non-colour
> `dark:` utilities — layout, opacity, brand-tint overrides — are still fine.)

## How it is wired

1. **`src/index.css`** — the four blocks above define ~20 `--token` custom properties.
   This is the only place you edit to re-skin or normalize a colour.
2. **`tailwind.config.js`** — `theme.extend.colors` maps each semantic name to its
   variable, e.g. `surface: 'var(--surface)'`. Tailwind opacity modifiers still work.
3. **Components** — use the semantic Tailwind class (`bg-surface`, `text-text-muted`).

Legacy mode-specific tokens (`card-light/dark`, `panel-*`, `border-light/dark`, …)
and raw `slate-*` classes still resolve unchanged, so migration is incremental and
non-breaking.

## Token vocabulary (role → token)

### Surfaces (3)
| Token | Role |
|---|---|
| `canvas` | Page background |
| `surface` | Cards, modals, raised panels |
| `surface-muted` | Subtle fills: side panels, table headers, hover rows |

### Text (4-rank hierarchy)
| Token | Role |
|---|---|
| `text-strong` | Headings / highest-emphasis text |
| `text` | Body text |
| `text-muted` | Secondary / labels |
| `text-faint` | Placeholders, captions, disabled |

### Borders (2)
| Token | Role |
|---|---|
| `border-base` | Default dividers / card borders |
| `border-strong` | Emphasized borders |

### Brand (3)
| Token | Role |
|---|---|
| `primary` | Primary brand blue (links, primary buttons) |
| `primary-subtle` | 10% primary tint fill |
| `accent` | Accent — legible-by-construction (neon on dark, emerald on light) |

### State (8 — each foreground has a paired `-subtle` fill)
| Token | Role |
|---|---|
| `success` / `success-subtle` | Positive status text / tinted badge fill |
| `warning` / `warning-subtle` | Caution status |
| `danger` / `danger-subtle` | Errors / destructive |
| `info` / `info-subtle` | Informational |

Badges become `bg-danger-subtle text-danger` (and the tint reads correctly in
both modes by construction).

## Phase-1 values (what each token resolves to)

Values were chosen to **exactly match today's dominant rendered colour** for each
role, so phase 1 is pixel-identical. Hex comments in `index.css` cite the original
slate/palette shade. Note: the `simple` theme does not generically remap raw
`slate-*` text/border utilities today, so its text/border tokens **mirror the
default values** to stay pixel-identical; only `canvas`/`surface` carry the
GitHub-flavoured surface values that the existing `nav` / `.glass-card` overrides
already paint.

The neon light-legibility override (formerly PR #149) folds into `accent` and the
state tokens: `accent` is emerald-700 (`#047857`) in light, neon (`#00ff9d`) in
dark. Always-dark surfaces (code blocks on `bg-slate-900/950`, etc.) keep neon via
the existing descendant override in `index.css` — do not convert those to surface
tokens.

## Migration status

- [x] Token layer (CSS variables + Tailwind mapping)
- [x] `Navbar` (tracer — migrated exact-match symmetric pairs to tokens; asymmetric
      pairs left raw to stay pixel-identical)
- [x] Codemod migration tool + tests (slice #152) — pure `migrateClassName` in
      `src/theming/codemod.ts` with the canonical mapping table; CLI in
      `scripts/migrate-theme.ts`; Vitest suite in `src/theming/codemod.test.ts`
- [x] `SearchBar` (migrated via the codemod — `border-border-base`, `text-text-muted`)
- [ ] AdminLayout, IgniteSidebar, shared cards/modals/buttons, admin tables, long-tail pages

### Codemod coverage boundaries (phase 1, pixel-identical only)

The codemod migrates only the 7 **value-identical** symmetric pairs: `surface-muted`,
the 4 text ranks, and the 2 borders. Deliberately left RAW (phase-2 work):
- `bg-white dark:bg-slate-900` → `bg-surface` (surface-dark `#131a22` ≠ slate-900 `#0f172a`).
- state badge tints → `*-subtle text-*` (token fg is the `-700` legibility shade, not raw `-600`/`-400`).
- bare singletons, asymmetric pairs, opacity-modified darks, and `bg-/text-/border-accent` pins.
- always-dark surfaces (`bg-slate-900/950`, `bg-black`, …) — skipped entirely by the deny-list.
