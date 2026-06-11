import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side pagination over an already-filtered list.
 *
 * Pages start collapsed to `pageSize` items with a pager + "Show all" control;
 * `resetKey` should change whenever the underlying filter/search changes so
 * the view snaps back to page 1.
 */
export function usePagedList<T>(items: T[], pageSize: number, resetKey = '') {
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);

  const visible = useMemo(
    () => (showAll ? items : items.slice((safePage - 1) * pageSize, safePage * pageSize)),
    [items, showAll, safePage, pageSize],
  );

  return {
    visible,
    page: safePage,
    setPage,
    pageCount,
    showAll,
    setShowAll,
    total: items.length,
    // Pager is only worth rendering when there is more than one page.
    hasPager: items.length > pageSize,
  };
}

export type PagedList<T> = ReturnType<typeof usePagedList<T>>;
