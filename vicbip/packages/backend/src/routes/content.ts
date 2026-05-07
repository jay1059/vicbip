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

// GET /api/content/linkedin-feed
router.get('/linkedin-feed', async (req: Request, res: Response): Promise<void> => {
  const refresh = req.query['refresh'] === 'true';

  if (!refresh && cache && Date.now() - cache.ts < TTL_MS) {
    res.json({ articles: cache.data, generated_at: new Date(cache.ts).toISOString(), cached: true });
    return;
  }

  const apiKey = process.env['GOOGLE_SEARCH_API_KEY'];
  const cx = process.env['GOOGLE_SEARCH_CX'];

  if (!apiKey || !cx) {
    res.status(500).json({
      error: 'GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX not configured',
      articles: [],
    });
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

  const result = articles.slice(0, 9);
  const generatedAt = new Date().toISOString();
  cache = { data: result, ts: Date.now() };

  console.log(`[content] linkedin-feed: fetched ${result.length} articles`);
  res.json({ articles: result, generated_at: generatedAt, cached: false });
});

export default router;
