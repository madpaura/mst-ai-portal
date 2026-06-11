import React from 'react';

/**
 * Skeleton placeholders shown while list pages stream in their data.
 * Each mirrors the dimensions of the real card it stands in for so the
 * layout doesn't shift when content arrives.
 */

const pulse = 'animate-pulse bg-slate-200 dark:bg-slate-800';

export const VideoCardSkeleton: React.FC = () => (
  <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
    <div className={`aspect-video ${pulse}`} />
    <div className="p-4 space-y-3">
      <div className={`h-3 w-1/3 rounded ${pulse}`} />
      <div className={`h-4 w-full rounded ${pulse}`} />
      <div className={`h-4 w-2/3 rounded ${pulse}`} />
      <div className="flex items-center gap-2 pt-1">
        <div className={`w-[22px] h-[22px] rounded-full ${pulse}`} />
        <div className={`h-3 w-16 rounded ${pulse}`} />
      </div>
    </div>
  </div>
);

export const ArticleCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-card-dark border border-slate-200 dark:border-white/5 rounded-xl p-6">
    <div className="flex items-center gap-3 mb-4">
      <div className={`h-3 w-20 rounded ${pulse}`} />
      <div className={`h-3 w-24 rounded ${pulse}`} />
    </div>
    <div className={`h-5 w-full rounded mb-2 ${pulse}`} />
    <div className={`h-5 w-3/4 rounded mb-4 ${pulse}`} />
    <div className={`h-3.5 w-full rounded mb-2 ${pulse}`} />
    <div className={`h-3.5 w-full rounded mb-2 ${pulse}`} />
    <div className={`h-3.5 w-1/2 rounded ${pulse}`} />
  </div>
);

export const ComponentCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 border border-border-base rounded-lg p-4 flex flex-col gap-3">
    <div className="flex items-start justify-between gap-2">
      <div className={`h-4 w-2/3 rounded ${pulse}`} />
      <div className={`h-4 w-14 rounded-full ${pulse}`} />
    </div>
    <div className={`h-3 w-24 rounded ${pulse}`} />
    <div className={`h-3 w-full rounded ${pulse}`} />
    <div className={`h-3 w-5/6 rounded ${pulse}`} />
    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 mt-1">
      <div className={`h-3 w-12 rounded ${pulse}`} />
      <div className={`h-3 w-10 rounded ${pulse}`} />
    </div>
  </div>
);

export const ComponentRowSkeleton: React.FC = () => (
  <div className="px-4 py-4 flex items-center gap-4 bg-white dark:bg-slate-900 border border-border-base rounded-lg">
    <div className="flex-1 min-w-0 space-y-2">
      <div className={`h-4 w-1/3 rounded ${pulse}`} />
      <div className={`h-3 w-2/3 rounded ${pulse}`} />
    </div>
    <div className={`h-3 w-16 rounded shrink-0 ${pulse}`} />
  </div>
);

export const SolutionCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-card-dark border border-slate-200 dark:border-white/5 rounded-xl p-6">
    <div className={`w-12 h-12 rounded-xl mb-4 ${pulse}`} />
    <div className={`h-5 w-2/3 rounded mb-3 ${pulse}`} />
    <div className={`h-3.5 w-full rounded mb-2 ${pulse}`} />
    <div className={`h-3.5 w-5/6 rounded ${pulse}`} />
  </div>
);
