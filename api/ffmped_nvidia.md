# FFmpeg: Blue Background Border with Rounded Corners

Add a blue background border to recorded video with the video embedded inside with rounded corners.

---

## Method 1: FFmpeg + ImageMagick Mask (Recommended)

Clean, fast, GPU-encodable. Generate the mask once and reuse for all videos.

### Step 1 — Generate rounded corner mask (run once)

```bash
convert -size 1520x855 xc:none \
  -draw "roundrectangle 0,0,1519,854,40,40" \
  -alpha set mask.png
```

### Step 2 — Apply blue border + rounded corners via FFmpeg

```bash
ffmpeg -i input.mp4 -i mask.png \
  -filter_complex "
    color=0x1E40AF:size=1920x1080[bg];
    [0:v]scale=1520:855[scaled];
    [scaled][1:v]alphamerge[rounded];
    [bg][rounded]overlay=200:112:format=auto
  " \
  -c:v h264_nvenc -preset p4 \
  -pix_fmt yuv420p output.mp4
```

### Parameters

| Parameter | Value | Description |
|---|---|---|
| Background color | `0x1E40AF` | Blue (Tailwind blue-800) |
| Canvas size | `1920x1080` | Output frame size |
| Video size | `1520x855` | Inner video size (80px padding each side) |
| Overlay position | `200:112` | X:Y offset to center video on canvas |
| Corner radius | `40` | Rounded corner radius in pixels |
| Encoder | `h264_nvenc` | NVIDIA GPU encoder |
| Preset | `p4` | Balanced speed/quality |

---

## Method 2: FFmpeg geq Alpha (No ImageMagick dependency)

Slower per-frame approach, no external dependency needed.

```bash
ffmpeg -i input.mp4 \
  -vf "
    color=0x1E40AF:size=1920x1080[bg];
    [0:v]scale=1520:855,
         geq=lum='p(X,Y)':
              cb='p(X,Y)':
              cr='p(X,Y)':
              a='if(gt(min(min(X,W-X),min(Y,H-Y)),30),255,0)'[rounded];
    [bg][rounded]overlay=200:112
  " \
  -c:v h264_nvenc -preset p4 output.mp4
```

> **Note:** The `geq` alpha trick is slow and CPU-bound per frame. Use Method 1 for batch processing.

---

## Method 3: Python + MoviePy + Pillow

Best for integration into a FastAPI or Python-based preprocessing pipeline.

### Install dependencies

```bash
pip install moviepy pillow --break-system-packages
```

### Script

```python
from moviepy.editor import VideoFileClip, ColorClip, CompositeVideoClip
from PIL import Image, ImageDraw
import numpy as np

def make_rounded_mask(size: tuple, radius: int) -> np.ndarray:
    """Generate a rounded rectangle alpha mask."""
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size[0], size[1]], radius=radius, fill=255)
    return np.array(mask) / 255.0

def apply_blue_border(input_path: str, output_path: str,
                       canvas_size=(1920, 1080),
                       inner_size=(1520, 855),
                       offset=(200, 112),
                       corner_radius=40,
                       bg_color=(30, 64, 175)):  # Tailwind blue-800
    clip = VideoFileClip(input_path).resize(inner_size)
    bg = ColorClip(size=canvas_size, color=bg_color, duration=clip.duration)

    mask_arr = make_rounded_mask(inner_size, radius=corner_radius)
    clip = clip.set_mask(
        clip.to_mask().fl_image(lambda f: mask_arr)
    )

    final = CompositeVideoClip([bg, clip.set_position(offset)])
    final.write_videofile(output_path, codec="libx264", fps=clip.fps)

# Usage
apply_blue_border("input.mp4", "output.mp4")
```

---

## Method 4: OBS Studio (Live Recording)

For capturing AI Ignite content live — no post-processing needed.

1. Add screen capture or webcam as a **Source**
2. Add a **Color Source** with hex `#1E40AF` as background layer (below video source)
3. Right-click video source → **Filters** → add **Crop/Pad**
4. Add **Corner Rounding** filter (OBS 30+)
5. Set corner radius to taste

---

## Batch Processing Script (FFmpeg + ImageMagick)

Process all `.mp4` files in a directory with GPU acceleration.

```bash
#!/bin/bash

INPUT_DIR="./raw"
OUTPUT_DIR="./processed"
MASK="./mask.png"

CANVAS_W=1920
CANVAS_H=1080
INNER_W=1520
INNER_H=855
OFFSET_X=200
OFFSET_Y=112
CORNER_RADIUS=40
BG_COLOR="0x1E40AF"

# Generate mask once
echo "Generating rounded corner mask..."
convert -size ${INNER_W}x${INNER_H} xc:none \
  -draw "roundrectangle 0,0,$((INNER_W-1)),$((INNER_H-1)),${CORNER_RADIUS},${CORNER_RADIUS}" \
  -alpha set "$MASK"

mkdir -p "$OUTPUT_DIR"

# Process all mp4 files
for INPUT in "$INPUT_DIR"/*.mp4; do
  FILENAME=$(basename "$INPUT")
  OUTPUT="$OUTPUT_DIR/$FILENAME"
  echo "Processing: $FILENAME"

  ffmpeg -y \
    -hwaccel cuda -hwaccel_output_format cuda \
    -i "$INPUT" -i "$MASK" \
    -filter_complex "
      color=${BG_COLOR}:size=${CANVAS_W}x${CANVAS_H}[bg];
      [0:v]scale_cuda=${INNER_W}:${INNER_H}[scaled];
      [scaled]hwdownload,format=yuva420p[dl];
      [dl][1:v]alphamerge[rounded];
      [bg]hwdownload,format=yuv420p[bgcpu];
      [bgcpu][rounded]overlay=${OFFSET_X}:${OFFSET_Y}:format=auto[out]
    " \
    -map "[out]" -map 0:a? \
    -c:v h264_nvenc -preset p4 -cq 23 \
    -c:a copy \
    "$OUTPUT"

  echo "Done: $OUTPUT"
done

echo "All videos processed."
```

---

## Combining with Title Card Prepend

If you're already prepending title cards (e.g. for AI Ignite episodes), chain both operations in a single FFmpeg pass:

```bash
ffmpeg -y \
  -loop 1 -t 3 -i titlecard.png \
  -i main_video.mp4 \
  -i mask.png \
  -filter_complex "
    color=0x1E40AF:size=1920x1080[bg];

    [0:v]scale=1520:855,format=yuva420p[title_scaled];
    [title_scaled][2:v]alphamerge[title_rounded];
    [bg][title_rounded]overlay=200:112:format=auto[title_frame];

    [1:v]scale=1520:855[main_scaled];
    [main_scaled][2:v]alphamerge[main_rounded];
    [bg][main_rounded]overlay=200:112:format=auto[main_frame];

    [title_frame][main_frame]concat=n=2:v=1:a=0[outv]
  " \
  -map "[outv]" -map 1:a? \
  -c:v h264_nvenc -preset p4 -cq 23 \
  -c:a copy \
  final_output.mp4
```

---

## Method Comparison

| Method | Rounded Corners | GPU Encode | Batch-friendly | Dependency | Complexity |
|---|---|---|---|---|---|
| FFmpeg + ImageMagick mask | ✅ Clean | ✅ NVENC | ✅ | ImageMagick | Low |
| FFmpeg `geq` alpha | ⚠️ Slow | ✅ NVENC | ✅ | None | Medium |
| OBS Studio | ✅ Native | ✅ | ❌ Live only | OBS 30+ | Very Low |
| Python + MoviePy | ✅ Flexible | ❌ CPU only | ✅ | moviepy, pillow | Medium |

---

## FFmpeg GPU Acceleration (NVENC/CUDA)

### How it works

FFmpeg GPU acceleration has two independent components:

| Component | Role | Flag |
|---|---|---|
| **NVDEC** | Hardware video decode | `-hwaccel cuda` |
| **NVENC** | Hardware video encode | `-c:v h264_nvenc` |
| **CUDA filters** | GPU-side scaling/processing | `scale_cuda`, `hwupload`, `hwdownload` |

The goal is to keep frames in GPU VRAM the entire pipeline — decode → filter → encode — avoiding costly CPU↔GPU transfers.

---

### Basic GPU encode only (fastest to adopt)

```bash
ffmpeg -i input.mp4 \
  -c:v h264_nvenc -preset p4 -cq 23 \
  -c:a copy \
  output.mp4
```

---

### Full GPU pipeline (decode + encode, frames stay in VRAM)

```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda \
  -i input.mp4 \
  -vf "scale_cuda=1920:1080" \
  -c:v h264_nvenc -preset p4 -cq 23 \
  -c:a copy \
  output.mp4
```

> `-hwaccel_output_format cuda` keeps decoded frames in VRAM. Without it, frames are downloaded to RAM after decode, losing most of the benefit.

---

### GPU pipeline with alpha mask (rounded borders use case)

Alpha compositing (`alphamerge`, `overlay`) has no CUDA equivalent, so frames must briefly touch CPU for that step. Use `hwdownload`/`hwupload` to explicitly manage the transfer:

```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda \
  -i input.mp4 -i mask.png \
  -filter_complex "
    color=0x1E40AF:size=1920x1080[bg];
    [0:v]scale_cuda=1520:855[scaled];
    [scaled]hwdownload,format=yuva420p[dl];
    [dl][1:v]alphamerge[rounded];
    [bg]hwdownload,format=yuv420p[bgcpu];
    [bgcpu][rounded]overlay=200:112:format=auto[composited];
    [composited]hwupload[out]
  " \
  -map "[out]" -map 0:a? \
  -c:v h264_nvenc -preset p4 -cq 23 \
  -c:a copy \
  output.mp4
```

---

### NVENC encoder options

#### Codec selection

```bash
-c:v h264_nvenc    # H.264 — widest compatibility
-c:v hevc_nvenc    # H.265/HEVC — better compression
-c:v av1_nvenc     # AV1 — best compression (RTX 4000+ / Ada+)
```

#### Preset (`p1`–`p7`)

```bash
-preset p1   # Fastest, lowest quality
-preset p4   # Balanced (recommended for batch)
-preset p6   # High quality, slower
-preset p7   # Best quality (near-lossless)
```

#### Quality control

```bash
-cq 23        # Constant quality mode (like CRF). Lower = better. Range: 0–51
-b:v 5M       # Constant bitrate mode (use instead of -cq for streaming targets)
-maxrate 8M   # Max bitrate cap (use with -bufsize for VBR)
-bufsize 16M
```

#### Multi-instance (RTX 5090 has 3 NVENC engines)

Run 3 parallel encodes simultaneously without bottlenecking:

```bash
# Terminal 1
ffmpeg -hwaccel cuda -i ep1.mp4 -c:v h264_nvenc -preset p4 out1.mp4 &

# Terminal 2
ffmpeg -hwaccel cuda -i ep2.mp4 -c:v h264_nvenc -preset p4 out2.mp4 &

# Terminal 3
ffmpeg -hwaccel cuda -i ep3.mp4 -c:v h264_nvenc -preset p4 out3.mp4 &

wait
echo "All done"
```

---

### Verify GPU is being used

```bash
# Check available hwaccels
ffmpeg -hwaccels | grep cuda

# Check available NVENC encoders
ffmpeg -encoders | grep nvenc

# Monitor GPU utilization during encode
watch -n 1 nvidia-smi

# Or use nvtop for a better view
sudo apt install nvtop && nvtop
```

During encoding you should see:
- **Enc %** column in `nvidia-smi` climbing (NVENC engine active)
- **Dec %** column climbing if using `-hwaccel cuda` (NVDEC active)
- GPU memory usage increasing (frames in VRAM)

---

### RTX 5090 specific notes

| Feature | Detail |
|---|---|
| NVENC engines | 3× (can run 3 parallel encodes) |
| NVDEC engines | 2× |
| NVENC generation | 9th gen (Ada+) |
| AV1 encode | ✅ Supported |
| H.264 10-bit decode | ✅ Supported (new in 6th gen NVDEC) |
| SM version | SM_100 (Blackwell) |
| CUDA graph issue | Only affects PyTorch — **not FFmpeg/NVENC** |

> The SM_100 CUDA graph limitation (requiring `--enforce-eager` in vLLM) does **not** affect FFmpeg. NVENC/NVDEC are dedicated fixed-function engines on the chip, independent of CUDA cores and PyTorch.

---

## Dependencies Summary

```bash
# ImageMagick (for mask generation)
sudo apt install imagemagick

# FFmpeg with NVENC (Ubuntu 24.04)
sudo apt install ffmpeg

# Verify NVENC is available
ffmpeg -encoders | grep nvenc
ffmpeg -hwaccels | grep cuda

# GPU utilization monitoring
sudo apt install nvtop

# Python dependencies (optional, for MoviePy method)
pip install moviepy pillow --break-system-packages
```