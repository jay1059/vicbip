/**
 * Ingest AADT 2019 traffic data from Transport Victoria Open Data.
 * Downloads the GeoJSON FeatureCollection of road segments, computes
 * each segment's midpoint, finds the nearest bridge within 1500 m,
 * and upserts into bridge_traffic.
 */
import { Pool } from 'pg';
import { haversine, nearestBridge, BridgeRow } from '../utils/haversine';

const AADT_URL =
  'https://opendata.transport.vic.gov.au/dataset/' +
  '26fafd1a-8d59-4da0-93cd-29f371147d8f/resource/' +
  '425799c9-658c-41cf-b9b0-6c9a145856cf/download/yearly_aadt_volume_2019.geojson';

const MAX_DIST_M = 1500;
const DATA_YEAR = 2019;
const DEFAULT_HEAVY_PCT = 8;

interface IngestResult {
  features: number;
  matched: number;
  unmatched: number;
  inserted: number;
  updated: number;
  errors: number;
  avg_dist_m: number;
  high_hv_count: number;
}

function linestringMidpoint(coords: number[][]): [number, number] {
  const mid = coords[Math.floor(coords.length / 2)];
  if (!mid) return [0, 0];
  return [mid[1] ?? 0, mid[0] ?? 0]; // [lat, lon]
}

export async function runAadt(pool: Pool): Promise<IngestResult> {
  console.log('[aadt] downloading GeoJSON…');
  const resp = await fetch(AADT_URL, { headers: { 'User-Agent': 'VicBIP/1.0' } });
  if (!resp.ok) throw new Error(`AADT download failed: ${resp.status}`);
  const geojson = (await resp.json()) as {
    features: Array<{
      geometry: { type: string; coordinates: number[][] | number[][][] };
      properties: Record<string, unknown>;
    }>;
  };

  const features = geojson.features ?? [];
  console.log(`[aadt] downloaded ${features.length} features`);

  const bridgesRes = await pool.query<BridgeRow>(
    'SELECT id, latitude::float, longitude::float FROM bridges WHERE latitude IS NOT NULL',
  );
  const bridges = bridgesRes.rows;
  console.log(`[aadt] loaded ${bridges.length} bridges`);

  let matched = 0, unmatched = 0, inserted = 0, updated = 0, errors = 0;
  let totalDist = 0, highHv = 0;

  for (const feature of features) {
    const geom = feature.geometry;
    let lat = 0, lon = 0;

    const rawCoords = geom.coordinates as unknown;
    if (geom.type === 'LineString' && Array.isArray(rawCoords)) {
      [lat, lon] = linestringMidpoint(rawCoords as number[][]);
    } else if (geom.type === 'MultiLineString' && Array.isArray(rawCoords)) {
      const first = ((rawCoords as unknown[][])[0] ?? []) as number[][];
      [lat, lon] = linestringMidpoint(first);
    } else if (geom.type === 'Point' && Array.isArray(rawCoords)) {
      const c = rawCoords as number[];
      lon = Number(c[0] ?? 0); lat = Number(c[1] ?? 0);
    }

    if (!lat || !lon) { unmatched++; continue; }

    const props = feature.properties;
    const aadt = Number(props['Average Annual Daily Traffic Volume'] ?? 0);
    if (aadt <= 0) { unmatched++; continue; }

    let heavyPct: number;
    const rawPct = props['Percentage of Heavy Vehicles'];
    if (rawPct != null) {
      const p = Number(rawPct);
      heavyPct = p <= 1.0 ? p * 100 : p;
    } else {
      const hvVol = Number(props['Average Annual Daily Heavy Vehicle Volume'] ?? 0);
      heavyPct = hvVol > 0 ? (hvVol / aadt) * 100 : DEFAULT_HEAVY_PCT;
    }

    const stationId = String(props['Road Segment ID'] ?? '');
    const match = nearestBridge(lat, lon, bridges, MAX_DIST_M);
    if (!match) { unmatched++; continue; }

    matched++;
    totalDist += match.distM;
    if (heavyPct > 10) highHv++;

    try {
      const r = await pool.query(
        `INSERT INTO bridge_traffic (bridge_id, year, aadt_total, heavy_pct, station_id, station_dist_m, high_hv_flag)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (bridge_id, year) DO UPDATE SET
           aadt_total=$3, heavy_pct=$4, station_id=$5, station_dist_m=$6, high_hv_flag=$7
         RETURNING (xmax=0) AS is_insert`,
        [match.id, DATA_YEAR, aadt, +heavyPct.toFixed(2), stationId, +match.distM.toFixed(1), heavyPct > 15],
      );
      const row = r.rows[0] as { is_insert: boolean } | undefined;
      if (row?.is_insert) inserted++; else updated++;
    } catch (e) {
      errors++;
    }
  }

  const avgDist = matched > 0 ? Math.round(totalDist / matched) : 0;
  return { features: features.length, matched, unmatched, inserted, updated, errors, avg_dist_m: avgDist, high_hv_count: highHv };
}
