/**
 * Ingest Victoria Road Crash Data into bridge_crash_summary.
 * v3.1 — uses confirmed-working CSV URLs (verified 200 OK, ~33MB + ~22MB).
 *
 * Dataset: victoria-road-crash-data (package bb77800e)
 *   - accident.csv: ACCIDENT_NO, ACCIDENT_DATE, SEVERITY, NO_PERSONS_KILLED, type desc
 *   - node.csv:     ACCIDENT_NO, LATITUDE, LONGITUDE
 * Joined on ACCIDENT_NO, then matched to bridges within 150 m using haversine.
 *
 * Source: opendata.transport.vic.gov.au — Victoria Road Crash Data (CC BY 4.0)
 */
import { Pool } from 'pg';
import { nearestBridge, BridgeRow } from '../utils/haversine';

// These URLs return HTTP 200 with real CSV data (~33 MB and ~22 MB respectively).
// Confirmed working 2026-05-06 via curl from opendata.transport.vic.gov.au.
const ACCIDENT_CSV_URL =
  'https://opendata.transport.vic.gov.au/dataset/' +
  'bb77800e-1857-4edc-bf9e-e188437a1c8e/resource/' +
  '20772c1a-8b19-424a-a733-eb84f725f611/download/accident.csv';

const NODE_CSV_URL =
  'https://opendata.transport.vic.gov.au/dataset/' +
  'bb77800e-1857-4edc-bf9e-e188437a1c8e/resource/' +
  '466fd3b5-201b-42b5-b10d-e926324fa215/download/node.csv';

const ADJACENT_M = 150;
const ON_BRIDGE_M = 50;
const MIN_DATE = '2019-01-01';

const HEAVY_KW = ['heavy', 'truck', 'bus', 'semi', 'articul', 'oversize', 'overweight', 'b-double'];

interface AccidentRow {
  date: string;
  severity: number;
  isFatal: boolean;
  isSerious: boolean;
  isHeavy: boolean;
}

interface CrashSummary {
  total: number; fatal: number; serious: number;
  heavy: number; adjacent: number; on_bridge: number;
  date_start: string | null; date_end: string | null;
}

interface IngestResult {
  accidents_parsed: number;
  nodes_parsed: number;
  matched: number;
  bridges_with_crashes: number;
  upserted: number;
  errors: number;
  debug: string;
}

/** Parse CSV text into array of records keyed by lowercased headers. */
function parseCSVToMap(text: string): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  const lines = text.split('\n');
  const headers = (lines[0] ?? '').split(',').map((h) => h.trim().toUpperCase());
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const vals = line.split(',');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j] ?? ''] = (vals[j] ?? '').trim();
    }
    const key = row['ACCIDENT_NO'] ?? '';
    if (key) map.set(key, row);
  }
  return map;
}

function isHeavyAccident(row: Record<string, string>): boolean {
  const text = [row['ACCIDENT_TYPE_DESC'] ?? '', row['ROAD_GEOMETRY_DESC'] ?? '']
    .join(' ').toLowerCase();
  return HEAVY_KW.some((kw) => text.includes(kw));
}

async function fetchCSV(url: string): Promise<{ text: string; status: number; bytes: number }> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'VicBIP/1.0 (internal tool)',
      'Accept': 'text/csv, text/plain, */*',
    },
    signal: AbortSignal.timeout(180_000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`CSV download failed HTTP ${resp.status} from ${url} — body: ${text.slice(0, 200)}`);
  }
  return { text, status: resp.status, bytes: text.length };
}

export async function runCrashData(pool: Pool): Promise<IngestResult> {
  console.log('[crash] downloading accident.csv and node.csv…');

  const [accidentRes, nodeRes] = await Promise.all([
    fetchCSV(ACCIDENT_CSV_URL),
    fetchCSV(NODE_CSV_URL),
  ]);

  const accidentText = accidentRes.text;
  const nodeText = nodeRes.text;
  console.log(`[crash] accident CSV: HTTP ${accidentRes.status}, ${accidentRes.bytes} bytes; node CSV: HTTP ${nodeRes.status}, ${nodeRes.bytes} bytes`);

  // Parse accident CSV into map keyed by ACCIDENT_NO
  const accidentMap = new Map<string, AccidentRow>();
  {
    const lines = accidentText.split('\n');
    const headers = (lines[0] ?? '').split(',').map((h) => h.trim().toUpperCase());
    const idx = (name: string) => headers.indexOf(name);
    const iNo = idx('ACCIDENT_NO'), iDate = idx('ACCIDENT_DATE');
    const iSev = idx('SEVERITY'), iKilled = idx('NO_PERSONS_KILLED');
    const iType = idx('ACCIDENT_TYPE_DESC'), iGeo = idx('ROAD_GEOMETRY_DESC');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const v = line.split(',');
      const accNo = (v[iNo] ?? '').trim();
      if (!accNo) continue;
      const date = (v[iDate] ?? '').trim().slice(0, 10);
      if (date < MIN_DATE) continue;
      const sev = parseInt(v[iSev] ?? '9', 10);
      const killed = parseInt(v[iKilled] ?? '0', 10);
      const isFatal = killed > 0 || sev === 1;
      const isSerious = sev === 2;
      if (!isFatal && !isSerious) continue;
      const typeDesc = (v[iType] ?? '').toLowerCase();
      const geoDesc = (v[iGeo] ?? '').toLowerCase();
      const isHeavy = HEAVY_KW.some((kw) => typeDesc.includes(kw) || geoDesc.includes(kw));
      accidentMap.set(accNo, { date, severity: sev, isFatal, isSerious, isHeavy });
    }
  }

  console.log(`[crash] ${accidentMap.size} qualifying accidents (fatal/serious since ${MIN_DATE})`);

  // Load bridges
  const bridgesRes = await pool.query<BridgeRow>(
    'SELECT id, latitude::float, longitude::float FROM bridges WHERE latitude IS NOT NULL',
  );
  const bridges = bridgesRes.rows;

  // Stream through node.csv and match
  const summaries = new Map<string, CrashSummary>();
  let nodesParsed = 0;
  let matched = 0;

  {
    const lines = nodeText.split('\n');
    const headers = (lines[0] ?? '').split(',').map((h) => h.trim().toUpperCase());
    const iNo = headers.indexOf('ACCIDENT_NO');
    const iLat = headers.indexOf('LATITUDE');
    const iLon = headers.indexOf('LONGITUDE');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const v = line.split(',');
      nodesParsed++;
      const accNo = (v[iNo] ?? '').trim();
      const acc = accidentMap.get(accNo);
      if (!acc) continue;

      const lat = parseFloat(v[iLat] ?? '');
      const lon = parseFloat(v[iLon] ?? '');
      if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue;
      if (lat < -40 || lat > -33 || lon < 140 || lon > 150) continue;

      const match = nearestBridge(lat, lon, bridges, ADJACENT_M);
      if (!match) continue;
      matched++;

      const s = summaries.get(match.id) ?? {
        total: 0, fatal: 0, serious: 0, heavy: 0, adjacent: 0, on_bridge: 0,
        date_start: acc.date, date_end: acc.date,
      };
      s.total++;
      s.adjacent++;
      if (acc.isFatal) s.fatal++;
      if (acc.isSerious) s.serious++;
      if (acc.isHeavy) s.heavy++;
      if (match.distM <= ON_BRIDGE_M) s.on_bridge++;
      if (acc.date < (s.date_start ?? acc.date)) s.date_start = acc.date;
      if (acc.date > (s.date_end ?? acc.date)) s.date_end = acc.date;
      summaries.set(match.id, s);
    }
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
      console.error('[crash] upsert error:', e);
      errors++;
    }
  }

  return {
    accidents_parsed: accidentMap.size,
    nodes_parsed: nodesParsed,
    matched,
    bridges_with_crashes: summaries.size,
    upserted,
    errors,
    debug: `accident.csv: HTTP ${accidentRes.status} ${accidentRes.bytes} bytes | node.csv: HTTP ${nodeRes.status} ${nodeRes.bytes} bytes`,
  };
}
