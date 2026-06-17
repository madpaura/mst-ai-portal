#!/usr/bin/env python3
"""Rebuild the image-based announcement email from the visual poster.

Pipeline:
  1. Render doc/portal-announcement-poster-offerings.html with headless Chrome.
  2. Measure the pixel bounds of each region (cards, jump strip, footer).
  3. Slice the 2x render into per-region PNGs in
     react-portal/public/posters/offerings/.

The email layout (portal-offerings-email.html) is a hand-maintained table that
references these slices; re-run this whenever the poster's layout changes. If a
region's vertical position shifts a lot, double-check the slice alignment.

Requirements: google-chrome (or chromium) on PATH, Pillow.
Usage: python scripts/build_poster_email.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTER = os.path.join(ROOT, "doc/portal-announcement-poster-offerings.html")
OUTDIR = os.path.join(ROOT, "react-portal/public/posters/offerings")
SCALE = 2

# Force a pure-white background for the email render (the web poster keeps its
# subtle gray gradient + grid; only the emailed image is flattened to white).
WHITE_OVERRIDE = """<style>
  body, .poster { background: #ffffff !important; }
  .poster::before { display: none !important; }
</style>
</head>"""

PROBE_JS = """
<div id="__rects__"></div>
<script>
(function(){
  function r(sel,i){var e=document.querySelectorAll(sel)[i||0];if(!e)return null;var b=e.getBoundingClientRect();return{t:Math.round(b.top),b:Math.round(b.bottom),l:Math.round(b.left),r:Math.round(b.right)};}
  var d={poster:r('.poster'),label:r('.section-label'),c0:r('.feature-card',0),c1:r('.feature-card',1),c2:r('.feature-card',2),c3:r('.feature-card',3),jump:r('.jump'),footer:r('.footer'),width:Math.round(document.querySelector('.poster').getBoundingClientRect().width)};
  document.getElementById('__rects__').setAttribute('data-r',JSON.stringify(d));
})();
</script>
</body>"""


def chrome():
    for c in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(c):
            return c
    sys.exit("No Chrome/Chromium found on PATH")


def run_chrome(args):
    subprocess.run([chrome(), "--headless", "--disable-gpu", "--no-sandbox",
                    "--hide-scrollbars", *args],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def measure():
    html = open(POSTER, encoding="utf-8").read().replace("</body>", PROBE_JS)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(html)
        probe = f.name
    out = subprocess.run([chrome(), "--headless", "--disable-gpu", "--no-sandbox",
                          "--virtual-time-budget=2000", "--dump-dom", f"file://{probe}"],
                         capture_output=True, text=True).stdout
    os.unlink(probe)
    m = re.search(r'data-r="([^"]+)"', out)
    if not m:
        sys.exit("Could not measure poster regions")
    return json.loads(m.group(1).replace("&quot;", '"'))


def main():
    r = measure()
    H = r["poster"]["b"]
    W = r["width"]
    xmid = (r["c0"]["r"] + r["c1"]["l"]) // 2          # column split (≈ W/2)
    y_top = (r["label"]["b"] + r["c0"]["t"]) // 2       # top region / row1
    y_mid = (r["c0"]["b"] + r["c2"]["t"]) // 2          # row1 / row2
    y_cards = (r["c2"]["b"] + r["jump"]["t"]) // 2      # cards / jump
    y_jump = (r["jump"]["b"] + r["footer"]["t"]) // 2   # jump / footer

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        shot = f.name
    # Render from a temp copy with the white-background override applied.
    white_html = open(POSTER, encoding="utf-8").read().replace("</head>", WHITE_OVERRIDE)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(white_html)
        render_src = f.name
    run_chrome([f"--force-device-scale-factor={SCALE}", f"--window-size={W},{H}",
                "--default-background-color=FFFFFFFF",
                f"--screenshot={shot}", f"file://{render_src}"])
    os.unlink(render_src)

    from PIL import Image
    im = Image.open(shot).convert("RGB")
    os.makedirs(OUTDIR, exist_ok=True)
    s = SCALE

    def cut(x0, y0, x1, y1, name):
        im.crop((x0 * s, y0 * s, x1 * s, y1 * s)).save(
            os.path.join(OUTDIR, f"{name}.png"), optimize=True)
        print(f"  {name}.png  ({x0},{y0})-({x1},{y1})")

    cut(0, 0, W, y_top, "band-top")
    cut(0, y_top, xmid, y_mid, "row1-left")
    cut(xmid, y_top, W, y_mid, "row1-right")
    cut(0, y_mid, xmid, y_cards, "row2-left")
    cut(xmid, y_mid, W, y_cards, "row2-right")
    cut(0, y_cards, W, y_jump, "jump")
    cut(0, y_jump, W, H, "footer")
    os.unlink(shot)
    print(f"Done — slices written to {OUTDIR}")


if __name__ == "__main__":
    main()
