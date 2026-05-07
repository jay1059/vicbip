/**
 * Content API — fetches Australian infrastructure news via Google Custom Search
 * and serves it for the BD LinkedIn Content Feed panel.
 * Results are cached in memory for 6 hours to stay within API quotas.
 */
import { Router, Request, Response } from 'express';
import type { NewsArticle } from '@vicbip/shared';

const router = Router();

interface CacheEntry {
  data: NewsArticle[];
  ts: number;
}

let cache: CacheEntry | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const FALLBACK_ARTICLES: NewsArticle[] = [
  {
    title: 'Inland Rail extension to Brisbane scrapped after cost blowout to $45 billion',
    url: 'https://bigrigs.com.au/2026/05/06/plans-scrapped-to-extend-inland-rail-project-to-brisbane/',
    snippet:
      'The federal government has scrapped plans to extend Inland Rail to Brisbane after costs blew out to over $45 billion — more than three times the original budget. The line will now terminate at Parkes in central west NSW.',
    source: 'bigrigs.com.au',
    published: '2026-05-06',
  },
  {
    title: 'New Bridgewater Bridge opens in Tasmania — $786M project replaces 1940s structure',
    url: 'https://australiatimes.com/new-bridgewater-bridge-opens-in-tasmania-enhancing-connectivity-and-infrastructure',
    snippet:
      "Tasmania's largest ever transport infrastructure project has officially opened, replacing a bridge from the 1940s and a convicts-built causeway from the 1830s. The $786M project was delivered on time and within budget supporting approximately 1,000 jobs.",
    source: 'australiatimes.com',
    published: '2026-05-01',
  },
  {
    title: 'Australian bridge construction market to reach $50.6 billion by 2034',
    url: 'https://vocal.media/trader/australia-bridge-construction-market-2026',
    snippet:
      'The Australia bridge construction market reached USD $34.7 billion in 2025 and is projected to reach USD $50.6 billion by 2034, driven by the need to upgrade ageing bridge structures and meet modern safety standards.',
    source: 'vocal.media',
    published: '2026-04-15',
  },
];

// GET /api/content/linkedin-feed
router.get('/linkedin-feed', async (req: Request, res: Response): Promise<void> => {
  const refresh = req.query['refresh'] === 'true';

  if (!refresh && cache && Date.now() - cache.ts < TTL_MS) {
    res.json({ articles: cache.data, generated_at: new Date(cache.ts).toISOString(), cached: true });
    return;
  }

  const apiKey = process.env['GOOGLE_SEARCH_API_KEY'];
  const cx = process.env['GOOGLE_SEARCH_CX'];

  console.log('[content] GOOGLE_SEARCH_API_KEY:', apiKey ? 'SET' : 'MISSING');
  console.log('[content] GOOGLE_SEARCH_CX:', cx ? 'SET' : 'MISSING');

  if (!apiKey || !cx) {
    console.warn('[content] API keys missing — returning fallback articles');
    res.json({ articles: FALLBACK_ARTICLES, generated_at: new Date().toISOString(), cached: false, fallback: true });
    return;
  }

  const queries = [
    'Australian bridge infrastructure news 2026',
    'Victorian bridge strengthening construction 2026',
    'Australia infrastructure funding announcement 2026',
  ];

  const articles: NewsArticle[] = [];
  const seen = new Set<string>();

  type SearchItem = {
    title: string;
    link: string;
    snippet: string;
    pagemap?: { metatags?: Array<Record<string, string>> };
  };

  await Promise.allSettled(
    queries.map(async (query) => {
      const url =
        `https://www.googleapis.com/customsearch/v1` +
        `?key=${apiKey}&cx=${cx}` +
        `&q=${encodeURIComponent(query)}&num=3&dateRestrict=m1`;
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
          console.warn(`[content] Google CSE ${resp.status} for query: ${query}`);
          return;
        }
        const data = (await resp.json()) as { items?: SearchItem[] };
        for (const item of data.items ?? []) {
          if (seen.has(item.link)) continue;
          seen.add(item.link);
          const metatags = item.pagemap?.metatags?.[0] ?? {};
          const published =
            metatags['article:published_time'] ??
            metatags['og:updated_time'] ??
            metatags['date'] ??
            '';
          articles.push({
            title: item.title,
            url: item.link,
            snippet: item.snippet,
            source: extractDomain(item.link),
            published,
          });
        }
      } catch (e) {
        console.warn(`[content] CSE fetch error for "${query}":`, String(e).slice(0, 80));
      }
    }),
  );

  const result = articles.length > 0 ? articles.slice(0, 9) : FALLBACK_ARTICLES;
  const generatedAt = new Date().toISOString();
  cache = { data: result, ts: Date.now() };

  const usedFallback = articles.length === 0;
  console.log(`[content] linkedin-feed: ${result.length} articles (fallback=${usedFallback})`);
  res.json({ articles: result, generated_at: generatedAt, cached: false, fallback: usedFallback });
});

export default router;
