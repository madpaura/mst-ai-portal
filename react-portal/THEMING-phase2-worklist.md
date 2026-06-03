# Theming phase-2 worklist (#157) — non-Admin pages

Slice #156 (issue #156) migrated the **provably pixel-identical** symmetric
slate pairs across every non-`Admin*` page in `src/pages/`. The patterns below
were **intentionally left raw** because each requires a value-reconciliation or
context decision that would change pixels in light and/or dark mode. They are
phase-2 normalization work, not codemod bugs — see the "Deliberate coverage
boundaries" block at the bottom of `src/theming/codemod.ts`.

Scope: the 16 non-Admin pages touched in #156 (ArticleDetail, ArticleEditor,
Articles, Contact, ContributeRequest, Howto, Ignite, Login, MarketplaceHowTo,
Marketplace, Memes, NewsArticle, News, Search, SolutionDetail, Solutions).

---

## 1. `bg-white dark:bg-slate-900` card surfaces — value mismatch, left raw

The `surface` token's dark value is `#131a22` (legacy card-dark), but
`bg-slate-900` is `#0f172a`. Collapsing to `bg-surface` would shift every dark
card. Phase-2 must reconcile the token value (or introduce a distinct token)
before migrating. Also blocks the paired `border-slate-200 dark:border-white/10`
collapse on the same cards (see §4).

- `ArticleEditor.tsx` (×4 — editor field panels)
- `Articles.tsx`, `Memes.tsx`, `News.tsx`, `Ignite.tsx`
- `Marketplace.tsx` (×2 — grid + list card wrappers, lines ~377 / ~459)

## 2. Always-dark code / terminal / hero surfaces — deny-listed, keep raw

Bare `bg-slate-900` (no light half) marks an intentional always-dark surface;
the codemod skips the entire className string. Their neon/foreground colours are
tuned for dark and must stay raw.

- `Marketplace.tsx` — install-command code block on `bg-slate-900`
  (explicitly called out in #156 as keep-raw)
- `ArticleEditor.tsx` (×4), `News.tsx`, `Login.tsx` (×2), `Memes.tsx`,
  `Howto.tsx` — bare `bg-slate-900` code/preview surfaces
- `ContributeRequest.tsx` — `bg-slate-50 dark:bg-slate-900` (asymmetric
  light-muted → always-dark surface)

## 3. Asymmetric text pairs `text-slate-600 dark:text-slate-300` — off-canonical

Not a symmetric pair in `PAIRED_RULES` (the canonical body rank is
`text-slate-700 dark:text-slate-300` → `text-text`). The `-600` light shade is
one step lighter than the token's light value, so collapsing would lighten body
text in light mode. Phase-2 decision: normalize these to `text-text` (accepting
a tiny light-mode shift) or add a distinct token. ~21 occurrences:

- `Howto.tsx` (×3), `Ignite.tsx` (×3), `Search.tsx` (×3), `Articles.tsx` (×2),
  `SolutionDetail.tsx` (×2), `Solutions.tsx` (×2),
  `ArticleDetail.tsx`, `ArticleEditor.tsx`, `NewsArticle.tsx`, `News.tsx`,
  `ContributeRequest.tsx`, `Marketplace.tsx` (×1 each)

## 4. Asymmetric borders `border-slate-200 dark:border-white/10` — off-canonical dark

The dark half is `white/10` (translucent), not `border-slate-700`, so it is not
the canonical `border-border-base` pair. Widespread on card/section dividers.
Phase-2: decide whether `border-border-base`'s dark value should become
translucent, or leave these as a distinct "hairline" treatment. Counts:

- `Ignite.tsx` (8), `Contact.tsx` (8), `News.tsx` (5), `ArticleEditor.tsx` (4),
  `Login.tsx` (4), `ContributeRequest.tsx` (3), `Articles.tsx` (2),
  `ArticleDetail.tsx` (2), `NewsArticle.tsx` (2), `Memes.tsx` (1),
  `Howto.tsx` (1), `Marketplace.tsx` (1), `Solutions.tsx` (1)

## 5. Asymmetric hover surfaces — opacity-modified darks, left raw

`hover:bg-slate-50 dark:hover:bg-slate-700/30` (and `/20`, and bare
`dark:hover:bg-slate-800/50` `/30`). The dark halves carry opacity modifiers and
use the `-700`/`-800` ramp, so they do not match the symmetric
`hover:bg-surface-muted` pair.

- `Contact.tsx` (×2 — `/30`, `/20`)
- `Ignite.tsx` (×3 — `dark:hover:bg-slate-800/50`, `/30` ×2)
- `Howto.tsx` (×1 — `dark:hover:bg-slate-800/50`)

## 6. Bare singletons (`bg-white`, `bg-slate-50/100`, `text-slate-400`) — ambiguous

`BARE_RULES` is empty by design: a bare class can't be proven to be a
surface/text role vs. an intentional fixed colour without context. Notable bare
fills awaiting a per-call-site decision:

- bare `bg-white`: `Marketplace.tsx` (5), `ArticleEditor.tsx` (4),
  `Contact.tsx` (3), `Articles.tsx` (2), `Search.tsx` (4 — incl. input bg),
  `Memes.tsx`, `Ignite.tsx`, `News.tsx`
- bare `bg-slate-50` / `bg-slate-100` chips & panels: `Ignite.tsx` (16),
  `Marketplace.tsx` (8), `Contact.tsx` (8), `Howto.tsx` (6), `Solutions.tsx` (4),
  `Login.tsx` (2), `ContributeRequest.tsx` (2), `Memes.tsx` (2), `Articles.tsx` (2),
  `Search.tsx` (1), `SolutionDetail.tsx` (1)
- bare standalone `text-slate-400` icon colours (paired only when a matching
  `dark:` half exists) — scattered across most pages

## 7. State-badge tints `bg-<c>-500/10` + `text-<c>-{400,600}` — foreground mismatch

`GROUP_RULES` is empty in phase-1: the `-subtle` fills match `bg-<c>-500/10`, but
the `text-<c>` token foregrounds are the PR#149 `-700` legibility shades, which
differ from the raw `-400`/`-600` foregrounds these badges use. Many badges also
carry only a single `text-<c>-400` (no light half), relying on the PR#149 light
override — an asymmetric shape. Migrating shifts badge text colour. Occurrences:

- `Contact.tsx` (`bg-green-500/10 text-green-400`, `bg-red-500/10 text-red-400`)
- `ContributeRequest.tsx` (amber/green/red status tints, ×5)
- `ArticleDetail.tsx` (blue/green/amber category tints, ×3)
- `NewsArticle.tsx` (green/amber, ×2), `News.tsx` / `Articles.tsx`
  (`text-green-400`, `text-amber-400`)
- `Login.tsx` (`bg-red-500/10` error banner), `Howto.tsx` (`text-yellow-400`)

## 8. Brand-pin accent / neon (`text-accent`, `bg-accent/*`, `border-accent`)

Pinned to literal neon in light mode by `index.css` for un-migrated call sites;
each is a manual per-call-site brand decision (EXCLUDED §5 of codemod boundaries).

- `Howto.tsx` — `bg-accent/* text-accent border-accent` chips/callouts (~8 refs)
- `Ignite.tsx` — `text-accent bg-accent/* border-accent` (~3 refs, line ~686)

---

### Pre-existing observations (no fix applied in #156)

- `Ignite.tsx:242` uses `{!!!user ...}` (triple-bang) — works (`!!!user === !user`)
  but is a confusing idiom worth simplifying in a non-theming pass.
