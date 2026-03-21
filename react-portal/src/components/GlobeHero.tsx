import React, { useMemo } from 'react';

/**
 * SVG wireframe globe with scattered data points.
 * Inspired by the Anthropic newsroom hero image.
 */

// Convert lat/lng to orthographic projection (x, y, visible)
function project(lat: number, lng: number, cx: number, cy: number, r: number, rotLng: number): [number, number, boolean] {
  const φ = (lat * Math.PI) / 180;
  const λ = ((lng - rotLng) * Math.PI) / 180;
  const x = cx + r * Math.cos(φ) * Math.sin(λ);
  const y = cy - r * Math.sin(φ);
  const visible = Math.cos(φ) * Math.cos(λ) > 0;
  return [x, y, visible];
}

// Generate meridian/parallel arc paths
function gridPaths(cx: number, cy: number, r: number, rotLng: number): string[] {
  const paths: string[] = [];

  // Meridians every 30°
  for (let lng = -180; lng < 180; lng += 30) {
    let d = '';
    for (let lat = -90; lat <= 90; lat += 2) {
      const [x, y, vis] = project(lat, lng, cx, cy, r, rotLng);
      if (!vis) { d += ' '; continue; }
      d += (d.trim().length === 0 || d.endsWith(' ')) ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`;
    }
    paths.push(d);
  }

  // Parallels every 20°
  for (let lat = -80; lat <= 80; lat += 20) {
    let d = '';
    for (let lng = -180; lng <= 180; lng += 2) {
      const [x, y, vis] = project(lat, lng, cx, cy, r, rotLng);
      if (!vis) { d += ' '; continue; }
      d += (d.trim().length === 0 || d.endsWith(' ')) ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`;
    }
    paths.push(d);
  }

  return paths;
}

// Simplified continent outlines (very rough polygons for silhouette)
const CONTINENT_POINTS: [number, number][][] = [
  // North America
  [
    [50, -130], [55, -120], [60, -110], [65, -100], [60, -90], [55, -80],
    [50, -70], [45, -65], [40, -70], [35, -75], [30, -80], [25, -85],
    [20, -90], [15, -95], [20, -100], [25, -105], [30, -110], [35, -115],
    [40, -120], [45, -125],
  ],
  // South America
  [
    [10, -75], [5, -77], [0, -78], [-5, -75], [-10, -70], [-15, -65],
    [-20, -60], [-25, -55], [-30, -52], [-35, -55], [-40, -62], [-45, -65],
    [-50, -68], [-52, -70], [-48, -73], [-40, -72], [-30, -68], [-20, -65],
    [-10, -68], [-5, -72], [0, -75], [5, -75],
  ],
  // Europe
  [
    [40, -5], [42, 0], [45, 5], [48, 8], [50, 10], [52, 12],
    [55, 15], [58, 18], [60, 20], [62, 25], [60, 30], [55, 28],
    [50, 25], [48, 20], [45, 15], [42, 12], [40, 8], [38, 5],
    [36, 0],
  ],
  // Africa
  [
    [35, -5], [30, -10], [25, -15], [20, -17], [15, -16], [10, -14],
    [5, -10], [0, -5], [-5, 10], [-10, 20], [-15, 28], [-20, 32],
    [-25, 30], [-30, 28], [-33, 25], [-34, 20], [-30, 15], [-25, 12],
    [-15, 10], [-5, 5], [0, 0], [5, -5], [10, -8], [15, -10],
    [20, -12], [25, -10], [30, -5],
  ],
  // Asia (simplified)
  [
    [55, 40], [58, 50], [60, 60], [58, 70], [55, 80], [50, 90],
    [45, 100], [40, 110], [35, 115], [30, 110], [25, 105],
    [20, 100], [15, 95], [10, 100], [5, 105], [0, 110],
    [5, 115], [10, 120], [15, 118], [20, 115], [25, 110],
    [30, 105], [35, 100], [40, 90], [45, 80], [50, 70],
    [55, 60], [58, 50],
  ],
  // Australia
  [
    [-15, 130], [-18, 125], [-22, 120], [-25, 118], [-28, 120],
    [-32, 125], [-35, 130], [-38, 145], [-35, 150], [-30, 152],
    [-25, 148], [-20, 145], [-15, 140], [-12, 135],
  ],
];

// Scatter data points — weighted toward populated areas
const DATA_POINTS: [number, number][] = [];
function seedPoints() {
  // Seed-based pseudo random
  let s = 42;
  const rand = () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };

  const clusters: [number, number, number, number, number][] = [
    // [centerLat, centerLng, spread, count, weight]
    [40, -100, 20, 40, 1],    // North America
    [48, 10, 12, 35, 1],      // Europe
    [35, 100, 15, 25, 1],     // East Asia
    [20, 78, 10, 18, 1],      // India
    [-15, -50, 15, 15, 1],    // South America
    [5, 30, 15, 10, 1],       // Africa
    [-28, 135, 10, 8, 1],     // Australia
    [35, 135, 8, 12, 1],      // Japan
    [55, 40, 12, 10, 1],      // Russia
    [25, -80, 5, 8, 1],       // Florida/Caribbean
    [52, -2, 5, 12, 1],       // UK
  ];

  for (const [cLat, cLng, spread, count] of clusters) {
    for (let i = 0; i < count; i++) {
      const lat = cLat + (rand() - 0.5) * spread * 2;
      const lng = cLng + (rand() - 0.5) * spread * 2;
      DATA_POINTS.push([lat, lng]);
    }
  }
}
seedPoints();

interface GlobeHeroProps {
  className?: string;
}

export const GlobeHero: React.FC<GlobeHeroProps> = ({ className = '' }) => {
  const cx = 500;
  const cy = 500;
  const r = 440;
  const rotLng = 30; // rotation to show Americas + Europe

  const grid = useMemo(() => gridPaths(cx, cy, r, rotLng), []);

  const continentPaths = useMemo(() => {
    return CONTINENT_POINTS.map((pts) => {
      let d = '';
      let started = false;
      for (const [lat, lng] of pts) {
        const [x, y, vis] = project(lat, lng, cx, cy, r, rotLng);
        if (!vis) continue;
        d += started ? `L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
        started = true;
      }
      if (started) d += 'Z';
      return d;
    });
  }, []);

  const dots = useMemo(() => {
    return DATA_POINTS.map(([lat, lng], i) => {
      const [x, y, vis] = project(lat, lng, cx, cy, r, rotLng);
      if (!vis) return null;
      return { x, y, i };
    }).filter(Boolean) as { x: number; y: number; i: number }[];
  }, []);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <svg
        viewBox="0 0 1000 1000"
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Globe circle */}
        <circle cx={cx} cy={cy} r={r} className="fill-slate-100/60 dark:fill-slate-800/40 stroke-slate-300 dark:stroke-slate-700" strokeWidth="1.5" />

        {/* Grid lines */}
        {grid.map((d, i) => (
          <path
            key={`g${i}`}
            d={d}
            fill="none"
            className="stroke-slate-300/60 dark:stroke-slate-600/40"
            strokeWidth="0.7"
          />
        ))}

        {/* Continent silhouettes */}
        {continentPaths.map((d, i) => (
          <path
            key={`c${i}`}
            d={d}
            className="fill-slate-200/50 dark:fill-slate-700/30 stroke-slate-400/50 dark:stroke-slate-500/30"
            strokeWidth="1"
          />
        ))}

        {/* Data points — green/teal dots */}
        {dots.map(({ x, y, i }) => (
          <g key={`d${i}`}>
            <circle cx={x} cy={y} r="5" className="fill-emerald-400/20" />
            <circle cx={x} cy={y} r="2.5" className="fill-emerald-500 dark:fill-emerald-400" opacity="0.7" />
          </g>
        ))}

        {/* Subtle highlight on top-left */}
        <circle cx={cx - 120} cy={cy - 120} r="250" fill="white" opacity="0.04" />
      </svg>
    </div>
  );
};
