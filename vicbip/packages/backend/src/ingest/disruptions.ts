/**
 * Fetch planned road disruptions and insert bridge-related ones into bridge_events.
 * Tries the DTP REST API first; falls back to VicTraffic RSS XML.
 */
import { Pool } from 'pg';
import { nearestBridge, BridgeRow } from '../utils/haversine';

const DISRUPTIONS_API =
  'https://api.opendata.transport.vic.gov.au/opendata/roads/disruptions/planned/v1/';
const VICTRAFFIC_RSS = 'https://www.victraffic.vic.gov.au/rss/alerts.rss';
const MAX_DIST_M = 500;

const BRIDGE_KW = [
  'bridge', 'viaduct', 'overpass', 'underpass',
  'weight limit', 'weight restriction', 'load limit', 'load restriction',
  'structure inspection', 'axle load', 'mass limit',
];
const WEIGHT_KW = ['weight', 'load', 'mass', 'axle', 'tonne', 'limit'];

interface Disruption {
  title: string;
  description: string;
  road: string | null;
  lat: number | null;
  lon: number | null;
  date: string | null;
  url: string;
}

interface IngestResult {
  total: number;
  inserted: number;
  skipped_not_bridge: number;
  skipped_no_match: number;
  errors: number;
}

function isBridgeRelated(text: string): boolean {
  const t = text.toLowerCase();
  return BRIDGE_KW.some((kw) => t.includes(kw));
}

function classifyEvent(text: string): string {
  const t = text.toLowerCase();
  return WEIGHT_KW.some((kw) => t.includes(kw)) ? 'weight_restriction' : 'closure';
}

function parseRssDate(raw: string): string | null {
  try {
    return new Date(raw).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

async function fetchDisruptions(): Promise<Disruption[]> {
  // Try REST API
  try {
    const resp = await fetch(DISRUPTIONS_API, {
      headers: { Accept: 'application/json', 'User-Agent': 'VicBIP/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as unknown;
      const items: unknown[] = Array.isArray(data)
        ? data
        : ((data as Record<string, unknown>)['disruptions'] as unknown[] | undefined) ?? [];
      if (items.length > 0) {
        return items.map((item) => {
          const i = item as Record<string, unknown>;
          return {
            title: String(i['title'] ?? i['description'] ?? ''),
            description: String(i['description'] ?? i['notes'] ?? ''),
            road: (i['road_name'] ?? i['road'] ?? null) as string | null,
            lat: i['latitude'] ? Number(i['latitude']) : null,
            lon: i['longitude'] ? Number(i['longitude']) : null,
            date: String(i['start_date'] ?? i['date'] ?? '').slice(0, 10) || null,
            url: String(i['url'] ?? DISRUPTIONS_API),
          };
        });
      }
    }
  } catch {
    /* fall through to RSS */
  }

  // Fall back to VicTraffic RSS
  const disruptions: Disruption[] = [];
  try {
    const resp = await fetch(VICTRAFFIC_RSS, {
      headers: { 'User-Agent': 'VicBIP/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();

    // Minimal XML parsing with regex (no DOM parser in Node by default)
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
    for (const item of items) {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ??
        item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() ?? '';
      const description = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ??
        item.match(/<description>(.*?)<\/description>/))?.[1]?.trim() ?? '';
      const link = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? VICTRAFFIC_RSS;
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
      const road = title.includes(':') ? title.split(':')[0]!.trim() : null;

      disruptions.push({
        title,
        description,
        road,
        lat: null,
        lon: null,
        date: pubDate ? parseRssDate(pubDate) : null,
        url: link,
      });
    }
  } catch {
    /* silently return empty */
  }
  return disruptions;
}

export async function runDisruptions(pool: Pool): Promise<IngestResult> {
  const disruptions = await fetchDisruptions();
  console.log(`[disruptions] ${disruptions.length} fetched`);

  const bridgesRes = await pool.query<BridgeRow & { name: string; road_name: string | null }>(
    'SELECT id, name, road_name, latitude::float, longitude::float FROM bridges WHERE latitude IS NOT NULL',
  );
  const bridges = bridgesRes.rows;

  let inserted = 0, skippedNotBridge = 0, skippedNoMatch = 0, errors = 0;

  for (const d of disruptions) {
    const fullText = `${d.title} ${d.description}`;
    if (!isBridgeRelated(fullText)) { skippedNotBridge++; continue; }

    // Spatial match if coordinates available
    let bridgeId: string | null = null;
    if (d.lat && d.lon) {
      const match = nearestBridge(d.lat, d.lon, bridges, MAX_DIST_M);
      bridgeId = match?.id ?? null;
    }

    // Road name fallback
    if (!bridgeId && d.road) {
      const roadLower = d.road.toLowerCase();
      for (const b of bridges) {
        if (
          (b.road_name && b.road_name.toLowerCase().includes(roadLower)) ||
          b.name.toLowerCase().includes(roadLower)
        ) {
          bridgeId = b.id;
          break;
        }
      }
    }

    if (!bridgeId) { skippedNoMatch++; continue; }

    try {
      const r = await pool.query(
        `INSERT INTO bridge_events (bridge_id, event_type, event_date, severity, source_url, notes)
         VALUES ($1,$2,$3,'Unknown',$4,$5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [bridgeId, classifyEvent(fullText), d.date, d.url, fullText.slice(0, 500)],
      );
      if ((r.rowCount ?? 0) > 0) inserted++;
    } catch (e) {
      errors++;
    }
  }

  return { total: disruptions.length, inserted, skipped_not_bridge: skippedNotBridge, skipped_no_match: skippedNoMatch, errors };
}
