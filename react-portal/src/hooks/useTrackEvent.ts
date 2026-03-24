import { useCallback } from 'react';
import { api } from '../api/client';

/**
 * Returns a fire-and-forget function to track analytics events.
 */
export function useTrackEvent() {
  return useCallback(
    (event_type: string, section: string, entity_id?: string, entity_name?: string, metadata?: Record<string, unknown>) => {
      api.post('/analytics/event', { event_type, section, entity_id, entity_name, metadata }).catch(() => {});
    },
    [],
  );
}
