/**
 * Ingest Victoria Road Crash Data into bridge_crash_summary.
 * Streams the crash GeoJSON, matches fatal/serious crashes within 150 m
 * of a bridge, and upserts per-bridge crash summaries.
 */
import { Pool } from 'pg';
import { nearestBridge, BridgeRow } from '../utils/haversine';

const CRASH_URL =
  'https://opendata.transport.vic.gov.au/dataset/' +
  'victoria-road-crash-data/resource/' +
  '92b63aed-6d64-42a0-b708-66c2c23dae7d/download/' +
  'victoria_road_crash_data.geojson';

const ADJACENT_M = 150;
const ON_BRIDGE_M = 50;
const MIN_DATE = '2019-01-01';

const FATAL_SET = new Set(['Fatal accident', 'Fatality', 'Fatal']);
const HEAVY_KW = ['heavy', 'truck', 'bus', 'semi', 'articul', 'oversize', 'overweight', 'b-double'];

interface CrashSummary {
  total: number; fatal: number; serious: number;
  heavy: number; adjacent: number; on_bridge: number;
  date_start: string | null; date_end: string | null;
}

interface IngestResult {
  total_features: number;
  matched: number;
  bridges_with_crashes: number;
  upserted: number;
  errors: number;
}

function isHeavy(props: Record<string, unknown>): boolean {
  const text = [props['VEHICLE_1_TYPE'], props['VEHICLE_2_TYPE'], props['ACCIDENT_TYPE']]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  return HEAVY_KW.some((kw) => text.includes(kw));
}

export async function runCrashData(pool: Pool): Promise<IngestResult> {
  console.log('[crash] downloading GeoJSON (may be large)…');
  const resp = await fetch(CRASH_URL, { headers: { 'User-Agent': 'VicBIP/1.0' } });
  if (!resp.ok) throw new Error(`Crash download failed: ${resp.status}`);

  const geojson = (await resp.json()) as {
    features: Array<{
      geometry: { type: string; coordinates: unknown };
      properties: Record<string, unknown>;
    }>;
  };

  const features = geojson.features ?? [];
  console.log(`[crash] ${features.length} crash features`);

  const bridgesRes = await pool.query<BridgeRow>(
    'SELECT id, latitude::float, longitude::float FROM bridges WHERE latitude IS NOT NULL',
  );
  const bridges = bridgesRes.rows;

  const summaries = new Map<string, CrashSummary>();
  let matched = 0;

  for (const feature of features) {
    const props = feature.properties;
    const rawDate = String(props['ACCIDENT_DATE'] ?? '').slice(0, 10);
    if (rawDate && rawDate < MIN_DATE) continue;

    const severity = String(props['SEVERITY'] ?? props['severity'] ?? '');
    const isFatal = FATAL_SET.has(severity);
    const isSerious = !isFatal && (severity.includes('injury') || severity.includes('Injury'));
    if (!isFatal && !isSerious) continue;

    const geom = feature.geometry;
    let lat = 0, lon = 0;
    const rawCoords = geom.coordinates as unknown;
    if (geom.type === 'Point' && Array.isArray(rawCoords)) {
      const coords = rawCoords as number[];
      lon = Number(coords[0] ?? 0); lat = Number(coords[1] ?? 0);
    } else if (Array.isArray(rawCoords) && Array.isArray((rawCoords as unknown[])[0])) {
      const first = (rawCoords as unknown[][])[0] as number[];
      lon = Number(first[0] ?? 0); lat = Number(first[1] ?? 0);
    }
    if (!lat || !lon) continue;
    if (lat < -40 || lat > -33 || lon < 140 || lon > 150) continue;

    const match = nearestBridge(lat, lon, bridges, ADJACENT_M);
    if (!match) continue;
    matched++;

    const s = summaries.get(match.id) ?? {
      total: 0, fatal: 0, serious: 0, heavy: 0, adjacent: 0, on_bridge: 0,
      date_start: rawDate || null, date_end: rawDate || null,
    };
    s.total++;
    s.adjacent++;
    if (isFatal) s.fatal++;
    if (isSerious) s.serious++;
    if (isHeavy(props)) s.heavy++;
    if (match.distM <= ON_BRIDGE_M) s.on_bridge++;
    if (rawDate) {
      if (!s.date_start || rawDate < s.date_start) s.date_start = rawDate;
      if (!s.date_end || rawDate > s.date_end) s.date_end = rawDate;
    }
    summaries.set(match.id, s);
  }

  console.log(`[crash] ${matched} crashes matched to ${summaries.size} bridges`);

  let upserted = 0, errors = 0;
  for (const [bridgeId, s] of summaries) {
    const score = Math.min(10, s.fatal * 3 + s.serious * 1.5 + s.heavy * 2 + s.on_bridge * 2);
    try {
      await pool.query(
        `INSERT INTO bridge_crash_summary
           (bridge_id, total_crashes, fatal_crashes, serious_crashes,
            heavy_vehicle_crashes, bridge_adjacent_crashes, on_bridge_crashes,
            date_range_start, date_range_end, crash_risk_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (bridge_id) DO UPDATE SET
           total_crashes=$2, fatal_crashes=$3, serious_crashes=$4,
           heavy_vehicle_crashes=$5, bridge_adjacent_crashes=$6, on_bridge_crashes=$7,
           date_range_start=$8, date_range_end=$9, crash_risk_score=$10`,
        [bridgeId, s.total, s.fatal, s.serious, s.heavy, s.adjacent, s.on_bridge,
         s.date_start, s.date_end, +score.toFixed(2)],
      );
      upserted++;
    } catch (e) {
      errors++;
    }
  }

  return {
    total_features: features.length,
    matched,
    bridges_with_crashes: summaries.size,
    upserted,
    errors,
  };
}
