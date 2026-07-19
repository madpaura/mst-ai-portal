"""Whole-video background styling — render-side filter graph (issue #263).

Extends the editor export/apply render pipeline (see
`build_export_filter_complex` / `process_render_job` in transcoder.py) with
an optional stage appended *after* the existing concat+quality-scale chain:
scale the edited video down by the padding factor, round its corners with a
`geq` alpha mask, and overlay it centered on a generated-gradient,
flat-color, or uploaded-image backdrop sized to the output canvas.

Skipped entirely when styling is inactive (preset 'none', no image, pad 0,
radius 0) — `style_is_active()` gates this, and when it's False the caller
must not touch the filter graph at all, so an unstyled export/apply stays
byte-for-byte identical to before this feature existed (issue #263
acceptance criterion).

Backdrop generation choice
--------------------------
The issue asked us to pick between three approaches for generating a
gradient/solid backdrop and document the choice:

1. ffmpeg's `gradients` lavfi source filter (draws the gradient directly,
   no temp file, no extra dependency) — available since ffmpeg ~4.3.
2. Pre-rendering the gradient to a PNG with PIL, if available in the worker
   image.
3. An ffmpeg `color=` flat fill as a last-resort fallback.

The worker's image (python:3.12-slim + `apt-get install ffmpeg`, see
api/Dockerfile) does **not** include Pillow — api/requirements.txt has no
image library at all — while the apt-installed ffmpeg build on Debian
bookworm/trixie ships the `gradients` filter (confirmed present locally with
ffmpeg 7.1; it's been in stock ffmpeg builds since 4.3, well before the
oldest Debian release this image could plausibly use). Option 1 was chosen:
it needs no new dependency, no temp file, and composes directly inside the
existing `-filter_complex` graph. Option 3 (`color=`) is used automatically
for the 'none'-with-padding case (a flat black backdrop) and as the fallback
if a preset key isn't in `STYLE_PRESET_GRADIENTS` for any reason — so the
PIL path was never wired in; if a future minimal base image ever drops the
`gradients` filter, that's the extension point.
"""
from __future__ import annotations

import os
from typing import Optional

from video.style_presets import (
    STYLE_GRADIENT_TYPE_CODES,
    STYLE_PRESET_GRADIENTS,
    normalize_preset,
    resolve_wallpaper_path,
)

# Long enough to outlast any realistic source video; overlay's `shortest=1`
# below trims the composited output to the (always-finite) foreground video
# anyway, so this only needs to be "long enough", not exact.
_BACKDROP_DURATION_S = 36000  # 10 hours


def _even(value: float) -> int:
    """Round to the nearest integer, then down to the nearest even number
    (matches ffmpeg's own even-dimension requirement for yuv420p output)."""
    n = int(round(value))
    return n - (n % 2)


def compute_canvas_width(source_width: int, source_height: int, target_h: int) -> int:
    """The output canvas width for a styled render at `target_h`, preserving
    the source aspect ratio and forced even (see `_even`). Exposed so
    transcoder.py can pass the *same* number both as `target_width` into
    `build_export_filter_complex` (so the actual encoded frame matches) and
    into `build_style_filter_chunk` (so the backdrop is generated at that
    exact size) — computed once, used twice, never left to drift."""
    return max(2, _even(source_width * target_h / max(1, source_height)))


def style_is_active(style: Optional[dict]) -> bool:
    """Whether the style stage should run at all. Mirrors the mockup: even
    the 'none' preset renders a (black) backdrop once padding is nonzero, so
    activity is "any knob touched", not just "a preset picked"."""
    if not style:
        return False
    preset = normalize_preset(style.get("preset"))
    image = style.get("image")
    pad_pct = float(style.get("pad_pct", 0) or 0)
    radius_px = float(style.get("radius_px", 0) or 0)
    return bool(image) or preset != "none" or pad_pct > 0 or radius_px > 0


def resolve_background_image_path(video_dir: str, style: Optional[dict]) -> Optional[str]:
    """Return the on-disk path of the backdrop image to use, or None to fall
    back to the preset gradient/solid.

    Priority mirrors the editor preview: an uploaded custom image wins (if
    its file still exists — it may have been removed by /cleanup, issue
    #263), then a bundled wallpaper preset (issue #278). A missing file in
    either case degrades gracefully rather than failing the render."""
    if not style:
        return None
    image = style.get("image")
    if image:
        # style.image is stored as the served URL (e.g. "/streams/{id}/editor_bg.png");
        # the file always lives at the video dir root, so basename + video_dir is
        # all that's needed regardless of the exact URL prefix.
        path = os.path.join(video_dir, os.path.basename(image))
        if os.path.isfile(path):
            return path
    return resolve_wallpaper_path(normalize_preset(style.get("preset")))


def _backdrop_filter_chunk(label_out: str, width: int, height: int, preset: str) -> str:
    """Return a filter_complex chunk that produces a static WxH backdrop
    clip on `[label_out]` — a preset gradient, or flat black otherwise."""
    gradient = STYLE_PRESET_GRADIENTS.get(preset)
    if gradient:
        colors = gradient["colors"]
        color_args = ":".join(f"c{i}={c}" for i, c in enumerate(colors))
        gtype = STYLE_GRADIENT_TYPE_CODES.get(gradient["type"], 0)
        # speed=0 keeps the gradient static (no rotation/animation over the
        # video's duration) — the mockup's Style presets are flat swatches.
        return (
            f"gradients=size={width}x{height}:n={len(colors)}:{color_args}:"
            f"type={gtype}:speed=0:rate=25:duration={_BACKDROP_DURATION_S}[{label_out}]"
        )
    return f"color=c=black:size={width}x{height}:rate=25:duration={_BACKDROP_DURATION_S}[{label_out}]"


def _rounded_corner_alpha_expr(radius: float) -> str:
    """geq alpha expression: opaque everywhere except the four corners,
    where a per-corner circle test cuts a quarter-circle cutout. `W`/`H` are
    geq's built-in current-plane-size variables — no need to interpolate the
    actual frame size here, only the radius."""
    r = f"{radius:.3f}"
    return (
        f"if(lt(X,{r})*lt(Y,{r}),"
        f"if(lte(pow({r}-X,2)+pow({r}-Y,2),pow({r},2)),255,0),"
        f"if(gt(X,W-{r})*lt(Y,{r}),"
        f"if(lte(pow(X-(W-{r}),2)+pow({r}-Y,2),pow({r},2)),255,0),"
        f"if(lt(X,{r})*gt(Y,H-{r}),"
        f"if(lte(pow({r}-X,2)+pow(Y-(H-{r}),2),pow({r},2)),255,0),"
        f"if(gt(X,W-{r})*gt(Y,H-{r}),"
        f"if(lte(pow(X-(W-{r}),2)+pow(Y-(H-{r}),2),pow({r},2)),255,0),"
        f"255))))"
    )


def build_style_filter_chunk(
    video_in_label: str,
    canvas_w: int,
    canvas_h: int,
    source_height: int,
    style: dict,
    bg_image_input_label: Optional[str],
) -> tuple[str, str]:
    """Build the style stage's filter_complex chunk.

    `video_in_label` is the existing concatenated/quality-scaled video
    stream, already at exactly canvas_w x canvas_h (the caller is
    responsible for that — see the `target_width` param added to
    `build_export_filter_complex`). `bg_image_input_label` is the ffmpeg
    input label (e.g. "1:v") for an uploaded custom background when one is
    in use, or None to use the preset gradient/solid.

    Returns (filter_complex_chunk, new_video_out_label) to append to and
    replace the caller's existing filter_complex string / video_out label.
    """
    preset = normalize_preset(style.get("preset"))
    pad_pct = max(0.0, min(12.0, float(style.get("pad_pct", 0) or 0)))
    radius_px = max(0.0, min(32.0, float(style.get("radius_px", 0) or 0)))

    scale_factor = max(0.05, 1 - 2 * pad_pct / 100.0)
    inset_w = max(2, _even(canvas_w * scale_factor))
    inset_h = max(2, _even(canvas_h * scale_factor))

    # radius_px is calibrated against the *source* resolution (roughly what
    # the editor's live preview approximates at typical window sizes), then
    # scaled by this render's height relative to the source. That keeps
    # corner rounding visually proportional across quality tiers of the same
    # export (e.g. 720p vs 1440p) rather than using a literal pixel count
    # that would look oversized on a small export and undersized on a large
    # one — a literal one-to-one px match to an arbitrary, resizable browser
    # window isn't achievable server-side regardless.
    radius_render = radius_px * (canvas_h / max(1, source_height))
    radius_render = max(0.0, min(radius_render, min(inset_w, inset_h) / 2))

    parts: list[str] = []

    if bg_image_input_label:
        parts.append(
            f"[{bg_image_input_label}]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,"
            f"crop={canvas_w}:{canvas_h},setsar=1[stylebg]"
        )
    else:
        parts.append(_backdrop_filter_chunk("stylebg", canvas_w, canvas_h, preset))

    parts.append(f"[{video_in_label}]scale={inset_w}:{inset_h}[stylefgraw]")

    if radius_render >= 0.5:
        alpha_expr = _rounded_corner_alpha_expr(radius_render)
        # geq requires an explicit lum expression even when only alpha is
        # being touched (confirmed against the worker image's ffmpeg 7.1 —
        # omitting it errors with "A luminance or RGB expression is
        # mandatory" despite older docs implying p(X,Y) is the default);
        # `lum='p(X,Y)'` passes the luma plane through unchanged.
        parts.append(
            f"[stylefgraw]format=yuva420p,geq=lum='p(X,Y)':a='{alpha_expr}'[stylefg]"
        )
        fg_label = "stylefg"
    else:
        fg_label = "stylefgraw"

    parts.append(f"[stylebg][{fg_label}]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1[styleout]")

    return ";".join(parts), "styleout"
