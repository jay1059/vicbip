import type {
  BridgeGeoJSONCollection,
  BridgeDetail,
  BridgeStats,
  BridgeFilters,
} from '@vicbip/shared';

const BASE = '/api';

function buildFilterParams(filters: BridgeFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.risk_tier && filters.risk_tier.length > 0) {
    params.set('risk_tier', filters.risk_tier.join(','));
  }

  if (filters.owner_category && filters.owner_category.length > 0) {
    params.set('owner_category', filters.owner_category.join(','));
  }

  if (filters.min_year !== undefined) params.set('min_year', String(filters.min_year));
  if (filters.max_year !== undefined) params.set('max_year', String(filters.max_year));
  if (filters.min_span !== undefined) params.set('min_span', String(filters.min_span));
  if (filters.max_span !== undefined) params.set('max_span', String(filters.max_span));
  if (filters.q) params.set('q', filters.q);
  if (filters.freyssinet_only) params.set('freyssinet_only', 'true');
  if (filters.exclude_freyssinet) params.set('exclude_freyssinet', 'true');
  if (filters.sn_only) params.set('sn_only', 'true');
  if (filters.has_tenders) params.set('has_tenders', 'true');

  return params;
}

export async function fetchBridges(filters: BridgeFilters): Promise<BridgeGeoJSONCollection> {
  const params = buildFilterParams(filters);
  const url = `${BASE}/bridges?${params.toString()}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Failed to fetch bridges: ${resp.statusText}`);
  }

  return resp.json() as Promise<BridgeGeoJSONCollection>;
}

export async function fetchBridgeDetail(id: string): Promise<BridgeDetail> {
  const resp = await fetch(`${BASE}/bridges/${id}`);

  if (!resp.ok) {
    throw new Error(`Failed to fetch bridge detail: ${resp.statusText}`);
  }

  return resp.json() as Promise<BridgeDetail>;
}

export async function fetchBridgeStats(): Promise<BridgeStats> {
  const resp = await fetch(`${BASE}/bridges/stats`);

  if (!resp.ok) {
    throw new Error(`Failed to fetch bridge stats: ${resp.statusText}`);
  }

  return resp.json() as Promise<BridgeStats>;
}

export function buildExportUrl(filters: BridgeFilters): string {
  const params = buildFilterParams(filters);
  params.set('format', 'csv');
  return `${BASE}/bridges/export?${params.toString()}`;
}
