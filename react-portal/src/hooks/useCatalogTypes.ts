import { useState, useEffect } from 'react';
import { api } from '../api/client';

export interface CatalogType {
  key: string;
  label: string;
}

// Catalog sections, in nav order. `key` must match the public Marketplace
// ?type= value and the component_type stored on each card.
export const CATALOG_TYPES: CatalogType[] = [
  { key: 'agent', label: 'Agents' },
  { key: 'skill', label: 'Skills' },
  { key: 'mcp_server', label: 'MCP' },
];

interface TypeStatus {
  under_construction: boolean;
  message?: string;
}

interface MarketplaceStatus {
  under_construction: boolean;
  message?: string;
  types?: Record<string, TypeStatus>;
}

/**
 * Catalog sections that should be visible in navigation. A section is hidden
 * when the whole catalog is paused (global switch) or its own per-type override
 * is on. Falls back to showing all sections until the status loads or if the
 * request fails, so navigation never silently disappears on a transient error.
 */
export function useVisibleCatalogTypes(): CatalogType[] {
  const [status, setStatus] = useState<MarketplaceStatus | null>(null);

  useEffect(() => {
    api.get<MarketplaceStatus | null>('/settings/marketplace_status')
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status) return CATALOG_TYPES;
  if (status.under_construction) return [];
  return CATALOG_TYPES.filter(t => !status.types?.[t.key]?.under_construction);
}
