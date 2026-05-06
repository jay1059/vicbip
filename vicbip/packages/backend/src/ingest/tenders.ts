/**
 * Scrape tender notices from tenders.vic.gov.au and AusTender using
 * fetch() + minimal HTML/JSON parsing. No Playwright or Python required.
 */
import { Pool } from 'pg';

const TENDERS_VIC_URL = 'https://www.tenders.vic.gov.au/tender/search';
const AUSTENDER_URL = 'https://www.tenders.gov.au/api/contractnotice';

const KEYWORDS = ['bridge', 'viaduct', 'strengthening', 'post-tension', 'CFRP', 'rehabilitation', 'overpass'];
const FUZZY_THRESHOLD = 70;

interface Tender {
  title: string;
  url: string;
  agency: string | null;
  published_date: string | null;
  status: string | null;
  value_aud: number | null;
  summary: string | null;
  bridge_id: string | null;
}

interface IngestResult {
  vic_scraped: number;
  austender_fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

// Simple partial-ratio-style fuzzy check: does title contain enough words from bridge name?
function fuzzyMatch(title: string, bridges: Array<{ id: string; name: string }>): string | null {
  const t = title.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const b of bridges) {
    const nameLower = b.name.toLowerCase();
    // Simple sliding-window: check if bridge name (or long substrings) appear in title
    // or if significant words from title appear in bridge name
    const words = nameLower.split(/\s+/).filter((w) => w.length > 3);
    const matches = words.filter((w) => t.includes(w));
    const score = words.length > 0 ? (matches.length / words.length) * 100 : 0;
    if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
      best = { id: b.id, score };
    }
  }
  return best?.id ?? null;
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // ISO: 2024-03-15 or 2024-03-15T00:00:00
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // AU: 15/03/2024
  const au = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (au) return `${au[3]}-${au[2]}-${au[1]}`;
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function parseValueAud(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,]/g, '');
  const m = cleaned.match(/[\d.]+/);
  if (!m) return null;
  let val = parseFloat(m[0] ?? '0');
  const lower = cleaned.toLowerCase();
  if (lower.includes('million') || lower.endsWith('m')) val *= 1_000_000;
  else if (lower.includes('thousand') || lower.endsWith('k')) val *= 1_000;
  return isNaN(val) ? null : Math.round(val);
}

// Extract href links containing /tender/ from raw HTML
function extractTenderLinks(html: string, baseUrl: string): Tender[] {
  const tenders: Tender[] = [];
  // Match anchor tags with href containing /tender/
  const linkRe = /<a[^>]+href="([^"]*\/tender\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1] ?? '';
    const rawTitle = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
    if (!rawTitle || rawTitle.length < 10) continue;
    const url = href.startsWith('http') ? href : baseUrl + href;
    tenders.push({
      title: rawTitle,
      url,
      agency: null,
      published_date: null,
      status: 'open',
      value_aud: null,
      summary: null,
      bridge_id: null,
    });
  }
  return tenders;
}

async function scrapeVicTenders(): Promise<Tender[]> {
  const seen = new Set<string>();
  const all: Tender[] = [];
  const baseUrl = 'https://www.tenders.vic.gov.au';

  for (const kw of KEYWORDS) {
    try {
      const url = `${TENDERS_VIC_URL}?keyword=${encodeURIComponent(kw)}&type=open`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VicBIP/1.0)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      const links = extractTenderLinks(html, baseUrl);
      for (const t of links) {
        if (!seen.has(t.url)) { seen.add(t.url); all.push(t); }
      }
      await new Promise((r) => setTimeout(r, 800));
    } catch {
      /* continue with next keyword */
    }
  }
  return all;
}

async function fetchAusTenders(): Promise<Tender[]> {
  const seen = new Set<string>();
  const all: Tender[] = [];
  const queries = ['bridge victoria', 'viaduct victoria', 'strengthening victoria'];

  for (const kw of queries) {
    try {
      const url = new URL(AUSTENDER_URL);
      url.searchParams.set('keyword', kw);
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('agency_state', 'VIC');
      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': 'VicBIP/1.0' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as unknown;
      const items: unknown[] = Array.isArray(data)
        ? data
        : ((data as Record<string, unknown>)['results'] as unknown[] | undefined) ??
          ((data as Record<string, unknown>)['contractNotices'] as unknown[] | undefined) ?? [];

      for (const item of items) {
        const i = item as Record<string, unknown>;
        const title = String(i['description'] ?? i['title'] ?? '').trim();
        if (!title) continue;
        const cnId = i['cn_id'] ?? i['id'] ?? i['contractNoticeId'];
        const rawUrl = String(i['url'] ?? i['link'] ?? (cnId ? `https://www.tenders.gov.au/cn/show/${cnId}` : ''));
        if (!rawUrl || seen.has(rawUrl)) continue;
        seen.add(rawUrl);
        const agency = i['agency'];
        all.push({
          title,
          url: rawUrl,
          agency: typeof agency === 'object' && agency
            ? String((agency as Record<string, unknown>)['name'] ?? agency)
            : agency ? String(agency) : null,
          published_date: parseDate(String(i['publishDate'] ?? i['datePublished'] ?? '')),
          status: String(i['status'] ?? 'awarded'),
          value_aud: parseValueAud(String(i['value'] ?? i['contractValue'] ?? '')),
          summary: null,
          bridge_id: null,
        });
      }
      await new Promise((r) => setTimeout(r, 800));
    } catch {
      /* continue */
    }
  }
  return all;
}

async function upsertTender(pool: Pool, t: Tender, source: string): Promise<'inserted' | 'updated'> {
  const r = await pool.query(
    `INSERT INTO bridge_tenders (bridge_id, title, published_date, agency, status, value_aud, source, url, summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (url) DO UPDATE SET
       title=EXCLUDED.title,
       bridge_id=COALESCE(EXCLUDED.bridge_id, bridge_tenders.bridge_id),
       published_date=EXCLUDED.published_date,
       agency=EXCLUDED.agency, status=EXCLUDED.status,
       value_aud=EXCLUDED.value_aud, summary=EXCLUDED.summary
     RETURNING (xmax=0) AS is_insert`,
    [t.bridge_id, t.title, t.published_date, t.agency, t.status, t.value_aud, source, t.url, t.summary],
  );
  const row = r.rows[0] as { is_insert: boolean } | undefined;
  return row?.is_insert ? 'inserted' : 'updated';
}

export async function runTenderScrape(pool: Pool): Promise<IngestResult> {
  const bridgesRes = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM bridges',
  );
  const bridges = bridgesRes.rows;

  const [vicTenders, ausTenders] = await Promise.all([scrapeVicTenders(), fetchAusTenders()]);
  console.log(`[tenders] vic=${vicTenders.length} aus=${ausTenders.length}`);

  let inserted = 0, updated = 0, skipped = 0, errors = 0;

  const process = async (tenders: Tender[], source: string) => {
    for (const t of tenders) {
      t.bridge_id = fuzzyMatch(t.title, bridges);
      try {
        const result = await upsertTender(pool, t, source);
        if (result === 'inserted') inserted++; else updated++;
      } catch {
        errors++;
      }
    }
  };

  await process(vicTenders, 'tenders.vic.gov.au');
  await process(ausTenders, 'tenders.gov.au');

  return {
    vic_scraped: vicTenders.length,
    austender_fetched: ausTenders.length,
    inserted,
    updated,
    skipped,
    errors,
  };
}
