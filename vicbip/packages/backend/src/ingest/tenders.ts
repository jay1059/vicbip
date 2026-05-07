/**
 * Tender scraper v4.0
 * Sources:
 *   1. tenders.vic.gov.au   — often WAF-blocked, kept for completeness
 *   2. australiantenders.com.au/vic-government-tenders (pages 1–3)
 *   3. tenderlink.com/victoria
 *   4. tenders.gov.au API   — federal AusTender
 *
 * All sources are tried in parallel; failures are non-fatal.
 */
import { Pool } from 'pg';

const TENDERS_VIC_SEARCH = 'https://www.tenders.vic.gov.au/tender/search';
const AUSTENDER_URL = 'https://www.tenders.gov.au/api/contractnotice';
const AUSTN_BASE = 'https://www.australiantenders.com.au';
const TENDERLINK_BASE = 'https://www.tenderlink.com';

/** Keywords used to filter tender titles */
const TITLE_KEYWORDS = [
  'bridge', 'viaduct', 'culvert', 'overpass', 'strengthening',
  'post-tension', 'post tension', 'cfrp', 'rehabilitation',
  'road safety upgrade', 'barriers', 'structure',
];

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
  austn_scraped: number;
  tenderlink_scraped: number;
  austender_fetched: number;
  inserted: number;
  updated: number;
  errors: number;
  debug: Record<string, unknown>;
}

/** Returns true if the title matches any of the bridge-related keywords */
function titleMatches(title: string): boolean {
  const t = title.toLowerCase();
  return TITLE_KEYWORDS.some((kw) => t.includes(kw.toLowerCase()));
}

/** Simple word-overlap fuzzy match: returns best bridge id or null */
function fuzzyMatch(title: string, bridges: Array<{ id: string; name: string }>): string | null {
  const t = title.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const b of bridges) {
    const words = b.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) continue;
    const hits = words.filter((w) => t.includes(w)).length;
    if (hits < 2) continue;
    const score = (hits / words.length) * 100;
    if (score >= 40 && (!best || score > best.score)) {
      best = { id: b.id, score };
    }
  }
  return best?.id ?? null;
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const au = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (au) return `${au[3]}-${au[2]!.padStart(2, '0')}-${au[1]!.padStart(2, '0')}`;
  // "12 May 2026" style
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const longForm = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (longForm) {
    const mon = months[longForm[2]!.toLowerCase().slice(0, 3)];
    if (mon) return `${longForm[3]}-${mon}-${longForm[1]!.padStart(2, '0')}`;
  }
  try { return new Date(s).toISOString().slice(0, 10); } catch { return null; }
}

function parseValueAud(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const m = cleaned.match(/[\d.]+/);
  if (!m) return null;
  let val = parseFloat(m[0] ?? '0');
  const lower = cleaned.toLowerCase();
  if (lower.includes('million') || /\dm$/.test(lower)) val *= 1_000_000;
  else if (lower.includes('thousand') || /\dk$/.test(lower)) val *= 1_000;
  return isNaN(val) || val <= 0 ? null : Math.round(val);
}

/** Strip HTML tags, decode basic entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Generic link extractor for tenders.vic.gov.au */
function extractFromHtml(html: string, baseUrl: string): Tender[] {
  const tenders: Tender[] = [];
  const seen = new Set<string>();
  const linkRe = /<a[^>]+href="([^"]*(?:tender|contract|procurement)[^"]*)"[^>]*>([^<]{10,200})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1] ?? '';
    const rawTitle = stripHtml(m[2] ?? '').trim();
    if (!rawTitle || seen.has(href)) continue;
    seen.add(href);
    const url = href.startsWith('http') ? href : baseUrl + (href.startsWith('/') ? href : '/' + href);
    if (!titleMatches(rawTitle)) continue;
    tenders.push({ title: rawTitle, url, agency: null, published_date: null, status: 'open', value_aud: null, summary: null, bridge_id: null });
  }
  return tenders;
}

/**
 * Parse tender items from australiantenders.com.au HTML.
 * The site renders a list of tenders; each item is typically a table row
 * or list item with an <a> tag containing the tender title and link.
 */
function extractAustralianTenders(html: string, baseUrl: string): Tender[] {
  const tenders: Tender[] = [];
  const seen = new Set<string>();

  // Pattern A: <td ...><a href="/tender/...">Title</a></td> with surrounding date/agency cells
  // Pattern B: <div class="..."><h3><a href="...">Title</a></h3> ...date... ...agency...</div>
  // Pattern C: any link whose href contains /tender/ or /notice/
  const patterns = [
    // Titled links inside headings
    /<h[2-4][^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]{8,250})<\/a>\s*<\/h[2-4]>/gi,
    // Links with class containing "title" or "heading"
    /<a[^>]+href="([^"]+)"[^>]*class="[^"]*(?:title|heading|tender)[^"]*"[^>]*>([^<]{8,250})<\/a>/gi,
    // Table cell links to tender detail pages
    /<td[^>]*>\s*<a[^>]+href="([^"]*(?:tender|notice|contract)[^"]*)"[^>]*>([^<]{8,250})<\/a>\s*<\/td>/gi,
    // Any anchor where title looks like a procurement notice
    /<a[^>]+href="(\/(?:tender|notice|contract)[^"]*)"[^>]*>([^<]{15,300})<\/a>/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = (m[1] ?? '').trim();
      const rawTitle = stripHtml(m[2] ?? '').trim();
      if (!rawTitle || rawTitle.length < 8) continue;
      if (seen.has(href + rawTitle)) continue;
      seen.add(href + rawTitle);
      const url = href.startsWith('http') ? href : baseUrl + (href.startsWith('/') ? href : '/' + href);
      if (!titleMatches(rawTitle)) continue;
      tenders.push({ title: rawTitle, url, agency: null, published_date: null, status: 'open', value_aud: null, summary: null, bridge_id: null });
    }
  }

  // Also try to extract dates and agencies from surrounding context
  // Look for a date near each tender link
  const dateRe = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/;
  const agencyRe = /<(?:td|span|div)[^>]*class="[^"]*(?:agency|council|organisation|org)[^"]*"[^>]*>([^<]{3,100})<\/(?:td|span|div)>/gi;

  let am: RegExpExecArray | null;
  while ((am = agencyRe.exec(html)) !== null) {
    // Assign agency to the last non-agency tender (rough heuristic)
    const lastTender = tenders[tenders.length - 1];
    if (lastTender && !lastTender.agency) {
      lastTender.agency = stripHtml(am[1] ?? '').trim() || null;
    }
  }

  // Try to extract publication dates from within 300 chars after each link
  // This is approximate — we re-scan the full HTML for date patterns
  for (const t of tenders) {
    if (!t.published_date) {
      const escaped = t.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ctxRe = new RegExp(escaped + '[\\s\\S]{0,400}');
      const ctx = ctxRe.exec(html)?.[0] ?? '';
      const dm = dateRe.exec(ctx);
      if (dm) t.published_date = parseDate(dm[0]);
    }
  }

  return tenders;
}

/**
 * Parse tender items from tenderlink.com/victoria HTML.
 * TenderLink renders a table or list of tenders.
 */
function extractTenderLinkTenders(html: string, baseUrl: string): Tender[] {
  const tenders: Tender[] = [];
  const seen = new Set<string>();

  // TenderLink typically has: <a href="/tender/VIC/...">Title</a>
  const re = /<a[^>]+href="((?:https?:\/\/www\.tenderlink\.com)?\/tender[^"]*)"[^>]*>([^<]{10,300})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[1] ?? '').trim();
    const rawTitle = stripHtml(m[2] ?? '').trim();
    if (!rawTitle || seen.has(href)) continue;
    seen.add(href);
    const url = href.startsWith('http') ? href : baseUrl + (href.startsWith('/') ? href : '/' + href);
    if (!titleMatches(rawTitle)) continue;
    tenders.push({ title: rawTitle, url, agency: null, published_date: null, status: 'open', value_aud: null, summary: null, bridge_id: null });
  }

  // Extract agency from council name patterns
  const councilRe = /([A-Z][a-z]+(?: [A-Z][a-z]+)* (?:Shire|City|Borough|Council|Shire Council|City Council))/g;
  let cm: RegExpExecArray | null;
  let tIdx = 0;
  while ((cm = councilRe.exec(html)) !== null && tIdx < tenders.length) {
    if (!tenders[tIdx]!.agency) tenders[tIdx]!.agency = cm[1] ?? null;
    tIdx++;
  }

  return tenders;
}

async function scrapeVicTenders(debugInfo: Record<string, unknown>): Promise<Tender[]> {
  const all: Tender[] = [];
  const seen = new Set<string>();
  const baseUrl = 'https://www.tenders.vic.gov.au';
  const legacyKeywords = ['bridge', 'viaduct', 'strengthening', 'rehabilitation', 'overpass'];

  for (const kw of legacyKeywords) {
    try {
      const urls = [
        `${TENDERS_VIC_SEARCH}?q=${encodeURIComponent(kw)}&type=open`,
        `${TENDERS_VIC_SEARCH}?keyword=${encodeURIComponent(kw)}&status=open`,
      ];
      for (const url of urls) {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VicBIP/1.0)', Accept: 'text/html' },
          signal: AbortSignal.timeout(12_000),
          redirect: 'follow',
        });
        const html = await resp.text();
        debugInfo[`vic_${kw}`] = { status: resp.status, len: html.length };
        if (!resp.ok || html.length < 500) continue;
        for (const t of extractFromHtml(html, baseUrl)) {
          if (!seen.has(t.url)) { seen.add(t.url); all.push(t); }
        }
        if (all.length > 0) break;
      }
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      debugInfo[`vic_err_${kw}`] = String(e);
    }
  }
  return all;
}

async function scrapeAustralianTenders(debugInfo: Record<string, unknown>): Promise<Tender[]> {
  const all: Tender[] = [];
  const seen = new Set<string>();
  const pages = [
    `${AUSTN_BASE}/vic-government-tenders`,
    `${AUSTN_BASE}/vic-government-tenders?page=2`,
    `${AUSTN_BASE}/vic-government-tenders?page=3`,
  ];

  for (let i = 0; i < pages.length; i++) {
    const url = pages[i]!;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-AU,en;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });
      const html = await resp.text();
      debugInfo[`austn_p${i + 1}`] = { status: resp.status, len: html.length, url, preview: html.slice(0, 400) };
      if (!resp.ok || html.length < 200) continue;

      for (const t of extractAustralianTenders(html, AUSTN_BASE)) {
        if (!seen.has(t.url)) { seen.add(t.url); all.push(t); }
      }
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      debugInfo[`austn_err_p${i + 1}`] = String(e);
    }
  }

  console.log(`[tenders] australiantenders.com.au scraped ${all.length} matching tenders`);
  return all;
}

async function scrapeTenderLink(debugInfo: Record<string, unknown>): Promise<Tender[]> {
  const all: Tender[] = [];
  const seen = new Set<string>();
  const url = `${TENDERLINK_BASE}/victoria/`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    const html = await resp.text();
    debugInfo['tenderlink'] = { status: resp.status, len: html.length, url, preview: html.slice(0, 400) };

    if (resp.ok && html.length > 200) {
      for (const t of extractTenderLinkTenders(html, TENDERLINK_BASE)) {
        if (!seen.has(t.url)) { seen.add(t.url); all.push(t); }
      }
    }
  } catch (e) {
    debugInfo['tenderlink_err'] = String(e);
  }

  console.log(`[tenders] tenderlink.com/victoria scraped ${all.length} matching tenders`);
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
      debugInfo[`aus_${kw.replace(/ /g, '_')}`] = { status: resp.status, len: rawText.length, preview: rawText.slice(0, 300) };
      if (!resp.ok) continue;

      let data: unknown;
      try { data = JSON.parse(rawText); } catch { continue; }

      const items: unknown[] = Array.isArray(data) ? data
        : ((data as Record<string, unknown>)['results'] as unknown[] | undefined)
        ?? ((data as Record<string, unknown>)['contractNotices'] as unknown[] | undefined) ?? [];

      for (const item of items) {
        const i = item as Record<string, unknown>;
        const title = String(i['description'] ?? i['title'] ?? '').trim();
        if (!title || !titleMatches(title)) continue;
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
      await new Promise((r) => setTimeout(r, 400));
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

  const [vicTenders, austnTenders, tenderLinkTenders, ausTenders] = await Promise.all([
    scrapeVicTenders(debugInfo),
    scrapeAustralianTenders(debugInfo),
    scrapeTenderLink(debugInfo),
    fetchAusTenders(debugInfo),
  ]);

  debugInfo['vic_total'] = vicTenders.length;
  debugInfo['austn_total'] = austnTenders.length;
  debugInfo['tenderlink_total'] = tenderLinkTenders.length;
  debugInfo['aus_total'] = ausTenders.length;

  console.log(
    `[tenders] vic=${vicTenders.length} austn=${austnTenders.length} ` +
    `tenderlink=${tenderLinkTenders.length} aus=${ausTenders.length}`,
  );

  let inserted = 0, updated = 0, errors = 0;

  const processBatch = async (tenders: Tender[], source: string) => {
    for (const t of tenders) {
      t.bridge_id = fuzzyMatch(t.title, bridges);
      try {
        const r = await upsertTender(pool, t, source);
        if (r === 'inserted') inserted++; else updated++;
      } catch (e) {
        console.warn(`[tenders] upsert error (${source}):`, String(e).slice(0, 120));
        errors++;
      }
    }
  };

  await processBatch(vicTenders, 'tenders.vic.gov.au');
  await processBatch(austnTenders, 'australiantenders.com.au');
  await processBatch(tenderLinkTenders, 'tenderlink.com');
  await processBatch(ausTenders, 'tenders.gov.au');

  return {
    vic_scraped: vicTenders.length,
    austn_scraped: austnTenders.length,
    tenderlink_scraped: tenderLinkTenders.length,
    austender_fetched: ausTenders.length,
    inserted,
    updated,
    errors,
    debug: debugInfo,
  };
}
