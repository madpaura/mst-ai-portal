import React from 'react';

/**
 * Video track row — a distinct slot in the timeline layout.
 *
 * This slice renders a placeholder strip only; a real filmstrip (extracted
 * thumbnails at fixed intervals) lands here in issue #257. Keeping it as its
 * own component means the filmstrip can drop in later without touching the
 * timeline's layout, lane alignment, or drag-select geometry.
 */
export const VideoTrackRow: React.FC = () => {
  return (
    <div className="relative h-14 bg-black border-b border-[#243043] overflow-hidden select-none">
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, #141B28 0, #141B28 92px, #0B0F17 92px, #0B0F17 94px)',
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[#5C6880] tracking-wide">
        Filmstrip preview lands in a later slice
      </div>
    </div>
  );
};
