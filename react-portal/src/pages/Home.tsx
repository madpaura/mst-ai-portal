import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';
import { usePageView } from '../hooks/usePageView';
import { useVisibleCatalogTypes } from '../hooks/useCatalogTypes';

interface HomeStats {
  videos: number;
  courses: number;
  articles: number;
  solutions: number;
  memes: number;
  news_total: number;
  news_today: number;
  marketplace: Record<string, number>;
}

// Per-tile accent hues. Tailwind needs literal class names, so each hue is a
// full set of pre-built classes rather than a computed string.
const HUES = {
  amber: {
    icon: 'bg-amber-500/10 text-amber-500',
    border: 'hover:border-amber-400/50',
    arrow: 'group-hover:text-amber-500',
    count: 'text-amber-500',
  },
  emerald: {
    icon: 'bg-emerald-500/10 text-emerald-500',
    border: 'hover:border-emerald-400/50',
    arrow: 'group-hover:text-emerald-500',
    count: 'text-emerald-500',
  },
  violet: {
    icon: 'bg-violet-500/10 text-violet-500',
    border: 'hover:border-violet-400/50',
    arrow: 'group-hover:text-violet-500',
    count: 'text-violet-500',
  },
  cyan: {
    icon: 'bg-cyan-500/10 text-cyan-500',
    border: 'hover:border-cyan-400/50',
    arrow: 'group-hover:text-cyan-500',
    count: 'text-cyan-500',
  },
  rose: {
    icon: 'bg-rose-500/10 text-rose-500',
    border: 'hover:border-rose-400/50',
    arrow: 'group-hover:text-rose-500',
    count: 'text-rose-500',
  },
  yellow: {
    icon: 'bg-yellow-500/10 text-yellow-500',
    border: 'hover:border-yellow-400/50',
    arrow: 'group-hover:text-yellow-500',
    count: 'text-yellow-500',
  },
  blue: {
    icon: 'bg-primary/10 text-primary',
    border: 'hover:border-primary/50',
    arrow: 'group-hover:text-primary',
    count: 'text-primary',
  },
} as const;

type Hue = keyof typeof HUES;

const CATALOG_ICONS: Record<string, string> = {
  agent: 'smart_toy',
  skill: 'construction',
  mcp_server: 'hub',
};

const CATALOG_COUNT_LABEL: Record<string, string> = {
  agent: 'available',
  skill: 'available',
  mcp_server: 'servers',
};

// Decorative card art (issue #281) — a lightweight inline SVG vignette per
// tile so sections are recognizable at a glance, drawn in the tile's accent
// hue via currentColor (works unchanged in light and dark themes).
const TILE_ART: Record<string, React.ReactNode> = {
  videos: (
    <>
      <rect x="4" y="10" width="64" height="44" rx="6" fill="currentColor" opacity="0.25" />
      <polygon points="30,24 30,40 44,32" fill="currentColor" />
      <rect x="10" y="60" width="52" height="5" rx="2.5" fill="currentColor" opacity="0.45" />
      <rect x="10" y="60" width="20" height="5" rx="2.5" fill="currentColor" />
    </>
  ),
  marketplace: (
    <>
      <rect x="6" y="6" width="26" height="26" rx="6" fill="currentColor" opacity="0.85" />
      <rect x="38" y="6" width="26" height="26" rx="6" fill="currentColor" opacity="0.4" />
      <rect x="6" y="38" width="26" height="26" rx="6" fill="currentColor" opacity="0.4" />
      <rect x="38" y="38" width="26" height="26" rx="13" fill="currentColor" opacity="0.65" />
    </>
  ),
  courses: (
    <>
      <path d="M36 8 L66 20 L36 32 L6 20 Z" fill="currentColor" opacity="0.85" />
      <path d="M18 27 v14 c0 4 8 8 18 8 s18 -4 18 -8 V27 l-18 7.5 Z" fill="currentColor" opacity="0.4" />
      <rect x="62" y="20" width="4" height="22" rx="2" fill="currentColor" opacity="0.7" />
    </>
  ),
  articles: (
    <>
      <rect x="10" y="6" width="52" height="60" rx="6" fill="currentColor" opacity="0.25" />
      <rect x="18" y="16" width="36" height="6" rx="3" fill="currentColor" />
      <rect x="18" y="28" width="36" height="4" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="18" y="37" width="36" height="4" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="18" y="46" width="24" height="4" rx="2" fill="currentColor" opacity="0.55" />
    </>
  ),
  memes: (
    <>
      <circle cx="36" cy="36" r="30" fill="currentColor" opacity="0.25" />
      <circle cx="26" cy="28" r="4.5" fill="currentColor" />
      <circle cx="46" cy="28" r="4.5" fill="currentColor" />
      <path d="M20 44 c5 8 27 8 32 0" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
    </>
  ),
  solutions: (
    <>
      <circle cx="36" cy="36" r="14" fill="currentColor" opacity="0.85" />
      <circle cx="10" cy="36" r="6" fill="currentColor" opacity="0.4" />
      <circle cx="62" cy="36" r="6" fill="currentColor" opacity="0.4" />
      <circle cx="36" cy="10" r="6" fill="currentColor" opacity="0.4" />
      <circle cx="36" cy="62" r="6" fill="currentColor" opacity="0.4" />
      <path d="M20 36 h8 M44 36 h8 M36 20 v8 M36 44 v8" stroke="currentColor" strokeWidth="3" opacity="0.55" />
    </>
  ),
};

const TileArt: React.FC<{ hue: Hue; kind: keyof typeof TILE_ART }> = ({ hue, kind }) => (
  <svg
    viewBox="0 0 72 72"
    aria-hidden="true"
    className={`pointer-events-none absolute -right-2 -bottom-2 w-24 h-24 opacity-[0.13] transition-opacity duration-200 group-hover:opacity-25 ${HUES[hue].count}`}
  >
    {TILE_ART[kind]}
  </svg>
);

const TileArrow: React.FC<{ hue: Hue }> = ({ hue }) => (
  <span
    className={`material-symbols-outlined text-[18px] text-text-faint transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${HUES[hue].arrow}`}
  >
    arrow_outward
  </span>
);

const TileIcon: React.FC<{ hue: Hue; icon: string; small?: boolean }> = ({ hue, icon, small }) => (
  <div
    className={`${small ? 'w-9 h-9 rounded-lg' : 'w-11 h-11 rounded-xl'} flex-none grid place-items-center ${HUES[hue].icon}`}
  >
    <span className={`material-symbols-outlined ${small ? 'text-[19px]' : 'text-[22px]'}`}>{icon}</span>
  </div>
);

const tileBase =
  'group relative flex flex-col rounded-2xl border border-border-base bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl overflow-hidden';

export const Home: React.FC = () => {
  usePageView('/');
  const navigate = useNavigate();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const catalogTypes = useVisibleCatalogTypes();

  useEffect(() => {
    api.get<HomeStats>('/api/home/stats').then(setStats).catch(() => {});
  }, []);

  const count = (n: number | undefined) => (n === undefined ? '—' : String(n));

  return (
    <div className="bg-background-light dark:bg-background-dark text-text-strong min-h-screen font-sans flex flex-col">
      <Navbar variant="solutions" />

      <main className="flex-1 pt-16">
        <div className="max-w-6xl mx-auto px-6 pt-9 pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:auto-rows-[9.25rem]">

            {/* Videos / Ignite — top left */}
            <Link to="/ignite" className={`${tileBase} ${HUES.amber.border} sm:col-span-2`}>
              <TileArt hue="amber" kind="videos" />
              <div className="flex items-start justify-between gap-3">
                <TileIcon hue="amber" icon="play_circle" />
                <TileArrow hue="amber" />
              </div>
              <h3 className="mt-3 mb-0.5 text-[17px] font-bold tracking-tight text-text-strong">Videos</h3>
              <p className="text-[13px] text-text-muted">
                Ignite video library — talks and tutorials with transcripts, captions and chapters.
              </p>
              <div className="mt-auto pt-3 min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-text-faint tabular-nums">
                <b className={`font-bold ${HUES.amber.count}`}>{count(stats?.videos)}</b> videos
              </div>
            </Link>

            {/* Marketplace — top right, spans two rows, with sub-tiles */}
            <Link
              to="/marketplace"
              className={`${tileBase} ${HUES.violet.border} sm:col-span-2 lg:row-span-2`}
            >
              <TileArt hue="violet" kind="marketplace" />
              <div className="flex items-start justify-between gap-3">
                <TileIcon hue="violet" icon="storefront" />
                <TileArrow hue="violet" />
              </div>
              <h3 className="mt-3 mb-0.5 text-[17px] font-bold tracking-tight text-text-strong">Marketplace</h3>
              <p className="text-[13px] text-text-muted">
                Ready-to-install AI building blocks with how-to guides and security scanning.
              </p>
              <div className="mt-auto pt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {catalogTypes.map((t) => (
                  <span
                    key={t.key}
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/marketplace?type=${t.key}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/marketplace?type=${t.key}`);
                      }
                    }}
                    className="flex flex-col gap-1 rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 transition-all hover:-translate-y-0.5 hover:border-violet-500/50 hover:bg-violet-500/15 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px] text-violet-500">
                      {CATALOG_ICONS[t.key] ?? 'extension'}
                    </span>
                    <b className="text-[13px] font-bold text-text-strong">{t.label}</b>
                    <span className="text-[11px] text-text-muted">
                      {count(stats?.marketplace?.[t.key] ?? (stats ? 0 : undefined))} {CATALOG_COUNT_LABEL[t.key] ?? 'available'}
                    </span>
                  </span>
                ))}
              </div>
            </Link>

            {/* Courses */}
            <Link to="/courses" className={`${tileBase} ${HUES.emerald.border}`}>
              <TileArt hue="emerald" kind="courses" />
              <div className="flex items-start justify-between gap-3">
                <TileIcon hue="emerald" icon="school" />
                <TileArrow hue="emerald" />
              </div>
              <h3 className="mt-3 mb-0.5 text-[17px] font-bold tracking-tight text-text-strong">Courses</h3>
              <p className="text-[13px] text-text-muted">Structured curricula with progress tracking.</p>
              <div className="mt-auto pt-3 min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-text-faint tabular-nums">
                <b className={`font-bold ${HUES.emerald.count}`}>{count(stats?.courses)}</b> courses
              </div>
            </Link>

            {/* Articles */}
            <Link to="/articles" className={`${tileBase} ${HUES.cyan.border}`}>
              <TileArt hue="cyan" kind="articles" />
              <div className="flex items-start justify-between gap-3">
                <TileIcon hue="cyan" icon="article" />
                <TileArrow hue="cyan" />
              </div>
              <h3 className="mt-3 mb-0.5 text-[17px] font-bold tracking-tight text-text-strong">Articles</h3>
              <p className="text-[13px] text-text-muted">Knowledge articles and write-ups from the team.</p>
              <div className="mt-auto pt-3 min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-text-faint tabular-nums">
                <b className={`font-bold ${HUES.cyan.count}`}>{count(stats?.articles)}</b> articles
              </div>
            </Link>

            {/* Memes — full row (News tile removed, issue #281) */}
            <Link
              to="/memes"
              className={`${tileBase} ${HUES.yellow.border} sm:col-span-2 lg:col-span-4 lg:flex-row lg:items-center lg:gap-5`}
            >
              <TileArt hue="yellow" kind="memes" />
              <TileIcon hue="yellow" icon="mood" />
              <div className="flex-1 min-w-0 mt-3 lg:mt-0">
                <h3 className="mb-0.5 text-[17px] font-bold tracking-tight text-text-strong">Memes</h3>
                <p className="text-[13px] text-text-muted">The lighter side of AI. Community picks.</p>
              </div>
              <div className="mt-4 lg:mt-0 min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-text-faint tabular-nums">
                <b className={`font-bold ${HUES.yellow.count}`}>{count(stats?.memes)}</b> memes
              </div>
              <span className="hidden lg:block">
                <TileArrow hue="yellow" />
              </span>
            </Link>

            {/* Solutions — bottom, full width, horizontal */}
            <Link
              to="/solutions"
              className={`${tileBase} ${HUES.blue.border} sm:col-span-2 lg:col-span-4 lg:flex-row lg:items-center lg:gap-5`}
            >
              <TileArt hue="blue" kind="solutions" />
              <TileIcon hue="blue" icon="grid_view" />
              <div className="flex-1 min-w-0 mt-3 lg:mt-0">
                <h3 className="mb-0.5 text-[17px] font-bold tracking-tight text-text-strong">Solutions</h3>
                <p className="text-[13px] text-text-muted">
                  The showcase of AI solutions built across the org —{' '}
                  <b className={`font-bold ${HUES.blue.count}`}>{count(stats?.solutions)} solutions</b>, updated
                  regularly.
                </p>
              </div>
              <div className="mt-4 lg:mt-0 grid grid-cols-1 sm:grid-cols-3 gap-2.5 lg:flex-[1.1]">
                <span className="flex flex-col rounded-xl border border-border-base bg-surface-muted px-3 py-2 text-[12px] font-semibold text-text">
                  Software<span className="text-[10.5px] font-medium text-text-faint">LLM apps &amp; tools</span>
                </span>
                <span className="flex flex-col rounded-xl border border-border-base bg-surface-muted px-3 py-2 text-[12px] font-semibold text-text">
                  Hardware<span className="text-[10.5px] font-medium text-text-faint">Edge &amp; embedded</span>
                </span>
                <span className="flex flex-col rounded-xl border border-border-base bg-surface-muted px-3 py-2 text-[12px] font-semibold text-text">
                  Other<span className="text-[10.5px] font-medium text-text-faint">Process &amp; research</span>
                </span>
              </div>
              <span className="hidden lg:block">
                <TileArrow hue="blue" />
              </span>
            </Link>
          </div>

          {/* Contact — slim bar */}
          <Link
            to="/contact"
            className="group mt-4 flex items-center gap-4 rounded-2xl border border-border-base bg-surface px-5 py-4 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-xl"
          >
            <div className="w-9 h-9 flex-none grid place-items-center rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[19px]">mail</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-text-strong">Questions, ideas, or want to contribute?</p>
              <p className="text-[12.5px] text-text-muted">Reach the portal team — we usually reply within a day.</p>
            </div>
            <span className="flex-none inline-flex items-center gap-1 text-[13px] font-bold text-primary">
              Contact us
              <span className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-0.5">
                arrow_forward
              </span>
            </span>
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
};
