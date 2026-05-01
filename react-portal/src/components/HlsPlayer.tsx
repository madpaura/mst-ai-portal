import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import Hls from 'hls.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

const fmtTime = (s: number): string => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

interface Chapter {
  id: string;
  title: string;
  start_time: number;
}

interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
}

export interface HlsPlayerHandle {
  getCurrentTime: () => number;
  seekTo: (time: number) => void;
  getDuration: () => number;
}

interface HlsPlayerProps {
  hlsPath: string | null;
  chapters?: Chapter[];
  captionsUrl?: string;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  className?: string;
  autoPlay?: boolean;
}

export const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(({
  hlsPath,
  chapters = [],
  captionsUrl,
  onTimeUpdate,
  className = '',
  autoPlay = false,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Quality
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1); // -1 = auto
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [ccEnabled, setCcEnabled] = useState(false);
  const [blobCaptionsUrl, setBlobCaptionsUrl] = useState<string | null>(null);
  const ccEnabledRef = useRef(ccEnabled);
  ccEnabledRef.current = ccEnabled;

  // Fetch VTT cross-origin and serve as a blob URL so <track> sees it as same-origin
  useEffect(() => {
    if (!captionsUrl) {
      setBlobCaptionsUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      return;
    }
    let objectUrl: string | null = null;
    fetch(captionsUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then(blob => { objectUrl = URL.createObjectURL(blob); setBlobCaptionsUrl(objectUrl); })
      .catch(() => setBlobCaptionsUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [captionsUrl]);

  // Apply mode when user toggles CC (tracks are already loaded at this point)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = ccEnabled ? 'showing' : 'hidden';
    }
  }, [ccEnabled]);

  // Called by <track onLoad> — fires when the track finishes loading, including on navigation
  const handleTrackLoad = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = ccEnabledRef.current ? 'showing' : 'hidden';
    }
  }, []);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime || 0,
    seekTo: (time: number) => {
      const video = videoRef.current;
      if (video) {
        video.currentTime = time;
        setCurrentTime(time);
      }
    },
    getDuration: () => videoRef.current?.duration || 0,
  }));

  const cacheBusterRef = useRef(Date.now());
  useEffect(() => { cacheBusterRef.current = Date.now(); }, [hlsPath]);
  const hlsUrl = hlsPath ? `${API_BASE}${hlsPath}?_t=${cacheBusterRef.current}` : null;

  // Attach video event listeners — called after media is ready
  const attachVideoListeners = useCallback((video: HTMLVideoElement) => {
    const handleTimeUpdate = () => {
      const t = video.currentTime;
      const d = video.duration || 0;
      setCurrentTime(t);
      setDuration(d);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
      if (onTimeUpdateRef.current && d > 0) {
        onTimeUpdateRef.current(t, d);
      }
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleLoadedMetadata = () => {
      setDuration(video.duration || 0);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    // If already has metadata, read it
    if (video.duration && !isNaN(video.duration)) {
      setDuration(video.duration);
    }

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, []);

  // Initialize HLS + bind events
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setQualityLevels([]);
    setCurrentQuality(-1);

    let cleanupListeners: (() => void) | null = null;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        cleanupListeners = attachVideoListeners(video);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        // Extract quality levels
        const levels: QualityLevel[] = data.levels.map((lvl: { height: number; bitrate: number }, idx: number) => ({
          index: idx,
          height: lvl.height,
          bitrate: lvl.bitrate,
        }));
        setQualityLevels(levels);
        // Default to highest quality
        if (levels.length > 0) {
          const highest = levels.reduce((a, b) => (a.height > b.height ? a : b));
          hls.currentLevel = highest.index;
          setCurrentQuality(highest.index);
        }
        if (autoPlay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError(`Playback error: ${data.type}`);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          }
        }
      });

      return () => {
        cleanupListeners?.();
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      cleanupListeners = attachVideoListeners(video);
      if (autoPlay) video.play().catch(() => {});

      return () => {
        cleanupListeners?.();
      };
    } else {
      setError('HLS playback not supported in this browser');
    }
  }, [hlsUrl, autoPlay, attachVideoListeners]);

  // Track current chapter
  useEffect(() => {
    if (chapters.length === 0) { setCurrentChapter(null); return; }
    const sorted = [...chapters].sort((a, b) => a.start_time - b.start_time);
    let active: Chapter | null = null;
    for (const ch of sorted) {
      if (currentTime >= ch.start_time) active = ch;
      else break;
    }
    setCurrentChapter(active);
  }, [currentTime, chapters]);

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    if (isPlaying) {
      hideControlsTimeout.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isPlaying]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * duration;
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const vol = parseFloat(e.target.value);
    video.volume = vol;
    setVolume(vol);
    if (vol === 0) { video.muted = true; setIsMuted(true); }
    else if (video.muted) { video.muted = false; setIsMuted(false); }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const setQuality = (levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = levelIndex; // -1 = auto
    setCurrentQuality(levelIndex);
    setShowQualityMenu(false);
  };

  const toggleCC = () => setCcEnabled(prev => !prev);

  const handlePrevChapter = useCallback(() => {
    if (chapters.length === 0 || !videoRef.current) return;
    const sorted = [...chapters].sort((a, b) => a.start_time - b.start_time);
    const currentIdx = sorted.reduce((acc, ch, i) => (ch.start_time <= currentTime ? i : acc), -1);
    const targetIdx = currentIdx > 0 ? currentIdx - 1 : 0;
    const t = sorted[targetIdx].start_time;
    videoRef.current.currentTime = t;
    setCurrentTime(t);
  }, [chapters, currentTime]);

  const handleNextChapter = useCallback(() => {
    if (chapters.length === 0 || !videoRef.current) return;
    const sorted = [...chapters].sort((a, b) => a.start_time - b.start_time);
    const currentIdx = sorted.reduce((acc, ch, i) => (ch.start_time <= currentTime ? i : acc), -1);
    if (currentIdx < sorted.length - 1) {
      const t = sorted[currentIdx + 1].start_time;
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  }, [chapters, currentTime]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  if (!hlsPath) {
    return (
      <div className={`w-full aspect-video bg-slate-100 dark:bg-slate-900 rounded-2xl flex items-center justify-center ${className}`}>
        <div className="text-center">
          <span className="material-symbols-outlined text-slate-300 dark:text-slate-700 text-7xl">videocam_off</span>
          <p className="text-slate-400 text-sm mt-2">Video not yet available</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full aspect-video bg-black rounded-2xl overflow-hidden ${className}`}
      onMouseMove={resetControlsTimer}
      onMouseLeave={() => { if (isPlaying) setShowControls(false); setShowQualityMenu(false); }}
      onClick={(e) => {
        // Close quality menu when clicking outside
        if (showQualityMenu && !(e.target as HTMLElement).closest('[data-quality-menu]')) {
          setShowQualityMenu(false);
        }
      }}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        playsInline
      >
        {blobCaptionsUrl && (
          <track
            kind="captions"
            src={blobCaptionsUrl}
            srcLang="en"
            label="English"
            onLoad={handleTrackLoad}
          />
        )}
      </video>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-30">
          <div className="text-center">
            <span className="material-symbols-outlined text-red-400 text-5xl">error</span>
            <p className="text-red-400 text-sm mt-2">{error}</p>
          </div>
        </div>
      )}

      {/* Big play button overlay when paused */}
      {!isPlaying && !error && duration > 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer z-10"
          onClick={togglePlay}
        >
          <div className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center shadow-xl hover:bg-primary transition-colors">
            <span className="material-symbols-outlined text-white text-3xl ml-1">play_arrow</span>
          </div>
        </div>
      )}

      {/* Initial play overlay (before first play, duration=0 means not loaded yet) */}
      {!isPlaying && !error && duration === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer z-10 bg-black/40"
          onClick={togglePlay}
        >
          <div className="w-20 h-20 rounded-full bg-primary/90 flex items-center justify-center shadow-xl hover:bg-primary transition-colors">
            <span className="material-symbols-outlined text-white text-4xl ml-1">play_arrow</span>
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 transition-opacity duration-300 z-20 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer group/progress relative mb-3 hover:h-2.5 transition-all"
          onClick={handleSeek}
        >
          <div className="absolute top-0 left-0 h-full bg-white/15 rounded-full transition-all" style={{ width: `${bufferedPct}%` }} />
          <div className="absolute top-0 left-0 h-full bg-primary rounded-full transition-[width] duration-100" style={{ width: `${progressPct}%` }} />
          {/* Chapter markers */}
          {chapters.map((ch) => {
            const pct = duration > 0 ? (ch.start_time / duration) * 100 : 0;
            return (
              <div
                key={ch.id}
                className="absolute top-0 w-0.5 h-full bg-yellow-400/80"
                style={{ left: `${pct}%` }}
                title={`${ch.title} (${fmtTime(ch.start_time)})`}
              />
            );
          })}
          {/* Scrubber */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-lg"
            style={{ left: `calc(${progressPct}% - 7px)` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button onClick={togglePlay} className="text-white hover:text-primary transition-colors">
              <span className="material-symbols-outlined text-2xl">
                {isPlaying ? 'pause' : 'play_arrow'}
              </span>
            </button>

            {/* Chapter navigation */}
            {chapters.length > 0 && (<>
              <button onClick={handlePrevChapter} className="text-white/70 hover:text-white transition-colors" title="Previous chapter">
                <span className="material-symbols-outlined text-xl">skip_previous</span>
              </button>
              <button onClick={handleNextChapter} className="text-white/70 hover:text-white transition-colors" title="Next chapter">
                <span className="material-symbols-outlined text-xl">skip_next</span>
              </button>
            </>)}

            {/* Volume */}
            <div className="flex items-center gap-1 group/vol">
              <button onClick={toggleMute} className="text-white/80 hover:text-white transition-colors">
                <span className="material-symbols-outlined text-xl">
                  {isMuted || volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
                </span>
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-0 group-hover/vol:w-16 transition-all duration-200 accent-primary h-1 cursor-pointer"
              />
            </div>

            {/* Time */}
            <span className="text-xs font-mono text-white/80">
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>

            {/* Current chapter badge */}
            {currentChapter && (
              <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-[10px] text-white/80 truncate max-w-[150px]">
                {currentChapter.title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Quality selector */}
            {qualityLevels.length > 1 && (
              <div className="relative" data-quality-menu>
                <button
                  onClick={() => setShowQualityMenu(!showQualityMenu)}
                  className="text-white/80 hover:text-white transition-colors"
                  title="Video quality"
                >
                  <span className="material-symbols-outlined text-xl">settings</span>
                </button>
                {showQualityMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-slate-900/95 border border-white/20 rounded-lg shadow-xl py-1 min-w-[140px] z-50">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/10">
                      Quality
                    </div>
                    <button
                      onClick={() => setQuality(-1)}
                      className={`w-full px-3 py-1.5 text-sm text-left hover:bg-white/10 transition-colors flex items-center justify-between ${currentQuality === -1 ? 'text-primary font-bold' : 'text-white'}`}
                    >
                      Auto
                      {currentQuality === -1 && <span className="material-symbols-outlined text-sm">check</span>}
                    </button>
                    {qualityLevels
                      .sort((a, b) => b.height - a.height)
                      .map((level) => (
                        <button
                          key={level.index}
                          onClick={() => setQuality(level.index)}
                          className={`w-full px-3 py-1.5 text-sm text-left hover:bg-white/10 transition-colors flex items-center justify-between ${currentQuality === level.index ? 'text-primary font-bold' : 'text-white'}`}
                        >
                          {level.height}p
                          {currentQuality === level.index && <span className="material-symbols-outlined text-sm">check</span>}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Closed Captions toggle */}
            {captionsUrl && (
              <button
                onClick={toggleCC}
                className={`transition-colors text-xl font-bold px-1 rounded ${ccEnabled ? 'text-primary' : 'text-white/60 hover:text-white'}`}
                title={ccEnabled ? 'Hide captions' : 'Show captions'}
              >
                <span className="material-symbols-outlined text-xl">closed_caption</span>
              </button>
            )}

            {/* Fullscreen */}
            <button onClick={toggleFullscreen} className="text-white/80 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-xl">
                {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

HlsPlayer.displayName = 'HlsPlayer';
