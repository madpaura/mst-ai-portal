// Theme registry + pure resolver.
//
// Single source of truth for the curated, named set of portal themes. A theme
// is selected by a class on <html> (the `htmlClass`), independent of the user's
// light/dark preference (the `dark` class), which is handled orthogonally in
// theme.tsx and must never be touched here.
//
// To register a NEW theme, add one entry to THEME_REGISTRY below:
//   midnight: { name: 'midnight', htmlClass: 'theme-midnight' },
// No component changes required.

/**
 * A single registered theme: its canonical name and the class applied to
 * <html> to activate it. The default theme applies no class (empty string).
 */
export interface RegisteredTheme {
  name: string;
  /** Class added to <html> for this theme. Empty string = no theme class. */
  htmlClass: string;
}

/**
 * The known set of valid themes. This object is the single source of truth for
 * which theme names are valid and which <html> class each applies.
 *
 * Register a future theme by adding one line here (name + htmlClass).
 */
export const THEME_REGISTRY = {
  default: { name: 'default', htmlClass: '' },
  simple: { name: 'simple', htmlClass: 'theme-simple' },
} as const satisfies Record<string, RegisteredTheme>;

/** Union of all valid theme names, derived from the registry. */
export type ThemeName = keyof typeof THEME_REGISTRY;

/** The safe fallback theme used for unknown/empty/invalid input. */
export const DEFAULT_THEME_NAME: ThemeName = 'default';

/** The set of every <html> theme class the registry can apply (excludes ''). */
export const ALL_THEME_CLASSES: readonly string[] = Object.values(THEME_REGISTRY)
  .map((t) => t.htmlClass)
  .filter((c) => c.length > 0);

/** The resolved outcome of {@link resolveTheme}. */
export interface ResolvedTheme {
  name: ThemeName;
  /** Class to apply to <html>. Empty string for the default theme. */
  htmlClass: string;
}

function isThemeName(value: string): value is ThemeName {
  return Object.prototype.hasOwnProperty.call(THEME_REGISTRY, value);
}

/**
 * Resolve a theme name (e.g. the backend `portal_theme` setting) to the theme
 * that should be active. Pure: validates against {@link THEME_REGISTRY} and
 * falls back to the default for unknown / empty / null / undefined input.
 *
 * Has NO DOM side effects and never references the `dark`/light class — theme
 * selection is strictly orthogonal to the user's light/dark preference.
 */
export function resolveTheme(name: string | null | undefined): ResolvedTheme {
  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (trimmed.length > 0 && isThemeName(trimmed)) {
      const entry = THEME_REGISTRY[trimmed];
      return { name: entry.name, htmlClass: entry.htmlClass };
    }
  }
  const fallback = THEME_REGISTRY[DEFAULT_THEME_NAME];
  return { name: fallback.name, htmlClass: fallback.htmlClass };
}

/**
 * Apply a resolved theme to a root element (default: <html>). This is the only
 * impure part of the module: it mutates classList. It removes every known theme
 * class first, then adds the resolved one (if any), so switching themes is
 * clean. It NEVER touches the `dark` class — light/dark stays orthogonal.
 */
export function applyResolvedTheme(
  root: Element,
  resolved: ResolvedTheme,
): void {
  for (const cls of ALL_THEME_CLASSES) {
    root.classList.remove(cls);
  }
  if (resolved.htmlClass) {
    root.classList.add(resolved.htmlClass);
  }
}
