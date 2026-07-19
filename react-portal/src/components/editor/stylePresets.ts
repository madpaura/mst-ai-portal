// Whole-video background styling presets (issue #263) — the frontend half
// of a "define once" pair. `api/video/style_presets.py` is the Python-side
// mirror the worker reads to generate the same backdrop at render time via
// ffmpeg's `gradients`/`color` filters. The two runtimes can't literally
// share one file, so keep the preset **keys** and general color intent in
// sync between this file and that one whenever a preset changes.
//
// `css` is used directly as a CSS `background` value for both the preset
// swatch buttons in the Style panel and the live stage preview's backdrop.

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface StylePresetDef {
  key: string;
  name: string;
  css: string;
  /** True for wallpaper (bundled image) presets — issue #278. They render
   * server-side via the image-backdrop path; the keys must exist in
   * `STYLE_WALLPAPERS` in api/video/style_presets.py. */
  wallpaper?: boolean;
}

export const STYLE_PRESETS: StylePresetDef[] = [
  { key: 'none', name: 'None', css: '#000' },
  { key: 'slate', name: 'Slate', css: 'linear-gradient(135deg,#1e293b,#0f172a)' },
  { key: 'ocean', name: 'Ocean', css: 'linear-gradient(135deg,#1e3a8a,#0c4a6e 60%,#082f49)' },
  { key: 'dusk', name: 'Dusk', css: 'linear-gradient(135deg,#4c1d95,#831843)' },
  { key: 'forest', name: 'Forest', css: 'linear-gradient(135deg,#14532d,#052e16)' },
  {
    key: 'mesh',
    name: 'Mesh',
    css:
      'radial-gradient(at 20% 20%,#312e81 0,transparent 55%),' +
      'radial-gradient(at 80% 75%,#0e7490 0,transparent 55%),#0b1120',
  },
];

const wallpaperCss = (key: string) => `#0b0f17 center/cover no-repeat url(${API_BASE}/static/wallpapers/${key}.jpg)`;

export const WALLPAPER_PRESETS: StylePresetDef[] = [
  { key: 'aurora', name: 'Aurora', css: wallpaperCss('aurora'), wallpaper: true },
  { key: 'nebula', name: 'Nebula', css: wallpaperCss('nebula'), wallpaper: true },
  { key: 'sunset', name: 'Sunset', css: wallpaperCss('sunset'), wallpaper: true },
  { key: 'midnight', name: 'Midnight', css: wallpaperCss('midnight'), wallpaper: true },
  { key: 'graphite', name: 'Graphite', css: wallpaperCss('graphite'), wallpaper: true },
];

const ALL_PRESETS: StylePresetDef[] = [...STYLE_PRESETS, ...WALLPAPER_PRESETS];

export function stylePresetName(key: string): string {
  return ALL_PRESETS.find((p) => p.key === key)?.name ?? key;
}

export function stylePresetCss(key: string): string {
  return ALL_PRESETS.find((p) => p.key === key)?.css ?? '#000';
}

// Picking a non-none preset while padding is still 0 auto-sets a sensible
// default inset rather than leaving the backdrop invisible behind an
// un-padded, square-cornered video. Kept thin (ScreenArc-style): the
// backdrop should read as a small border around the video, not a frame
// the video floats in.
export const AUTO_PAD_PCT_ON_PRESET_PICK = 2;
export const AUTO_RADIUS_PX_ON_PRESET_PICK = 12;

export const STYLE_PAD_MIN = 0;
export const STYLE_PAD_MAX = 12;
export const STYLE_RADIUS_MIN = 0;
export const STYLE_RADIUS_MAX = 32;

export const MAX_BACKGROUND_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_BACKGROUND_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
