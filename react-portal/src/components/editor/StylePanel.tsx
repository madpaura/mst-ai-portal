import React, { useRef, useState } from 'react';
import { api, toApiError } from '../../api/client';
import type { EditorStyle } from './types';
import {
  ALLOWED_BACKGROUND_IMAGE_TYPES,
  AUTO_PAD_PCT_ON_PRESET_PICK,
  AUTO_RADIUS_PX_ON_PRESET_PICK,
  MAX_BACKGROUND_IMAGE_BYTES,
  STYLE_PAD_MAX,
  STYLE_PAD_MIN,
  STYLE_PRESETS,
  STYLE_RADIUS_MAX,
  STYLE_RADIUS_MIN,
} from './stylePresets';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface StylePanelProps {
  videoId: string;
  style: EditorStyle;
  /** Called for a full-style change that should push an undo snapshot
   * first (preset pick, image upload/remove) — mirrors `toggleMuted` in
   * AdminVideoEditor.tsx. */
  onChange: (next: EditorStyle) => void;
  /** Called on every slider tick (no undo snapshot per-tick — matches the
   * mockup, which only snapshots on preset pick, not on drag). The caller
   * still autosaves on any style change via its existing debounced effect. */
  onLiveChange: (next: EditorStyle) => void;
}

interface BackgroundUploadResponse {
  path: string;
}

export const StylePanel: React.FC<StylePanelProps> = ({ videoId, style, onChange, onLiveChange }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handlePickPreset = (key: string) => {
    let next: EditorStyle = { ...style, preset: key };
    if (key !== 'none' && style.pad_pct === 0) {
      next = { ...next, pad_pct: AUTO_PAD_PCT_ON_PRESET_PICK, radius_px: AUTO_RADIUS_PX_ON_PRESET_PICK };
    }
    onChange(next);
  };

  const handlePadInput = (v: number) => onLiveChange({ ...style, pad_pct: v });
  const handleRadiusInput = (v: number) => onLiveChange({ ...style, radius_px: v });

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setUploadError(null);

    if (!ALLOWED_BACKGROUND_IMAGE_TYPES.includes(file.type)) {
      setUploadError('Use a JPG, PNG or WEBP image.');
      return;
    }
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      setUploadError('Image exceeds the 10 MB limit.');
      return;
    }

    setUploading(true);
    try {
      const res = await api.upload<BackgroundUploadResponse>(
        `/admin/videos/${videoId}/editor-background`,
        file,
      );
      onChange({ ...style, image: res.path });
    } catch (err) {
      setUploadError(toApiError(err));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = async () => {
    setUploadError(null);
    setUploading(true);
    try {
      await api.delete(`/admin/videos/${videoId}/editor-background`);
      onChange({ ...style, image: null });
    } catch (err) {
      setUploadError(toApiError(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="mb-5">
        <span className="block mb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-[#5C6880]">
          Background
        </span>
        <div className="grid grid-cols-3 gap-2">
          {STYLE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => handlePickPreset(p.key)}
              title={p.name}
              className={`relative rounded-[7px] border-2 cursor-pointer aspect-[16/10] ${
                style.preset === p.key ? 'border-primary' : 'border-[#243043]'
              }`}
              style={{ background: p.css }}
            >
              <span
                className="absolute bottom-[3px] left-1.5 text-[9.5px] font-semibold text-white/85"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,.7)' }}
              >
                {p.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <span className="block mb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-[#5C6880]">
          Frame
        </span>
        <div className="flex items-center gap-2.5 mb-3">
          <label htmlFor="style-pad" className="text-[12.5px] text-[#96A2B8] w-16 shrink-0">
            Padding
          </label>
          <input
            id="style-pad"
            type="range"
            min={STYLE_PAD_MIN}
            max={STYLE_PAD_MAX}
            value={style.pad_pct}
            onChange={(e) => handlePadInput(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="font-mono text-[11.5px] text-[#5C6880] w-9 text-right shrink-0">
            {style.pad_pct}%
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <label htmlFor="style-radius" className="text-[12.5px] text-[#96A2B8] w-16 shrink-0">
            Corners
          </label>
          <input
            id="style-radius"
            type="range"
            min={STYLE_RADIUS_MIN}
            max={STYLE_RADIUS_MAX}
            value={style.radius_px}
            onChange={(e) => handleRadiusInput(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="font-mono text-[11.5px] text-[#5C6880] w-9 text-right shrink-0">
            {style.radius_px}px
          </span>
        </div>
      </div>

      <div>
        <span className="block mb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-[#5C6880]">
          Custom image
        </span>
        {style.image ? (
          <div className="rounded-lg border border-[#243043] overflow-hidden">
            <div
              className="h-24 bg-center bg-cover"
              style={{ backgroundImage: `url(${API_BASE}${style.image})` }}
            />
            <div className="flex items-center justify-between px-2.5 py-2 bg-[#0F1520]">
              <span className="text-[11.5px] text-[#96A2B8]">Custom background</span>
              <button
                onClick={handleRemoveImage}
                disabled={uploading}
                className="text-[11.5px] font-medium text-[#F0564A] hover:bg-[#F0564A]/15 rounded px-2 py-1 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full text-center text-[12.5px] leading-relaxed text-[#5C6880] px-3 py-5 border border-dashed border-[#243043] rounded-lg hover:border-[#5C6880] disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload a background image'}
            <br />
            <span className="text-[11px]">JPG, PNG or WEBP · up to 10 MB</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelected}
          className="hidden"
        />
        {uploadError && <p className="mt-2 text-[11.5px] text-[#F0564A]">{uploadError}</p>}
      </div>
    </div>
  );
};
