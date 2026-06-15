import React from 'react';

interface PagerProps {
  page: number;
  pageCount: number;
  total: number;
  showAll: boolean;
  onPage: (page: number) => void;
  onToggleShowAll: () => void;
}

/** Numbered pager + "Show all" toggle used under paginated list grids. */
export const Pager: React.FC<PagerProps> = ({ page, pageCount, total, showAll, onPage, onToggleShowAll }) => {
  // Windowed page numbers: always show first/last, ellipsis in between.
  const pages: (number | '…')[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  const btnBase =
    'min-w-[34px] h-[34px] px-2 rounded-lg text-[13px] font-semibold border transition-colors';

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-8">
      {!showAll && (
        <>
          <button
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            className={`${btnBase} bg-surface border-border-base text-text-muted hover:text-primary hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center`}
            title="Previous page"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>
          {pages.map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-text-faint text-sm">
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onPage(p)}
                className={`${btnBase} ${
                  p === page
                    ? 'bg-primary border-primary text-white'
                    : 'bg-surface border-border-base text-text-muted hover:text-primary hover:border-primary/40'
                }`}
              >
                {p}
              </button>
            ),
          )}
          <button
            onClick={() => onPage(page + 1)}
            disabled={page >= pageCount}
            className={`${btnBase} bg-surface border-border-base text-text-muted hover:text-primary hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center`}
            title="Next page"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        </>
      )}
      <button
        onClick={onToggleShowAll}
        className={`${btnBase} bg-surface border-border-base text-text-muted hover:text-primary hover:border-primary/40 px-3`}
      >
        {showAll ? 'Show pages' : `Show all (${total})`}
      </button>
    </div>
  );
};
