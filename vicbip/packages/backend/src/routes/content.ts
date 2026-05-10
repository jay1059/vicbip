/**
 * Content API
 *   GET /api/content/linkedin-feed    — Australian infrastructure news (Google CSE)
 *   GET /api/content/future-projects  — Victorian project corridors as GeoJSON
 */
import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import type { NewsArticle } from '@vicbip/shared';

const router = Router();

// ── News feed ─────────────────────────────────────────────────────────────────

interface CacheEntry { data: NewsArticle[]; ts: number; }
let cache: CacheEntry | null = null;
const TTL_MS = 6 * 60 * 60 * 1000;

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

async function getArticleImage(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VicBIP/1.0)' },
      signal: AbortSignal.timeout(5_000), redirect: 'follow',
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const match =
      html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ??
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) ??
      html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
    const src = match?.[1] ?? null;
    if (src && !src.startsWith('http')) { try { return new URL(src, url).href; } catch { return null; } }
    return src;
  } catch { return null; }
}

const FALLBACK_ARTICLES: NewsArticle[] = [
  {
    title: 'Inland Rail extension to Brisbane scrapped after cost blowout to $45 billion',
    url: 'https://bigrigs.com.au/2026/05/06/plans-scrapped-to-extend-inland-rail-project-to-brisbane/',
    snippet: 'The federal government has scrapped plans to extend Inland Rail to Brisbane after costs blew out to over $45 billion — more than three times the original budget.',
    source: 'bigrigs.com.au', published: '2026-05-06', image_url: null,
  },
  {
    title: 'New Bridgewater Bridge opens in Tasmania — $786M project replaces 1940s structure',
    url: 'https://australiatimes.com/new-bridgewater-bridge-opens-in-tasmania-enhancing-connectivity-and-infrastructure',
    snippet: "Tasmania's largest ever transport infrastructure project has officially opened, replacing a bridge from the 1940s and a convicts-built causeway from the 1830s.",
    source: 'australiatimes.com', published: '2026-05-01', image_url: null,
  },
  {
    title: 'Australian bridge construction market to reach $50.6 billion by 2034',
    url: 'https://vocal.media/trader/australia-bridge-construction-market-2026',
    snippet: 'The Australia bridge construction market reached USD $34.7 billion in 2025 and is projected to reach USD $50.6 billion by 2034, driven by the need to upgrade ageing bridge structures.',
    source: 'vocal.media', published: '2026-04-15', image_url: null,
  },
];

router.get('/linkedin-feed', async (req: Request, res: Response): Promise<void> => {
  const refresh = req.query['refresh'] === 'true';
  if (!refresh && cache && Date.now() - cache.ts < TTL_MS) {
    res.json({ articles: cache.data, generated_at: new Date(cache.ts).toISOString(), cached: true }); return;
  }

  const apiKey = process.env['GOOGLE_SEARCH_API_KEY'];
  const cx = process.env['GOOGLE_SEARCH_CX'];
  console.log('[content] GOOGLE_SEARCH_API_KEY:', apiKey ? 'SET' : 'MISSING');
  console.log('[content] GOOGLE_SEARCH_CX:', cx ? 'SET' : 'MISSING');

  if (!apiKey || !cx) {
    res.json({ articles: FALLBACK_ARTICLES, generated_at: new Date().toISOString(), cached: false, fallback: true }); return;
  }

  const queries = [
    'Australian bridge infrastructure news 2026',
    'Victorian bridge strengthening construction 2026',
    'Australia infrastructure funding announcement 2026',
  ];

  const articles: NewsArticle[] = [];
  const seen = new Set<string>();

  type SearchItem = {
    title: string; link: string; snippet: string;
    pagemap?: { metatags?: Array<Record<string, string>>; cse_image?: Array<{ src?: string }> };
  };

  await Promise.allSettled(
    queries.map(async (query) => {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=3&dateRestrict=m1`;
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) { console.warn(`[content] CSE ${resp.status} for: ${query}`); return; }
        const data = (await resp.json()) as { items?: SearchItem[] };
        for (const item of data.items ?? []) {
          if (seen.has(item.link)) continue;
          seen.add(item.link);
          const metatags = item.pagemap?.metatags?.[0] ?? {};
          const published = metatags['article:published_time'] ?? metatags['og:updated_time'] ?? metatags['date'] ?? '';
          const quickImage = item.pagemap?.cse_image?.[0]?.src ?? metatags['og:image'] ?? metatags['twitter:image'] ?? null;
          articles.push({ title: item.title, url: item.link, snippet: item.snippet, source: extractDomain(item.link), published, image_url: quickImage });
        }
      } catch (e) { console.warn(`[content] CSE error for "${query}":`, String(e).slice(0, 80)); }
    }),
  );

  const preResult = articles.length > 0 ? articles.slice(0, 9) : FALLBACK_ARTICLES;
  const withImages = await Promise.all(
    preResult.map(async (a) => a.image_url ? a : { ...a, image_url: await getArticleImage(a.url) }),
  );

  const result = withImages;
  cache = { data: result, ts: Date.now() };
  const usedFallback = articles.length === 0;
  console.log(`[content] linkedin-feed: ${result.length} articles (fallback=${usedFallback})`);
  res.json({ articles: result, generated_at: new Date().toISOString(), cached: false, fallback: usedFallback });
});

// ── Future project corridors as GeoJSON ───────────────────────────────────────

router.get('/future-projects', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<{
      project_name: string; project_code: string | null;
      category: string | null; status: string | null;
      waypoints: [number, number][];
    }>(
      `SELECT fp.project_name, fp.project_code, fp.category, fp.status, fpc.waypoints
       FROM future_projects fp
       JOIN future_project_corridors fpc ON fpc.project_id = fp.id`,
    );

    const features = result.rows.map((row) => ({
      type: 'Feature' as const,
      properties: {
        project_name: row.project_name,
        code: row.project_code,
        category: row.category,
        status: row.status,
      },
      geometry: {
        type: 'LineString' as const,
        // Waypoints stored as [lat,lng]; GeoJSON needs [lng,lat]
        coordinates: (Array.isArray(row.waypoints) ? row.waypoints : []).map(
          ([lat, lng]: [number, number]) => [lng, lat],
        ),
      },
    }));

    res.json({ type: 'FeatureCollection', features });
  } catch {
    // Table may not exist yet — return empty collection
    res.json({ type: 'FeatureCollection', features: [] });
  }
});

export default router;
