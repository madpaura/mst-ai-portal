import { useEffect } from 'react';
import { api } from '../api/client';

/**
 * Fire-and-forget page view tracking.
 * Sends a single POST on mount (or when `path` changes).
 */
export function usePageView(path: string) {
  useEffect(() => {
    api.post('/analytics/pageview', { path }).catch(() => {});
  }, [path]);
}
