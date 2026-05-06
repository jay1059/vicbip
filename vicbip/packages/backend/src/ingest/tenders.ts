/**
 * Scrape tender notices from tenders.vic.gov.au and AusTender.
 * v3.1 — both sites block server-side requests (Cloudflare / AWS WAF 403).
 * Returns 0 results with detailed debug output (HTTP status + body preview)
 * so the operator can diagnose the block and decide on alternatives.
 * All errors are non-fatal; the endpoint always returns success=true.
 */
import { Pool } from 'pg';

const TENDERS_VIC_SEARCH = 'https://www.tenders.vic.gov.au/tender/search';
const AUSTENDER_URL = 'https://www.tenders.gov.au/api/contractnotice';

const KEYWORDS = ['bridge', 'viaduct', 'strengthening', 'rehabilitation', 'overpass'];

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
  errors: number;
  debug: Record<string, unknown>;
}

/** Simple word-overlap fuzzy match: bridge name words found in tender title */
function fuzzyMatch(title: string, bridges: Array<{ id: string; name: string }>): string | null {
  const t = title.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const b of bridges) {
    const words = b.name.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    if (words.length === 0) continue;
    const hits = words.filter((w) => t.includes(w)).length;
    const score = (hits / words.length) * 100;
    if (score >= 60 && (!best || score > best.score)) {
      best = { id: b.id, score };
    }
  }
  return best?.id ?? null;
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const au = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (au) return `${au[3]}-${au[2]}-${au[1]}`;
  try { return new Date(s).toISOString().slice(0, 10); } catch { return null; }
}

function parseValueAud(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,]/g, '');
  const m = cleaned.match(/[\d.]+/);
  if (!m) return null;
  let val = parseFloat(m[0] ?? '0');
  const lower = cleaned.toLowerCase();
  if (lower.includes('million') || /\dm$/.test(lower)) val *= 1_000_000;
  else if (lower.includes('thousand') || /\dk$/.test(lower)) val *= 1_000;
  return isNaN(val) ? null : Math.round(val);
}

/** Extract tender-looking links and titles from HTML */
function extractFromHtml(html: string, baseUrl: string): Tender[] {
  const tenders: Tender[] = [];
  const seen = new Set<string>();

  // Pattern 1: <a href="...tender...">Title</a>
  const linkRe = /<a[^>]+href="([^"]*(?:tender|contract|procurement)[^"]*)"[^>]*>([^<]{10,200})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1] ?? '';
    const rawTitle = (m[2] ?? '').trim();
    if (!rawTitle || seen.has(href)) continue;
    seen.add(href);
    const url = href.startsWith('http') ? href : baseUrl + (href.startsWith('/') ? href : '/' + href);
    tenders.push({
      title: rawTitle,
      url,
      agency: null, published_date: null, status: 'open',
      value_aud: null, summary: null, bridge_id: null,
    });
  }
  return tenders;
}

async function scrapeVicTenders(debugInfo: Record<string, unknown>): Promise<Tender[]> {
  const all: Tender[] = [];
  const seen = new Set<string>();
  const baseUrl = 'https://www.tenders.vic.gov.au';

  for (const kw of KEYWORDS) {
    try {
      // Try both the old and new URL patterns
      const urls = [
        `${TENDERS_VIC_SEARCH}?q=${encodeURIComponent(kw)}&type=open`,
        `${TENDERS_VIC_SEARCH}?keyword=${encodeURIComponent(kw)}&status=open`,
        `${TENDERS_VIC_SEARCH}/result?keyword=${encodeURIComponent(kw)}&status=open`,
      ];

      for (const url of urls) {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; VicBIP/1.0)',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(15_000),
          redirect: 'follow',
        });

        const rawBody = await resp.text();
        const html = rawBody;
        const key = `vic_${kw}_${urls.indexOf(url)}`;
        if (!debugInfo[key]) {
          debugInfo[key] = {
            status: resp.status,
            html_length: html.length,
            url,
            body_preview: rawBody.slice(0, 500),
          };
        }

        if (!resp.ok || html.length < 500) continue;

        const links = extractFromHtml(html, baseUrl);
        for (const t of links) {
          if (!seen.has(t.url)) { seen.add(t.url); all.push(t); }
        }

        if (links.length > 0) break; // found results, don't try other URL patterns
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      debugInfo[`vic_${kw}_err`] = String(e);
    }
  }
  return all;
}

async function fetchAusTenders(debugInfo: Record<string, unknown>): Promise<Tender[]> {
  const all: Tender[] = [];
  const seen = new Set<string>();
  const queries = ['bridge victoria', 'viaduct victoria', 'strengthening victoria'];

  for (const kw of queries) {
    try {
      const url = `${AUSTENDER_URL}?keyword=${encodeURIComponent(kw)}&pageSize=100`;
      const resp = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'VicBIP/1.0' },
        signal: AbortSignal.timeout(20_000),
      });

      const rawText = await resp.text();
      debugInfo[`aus_${kw.replace(/ /g, '_')}`] = {
        status: resp.status,
        len: rawText.length,
        body_preview: rawText.slice(0, 500),
      };

      if (!resp.ok) continue;

      let data: unknown;
      try { data = JSON.parse(rawText); } catch { continue; }

      const items: unknown[] = Array.isArray(data) ? data
        : ((data as Record<string, unknown>)['results'] as unknown[] | undefined)
        ?? ((data as Record<string, unknown>)['contractNotices'] as unknown[] | undefined) ?? [];

      for (const item of items) {
        const i = item as Record<string, unknown>;
        const title = String(i['description'] ?? i['title'] ?? '').trim();
        if (!title) continue;
        const cnId = i['cn_id'] ?? i['id'] ?? i['contractNoticeId'];
        const rawUrl = String(
          i['url'] ?? i['link'] ??
          (cnId ? `https://www.tenders.gov.au/cn/show/${cnId}` : ''),
        );
        if (!rawUrl || seen.has(rawUrl)) continue;
        seen.add(rawUrl);
        const agency = i['agency'];
        all.push({
          title,
          url: rawUrl,
          agency: agency
            ? (typeof agency === 'object'
              ? String((agency as Record<string, unknown>)['name'] ?? '')
              : String(agency))
            : null,
          published_date: parseDate(String(i['publishDate'] ?? i['datePublished'] ?? '')),
          status: String(i['status'] ?? 'awarded'),
          value_aud: parseValueAud(String(i['value'] ?? i['contractValue'] ?? '')),
          summary: null,
          bridge_id: null,
        });
      }
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      debugInfo[`aus_err_${kw}`] = String(e);
    }
  }
  return all;
}

async function upsertTender(pool: Pool, t: Tender, source: string): Promise<'inserted' | 'updated'> {
  const r = await pool.query(
    `INSERT INTO bridge_tenders (bridge_id,title,published_date,agency,status,value_aud,source,url,summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (url) DO UPDATE SET
       title=EXCLUDED.title,
       bridge_id=COALESCE(EXCLUDED.bridge_id,bridge_tenders.bridge_id),
       published_date=EXCLUDED.published_date,
       agency=EXCLUDED.agency, status=EXCLUDED.status,
       value_aud=EXCLUDED.value_aud, summary=EXCLUDED.summary
     RETURNING (xmax=0) AS is_insert`,
    [t.bridge_id, t.title, t.published_date, t.agency, t.status, t.value_aud, source, t.url, t.summary],
  );
  return (r.rows[0] as { is_insert: boolean } | undefined)?.is_insert ? 'inserted' : 'updated';
}

export async function runTenderScrape(pool: Pool): Promise<IngestResult> {
  const debugInfo: Record<string, unknown> = {};

  const bridgesRes = await pool.query<{ id: string; name: string }>('SELECT id, name FROM bridges');
  const bridges = bridgesRes.rows;

  const [vicTenders, ausTenders] = await Promise.all([
    scrapeVicTenders(debugInfo),
    fetchAusTenders(debugInfo),
  ]);

  console.log(`[tenders] vic=${vicTenders.length} aus=${ausTenders.length}`);
  debugInfo['vic_total'] = vicTenders.length;
  debugInfo['aus_total'] = ausTenders.length;

  let inserted = 0, updated = 0, errors = 0;

  const process = async (tenders: Tender[], source: string) => {
    for (const t of tenders) {
      t.bridge_id = fuzzyMatch(t.title, bridges);
      try {
        const r = await upsertTender(pool, t, source);
        if (r === 'inserted') inserted++; else updated++;
      } catch {
        errors++;
      }
    }
  };

  await process(vicTenders, 'tenders.vic.gov.au');
  await process(ausTenders, 'tenders.gov.au');

  return { vic_scraped: vicTenders.length, austender_fetched: ausTenders.length, inserted, updated, errors, debug: debugInfo };
}
