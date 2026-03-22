"""
GPU Detection for FFmpeg NVENC Acceleration

Probes the system at startup to determine if NVIDIA GPU encoding is available.
Falls back gracefully to CPU (libx264) if not.
"""
import subprocess
import os
import functools


@functools.lru_cache(maxsize=1)
def detect_nvenc() -> dict:
    """
    Detect NVIDIA GPU and NVENC encoder availability.

    Returns a dict with:
        gpu_available: bool — True if h264_nvenc encoder is usable
        gpu_name: str | None — GPU model name from nvidia-smi
        hwaccel_args: list — FFmpeg input args for CUDA hw decode (empty if CPU)
        encoder: str — 'h264_nvenc' or 'libx264'
        preset: str — encoder preset appropriate for the backend
        quality_flag: str — '-cq' for NVENC, '-crf' for libx264
    """
    ffmpeg_path = os.environ.get("FFMPEG_PATH", "ffmpeg")

    info = {
        "gpu_available": False,
        "gpu_name": None,
        "hwaccel_args": [],
        "encoder": "libx264",
        "preset": "fast",
        "quality_flag": "-crf",
    }

    # Allow explicit override: FFMPEG_HWACCEL=none disables GPU
    if os.environ.get("FFMPEG_HWACCEL", "").lower() == "none":
        print("[gpu] GPU acceleration explicitly disabled via FFMPEG_HWACCEL=none")
        return info

    # Step 1: Check if nvidia-smi is present (GPU driver loaded)
    try:
        smi = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if smi.returncode != 0:
            print("[gpu] nvidia-smi not available — falling back to CPU encoding")
            return info
        info["gpu_name"] = smi.stdout.strip().split("\n")[0]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("[gpu] nvidia-smi not found — falling back to CPU encoding")
        return info

    # Step 2: Check if ffmpeg has h264_nvenc encoder
    try:
        enc = subprocess.run(
            [ffmpeg_path, "-encoders"],
            capture_output=True, text=True, timeout=10,
        )
        if "h264_nvenc" not in enc.stdout:
            print(f"[gpu] GPU '{info['gpu_name']}' found but ffmpeg lacks h264_nvenc — falling back to CPU")
            return info
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("[gpu] Could not query ffmpeg encoders — falling back to CPU")
        return info

    # Step 3: Check if CUDA hwaccel is available
    has_cuda = False
    try:
        hw = subprocess.run(
            [ffmpeg_path, "-hwaccels"],
            capture_output=True, text=True, timeout=10,
        )
        has_cuda = "cuda" in hw.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Step 4: Quick smoke test — try to actually encode a single frame
    try:
        test = subprocess.run(
            [
                ffmpeg_path, "-y",
                "-f", "lavfi", "-i", "color=black:s=64x64:d=0.1",
                "-c:v", "h264_nvenc", "-frames:v", "1",
                "-f", "null", "-",
            ],
            capture_output=True, text=True, timeout=10,
        )
        if test.returncode != 0:
            print(f"[gpu] NVENC smoke test failed — falling back to CPU")
            print(f"[gpu]   stderr: {test.stderr[-300:]}")
            return info
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("[gpu] NVENC smoke test timed out — falling back to CPU")
        return info

    # All checks passed
    info["gpu_available"] = True
    info["encoder"] = "h264_nvenc"
    info["preset"] = "p4"
    info["quality_flag"] = "-cq"

    if has_cuda:
        info["hwaccel_args"] = ["-hwaccel", "cuda"]

    print(f"[gpu] ✔ NVIDIA GPU acceleration enabled: {info['gpu_name']}")
    print(f"[gpu]   Encoder: h264_nvenc | Preset: p4 | CUDA hwaccel: {has_cuda}")
    return info


def get_encode_args(crf: int | None = None) -> list[str]:
    """
    Return FFmpeg encoder arguments based on GPU availability.

    Usage:
        cmd = [ffmpeg, "-y", "-i", input, "-vf", "scale=...",
               *get_encode_args(crf=23),
               "-c:a", "aac", ...]
    """
    gpu = detect_nvenc()
    args = ["-c:v", gpu["encoder"], "-preset", gpu["preset"]]
    if crf is not None:
        args += [gpu["quality_flag"], str(crf)]
    return args


def get_hwaccel_args() -> list[str]:
    """Return FFmpeg input-side hwaccel flags (empty list if no GPU)."""
    return detect_nvenc()["hwaccel_args"]


def get_gpu_info() -> dict:
    """Return GPU detection info (cached)."""
    return detect_nvenc()
