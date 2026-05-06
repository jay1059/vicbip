/**
 * Ingest TIRTL (Traffic Infrastructure Real-Time Logging) site locations
 * and match them to nearby bridges. Uses the TIRTL Sites CSV which is small
 * (~few KB). The monthly ZIP classification data is skipped in the TS
 * implementation as it requires ZIP parsing; instead, sites are matched
 * and recorded with a default heavy_pct until the classification data
 * is ingested separately.
 */
import { Pool } from 'pg';
import { nearestBridge, BridgeRow } from '../utils/haversine';

const TIRTL_SITES_URL =
  'https://opendata.transport.vic.gov.au/dataset/' +
  'e2d78fb5-e16d-43b9-bcdc-607d9b4855f5/resource/' +
  '1f685833-24fd-4eb0-af11-2e7cfc94da74/download/tirtl_sites.csv';

// Most recent classification data URL — CSV inside ZIP
const TIRTL_COUNTS_URL =
  'https://opendata.transport.vic.gov.au/dataset/' +
  'e2d78fb5-e16d-43b9-bcdc-607d9b4855f5/resource/' +
  '8ecd89b1-05ea-4b33-81b0-7cb9631e16ec/download/' +
  'tirtl_15min_volume_classification_may_2026.zip';

const MAX_DIST_M = 1000;
const DATA_YEAR = 2026;
const DEFAULT_HEAVY_PCT = 8;

interface IngestResult {
  sites: number;
  matched: number;
  unmatched: number;
  inserted: number;
  updated: number;
  errors: number;
  note: string;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  const headers = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  return lines.slice(1).map((line) => {
    const vals = line.split(',');
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i] ?? ''] = (vals[i] ?? '').trim();
    }
    return row;
  });
}

export async function runTirtl(pool: Pool): Promise<IngestResult> {
  console.log('[tirtl] downloading sites CSV…');
  const resp = await fetch(TIRTL_SITES_URL, {
    headers: { 'User-Agent': 'VicBIP/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`TIRTL sites download failed: ${resp.status}`);
  const csv = await resp.text();
  const siteRows = parseCSV(csv);
  console.log(`[tirtl] ${siteRows.length} sites loaded`);

  const bridgesRes = await pool.query<BridgeRow>(
    'SELECT id, latitude::float, longitude::float FROM bridges WHERE latitude IS NOT NULL',
  );
  const bridges = bridgesRes.rows;

  let matched = 0, unmatched = 0, inserted = 0, updated = 0, errors = 0;

  for (const row of siteRows) {
    const siteId = row['site'] ?? '';
    const lat = parseFloat(row['latitude'] ?? '');
    const lon = parseFloat(row['longitude'] ?? '');
    if (isNaN(lat) || isNaN(lon) || !lat || !lon) { unmatched++; continue; }

    const match = nearestBridge(lat, lon, bridges, MAX_DIST_M);
    if (!match) { unmatched++; continue; }
    matched++;

    try {
      const r = await pool.query(
        `INSERT INTO bridge_traffic (bridge_id, year, aadt_total, heavy_pct, station_id, station_dist_m, high_hv_flag)
         VALUES ($1,$2,NULL,$3,$4,$5,false)
         ON CONFLICT (bridge_id, year) DO UPDATE SET
           station_id=$4, station_dist_m=$5
         RETURNING (xmax=0) AS is_insert`,
        [match.id, DATA_YEAR, DEFAULT_HEAVY_PCT, siteId, +match.distM.toFixed(1)],
      );
      const isIns = (r.rows[0] as { is_insert: boolean } | undefined)?.is_insert;
      if (isIns) inserted++; else updated++;
    } catch {
      errors++;
    }
  }

  return {
    sites: siteRows.length,
    matched,
    unmatched,
    inserted,
    updated,
    errors,
    note: 'TIRTL sites matched; classification counts require ZIP parsing (not yet implemented in TS — use Python pipeline for full classification data)',
  };
}
