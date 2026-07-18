"""Shared background-style preset definitions for the video editor's
whole-video styling feature (issue #263).

This is the Python-side half of a "define once" pair — the frontend's
`react-portal/src/components/editor/stylePresets.ts` is the other half.
Two different runtimes (a browser's CSS engine for the live editor preview
vs ffmpeg's `gradients` lavfi source for the worker's render) can't literally
share one source file, so keep the preset **keys** and general color intent
identical between the two files whenever a preset is added, renamed, or
recolored — the frontend module has a comment pointing back here.

`STYLE_PRESET_GRADIENTS` intentionally approximates each CSS gradient rather
than reproducing it pixel-for-pixel: the backdrop sits *behind* the framed,
padded video (mockup default pad/radius is a modest 5%/14px inset), so it
reads as an ambient surface, not a focal element — an eyeballed match in
ffmpeg's more limited gradient primitives is the right level of fidelity for
that role.
"""

# 'none' is always valid and means "no background styling" (flat black
# backdrop if padding is used with 'none' — matches the mockup, which always
# renders *some* backdrop colour, defaulting to black).
STYLE_PRESET_KEYS: frozenset[str] = frozenset({"none", "slate", "ocean", "dusk", "forest", "mesh"})

# key -> { type: ffmpeg `gradients` filter type name, colors: [c0, c1, ...] }
# Mirrors the `css` values of PRESETS in stylePresets.ts as closely as
# ffmpeg's `gradients` filter (2-8 flat colour stops, linear/radial/circular/
# spiral/square) allows — multi-stop CSS gradients with non-even stop
# positions (e.g. ocean's 60% midpoint) are approximated with evenly spaced
# stops, and mesh's two independent radial highlights are approximated with
# a single radial gradient through the same three colours.
STYLE_PRESET_GRADIENTS: dict[str, dict] = {
    "slate":  {"type": "linear", "colors": ["#1e293b", "#0f172a"]},
    "ocean":  {"type": "linear", "colors": ["#1e3a8a", "#0c4a6e", "#082f49"]},
    "dusk":   {"type": "linear", "colors": ["#4c1d95", "#831843"]},
    "forest": {"type": "linear", "colors": ["#14532d", "#052e16"]},
    "mesh":   {"type": "radial", "colors": ["#312e81", "#0e7490", "#0b1120"]},
}

# ffmpeg `gradients` filter's numeric `type` option values.
STYLE_GRADIENT_TYPE_CODES: dict[str, int] = {
    "linear": 0,
    "radial": 1,
    "circular": 2,
    "spiral": 3,
    "square": 4,
}


def normalize_preset(preset: str | None) -> str:
    """Return `preset` if it's a known key, else 'none' (defensive fallback
    for stale/hand-edited drafts — never hard-fail a render over an unknown
    preset string)."""
    if preset and preset in STYLE_PRESET_KEYS:
        return preset
    return "none"
