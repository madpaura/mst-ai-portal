"""Tests for transcoder timeout and shutdown handling (#48, #49)."""
import sys
import os
import subprocess
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# GPU detection args mock — avoids subprocess calls to nvidia-smi
_GPU_INFO = {"gpu_available": False, "gpu_name": ""}
_HWACCEL_ARGS = []
_ENCODE_ARGS = ["-c:v", "libx264"]


def _ffmpeg_patches():
    """Common set of patches needed to exercise run_ffmpeg without real tools."""
    return [
        patch("worker.transcoder.get_gpu_info", return_value=_GPU_INFO),
        patch("worker.transcoder.get_hwaccel_args", return_value=_HWACCEL_ARGS),
        patch("worker.transcoder.get_encode_args", return_value=_ENCODE_ARGS),
        patch("os.makedirs"),
    ]


class TestFFmpegTimeout:
    def test_timeout_returns_false(self):
        """run_ffmpeg returns False when FFmpeg times out."""
        import worker.transcoder as transcoder

        mock_proc = MagicMock()
        mock_proc.communicate.side_effect = subprocess.TimeoutExpired(cmd="ffmpeg", timeout=1)

        with patch("worker.transcoder.subprocess.Popen", return_value=mock_proc):
            for p in _ffmpeg_patches():
                p.start()
            try:
                result = transcoder.run_ffmpeg("/input.mp4", "/output", "720p", 23)
            finally:
                for p in _ffmpeg_patches():
                    try:
                        p.stop()
                    except RuntimeError:
                        pass

        assert result is False
        mock_proc.kill.assert_called_once()
        mock_proc.wait.assert_called_once()

    def test_ffmpeg_error_returncode_returns_false(self):
        """run_ffmpeg returns False when FFmpeg exits with non-zero code."""
        import worker.transcoder as transcoder

        mock_proc = MagicMock()
        mock_proc.communicate.return_value = (b"", b"FFmpeg error")
        mock_proc.returncode = 1

        with patch("worker.transcoder.subprocess.Popen", return_value=mock_proc), \
             patch("worker.transcoder.get_gpu_info", return_value=_GPU_INFO), \
             patch("worker.transcoder.get_hwaccel_args", return_value=_HWACCEL_ARGS), \
             patch("worker.transcoder.get_encode_args", return_value=_ENCODE_ARGS), \
             patch("os.makedirs"):
            result = transcoder.run_ffmpeg("/input.mp4", "/output", "720p", 23)

        assert result is False

    def test_ffmpeg_success_returns_true(self):
        """run_ffmpeg returns True on successful transcode."""
        import worker.transcoder as transcoder

        mock_proc = MagicMock()
        mock_proc.communicate.return_value = (b"", b"")
        mock_proc.returncode = 0

        with patch("worker.transcoder.subprocess.Popen", return_value=mock_proc), \
             patch("worker.transcoder.get_gpu_info", return_value=_GPU_INFO), \
             patch("worker.transcoder.get_hwaccel_args", return_value=_HWACCEL_ARGS), \
             patch("worker.transcoder.get_encode_args", return_value=_ENCODE_ARGS), \
             patch("os.makedirs"):
            result = transcoder.run_ffmpeg("/input.mp4", "/output", "720p", 23)

        assert result is True

    def test_thumbnail_timeout_does_not_raise(self):
        """generate_thumbnail swallows timeout without propagating."""
        import worker.transcoder as transcoder

        with patch("worker.transcoder.subprocess.run",
                   side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=120)):
            transcoder.generate_thumbnail("/input.mp4", "/output/thumb.jpg")

    def test_get_duration_timeout_returns_none(self):
        """get_duration returns None on timeout."""
        import worker.transcoder as transcoder

        with patch("worker.transcoder.subprocess.run",
                   side_effect=subprocess.TimeoutExpired(cmd="ffprobe", timeout=60)):
            result = transcoder.get_duration("/input.mp4")

        assert result is None


class TestGracefulShutdown:
    def test_shutdown_flag_terminates_active_proc(self):
        """Signal handler sets _shutdown and terminates active FFmpeg process."""
        import worker.transcoder as transcoder

        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # process is running

        transcoder._shutdown.clear()
        transcoder._active_proc = mock_proc

        transcoder._handle_shutdown(15, None)

        assert transcoder._shutdown.is_set()
        mock_proc.terminate.assert_called_once()

        transcoder._shutdown.clear()
        transcoder._active_proc = None

    def test_shutdown_flag_skips_terminate_when_proc_gone(self):
        """Signal handler does not call terminate if process already finished."""
        import worker.transcoder as transcoder

        mock_proc = MagicMock()
        mock_proc.poll.return_value = 0  # process already exited

        transcoder._shutdown.clear()
        transcoder._active_proc = mock_proc

        transcoder._handle_shutdown(15, None)

        assert transcoder._shutdown.is_set()
        mock_proc.terminate.assert_not_called()

        transcoder._shutdown.clear()
        transcoder._active_proc = None
