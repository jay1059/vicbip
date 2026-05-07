import React, { useState, useEffect, useCallback } from 'react';
import type { NewsArticle } from '@vicbip/shared';

const ANTHROPIC_KEY = import.meta.env['VITE_ANTHROPIC_API_KEY'] as string | undefined;

const SYSTEM_PROMPT = `You are writing a LinkedIn post for Jaykerr Cheong, Business Development Engineer at Freyssinet Australia — a specialist bridge strengthening, post-tensioning, and heavy lifting contractor based in Melbourne.

VOICE — match this style exactly:
- Direct, technically credible, warm and human
- Engineer who thinks commercially, not a marketer
- Uses the why/what/how framework naturally
- Comfortable with 1-2 emojis per post (not overdone)
- Acknowledges teams and partners genuinely
- Connects engineering detail to broader purpose
- Occasional philosophical observation is fine

REAL POST EXAMPLES to match tone:

Example 1:
"The kind of challenge Freyssinet Australia loves to tackle - Jacking critical infrastructure under occupation.

Jacking works always require careful control of displacements and load paths to protect assets and keep programs moving. But for critical infrastructure, this requires an even deeper appreciation, here with live monitoring and a bespoke methodology, we deliver safe, precise and timely outcomes.

If your job demands millimetre control under live conditions, we're ready!

#Freyssinet #StructuralJacking #UnderOccupation #Rail #Infrastructure #TemporaryWorks"

Example 2:
"🛠 Deliver with Certainty (Especially when under pressure)
Time-critical works demand more than just good planning, they require the right people who can perform under pressure.

That's why Freyssinet was proud to support the Silk Street Bridge works with our post-tensioning crew during a tightly managed occupation. With limited a working window and zero room for error, our experienced team brought the precision, safety, and calm execution needed to get the job done right the first time.

When you bring your why and what, whether it's program certainty, technical assurance, or delivery risk, we help shape the how with confidence on site.

#Freyssinet #NorthEastLink #PostTensioning #WhyWeBuild #ShutdownSuccess"

STRUCTURE:
Line 1: Hook — bold statement or emoji + short punchy line. Must work before the "...more" cutoff (~200 chars). No "I'm excited" or "Great news".
Lines 2-4: 2-3 short paragraphs. Connect the news to Freyssinet's work in bridge strengthening, asset management, post-tensioning, or CFRP. Be specific about the engineering challenge.
Final line: 5-8 hashtags. Always include #Freyssinet. Mix specific technical tags with broader ones.

RULES:
- 150-220 words
- 1-2 emojis maximum, used purposefully
- No bullet points in the body
- No words: "excited", "thrilled", "leverage", "ecosystem", "innovative", "game-changer"
- Do not start with "I" or "We"
- End with a warm forward-looking line or acknowledgment before the hashtags
- Write only the post. No preamble.

News to write about:`;

function SkeletonCard(): React.ReactElement {
  return (
    <div className="animate-pulse rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
      <div className="p-4 space-y-2 border-b border-slate-100 dark:border-slate-700">
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-4/5" />
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full mt-2" />
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
      </div>
      <div className="p-4 space-y-2">
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
        <div className="h-24 bg-slate-100 dark:bg-slate-700/50 rounded" />
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
    </div>
  );
}

interface ArticleCardProps {
  article: NewsArticle;
  draft: string | undefined;
  generating: boolean;
  onGenerate: (article: NewsArticle) => void;
}

function ArticleCard({ article, draft, generating, onGenerate }: ArticleCardProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!draft) return;
    navigator.clipboard.writeText(draft).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmtDate = (s: string) => {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return s; }
  };

  const n = article.image_url ? 1 : 0; // offset for numbering

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm flex flex-col overflow-hidden">
      {/* Article header */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
            {article.source}{article.published ? ` · ${fmtDate(article.published)}` : ''}
          </span>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-blue hover:underline shrink-0 ml-2"
          >
            Read ↗
          </a>
        </div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 mb-2">
          {article.title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-3">
          {article.snippet}
        </p>
      </div>

      {/* IMAGE OPTIONS — always visible, between snippet and draft */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-700">
        <p
          style={{
            color: '#E8731A',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '6px',
          }}
        >
          Image Options
        </p>

        {/* Option 1: og:image from article (conditional) */}
        {article.image_url && (
          <div className="mb-2">
            <p className="text-[10px] text-slate-500 mb-1">1. Article photo (from source)</p>
            <img
              src={article.image_url}
              alt="Article image"
              className="w-full rounded object-cover mb-1"
              style={{ height: '72px' }}
              onError={(e) => {
                const parent = e.currentTarget.parentElement;
                if (parent) parent.style.display = 'none';
              }}
            />
            <a
              href={article.image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-brand-blue hover:underline"
            >
              Download image ↗
            </a>
          </div>
        )}

        {/* Option 2: contextual Unsplash photo via images.unsplash.com (source.unsplash.com deprecated) */}
        {(() => {
          const title = article.title.toLowerCase();
          const photoId =
            title.includes('rail') || title.includes('train')
              ? 'photo-1474487548417-781cb6d646b3'
              : title.includes('bridge') || title.includes('tasmania')
              ? 'photo-1558618666-fcd25c85cd64'
              : title.includes('construction') || title.includes('market')
              ? 'photo-1504307651254-35680f356dfd'
              : title.includes('freight') || title.includes('road')
              ? 'photo-1601584115197-04ecc0da31d7'
              : title.includes('fund') || title.includes('budget')
              ? 'photo-1486325212027-8081e485255e'
              : 'photo-1588421357574-87938a86fa28';

          const imgUrl =
            `https://images.unsplash.com/${photoId}` +
            `?w=640&h=360&fit=crop&auto=format`;

          return (
            <div className="mb-2">
              <p className="text-[10px] text-slate-500 mb-1 font-medium">
                {n + 1}. Ready-to-use photo — right-click → Save, then upload to LinkedIn
              </p>
              <img
                src={imgUrl}
                alt="Infrastructure photo"
                className="w-full rounded object-cover cursor-pointer hover:opacity-90 transition-opacity"
                style={{ height: '110px' }}
                onClick={() => window.open(imgUrl, '_blank')}
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    'https://images.unsplash.com/photo-1588421357574-87938a86fa28?w=640&h=360&fit=crop';
                }}
              />
              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[10px] text-slate-400 italic">
                  Free to use · Credit: Unsplash
                </p>
                <a
                  href={imgUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-brand-blue hover:underline"
                >
                  ↓ Open full size
                </a>
              </div>
            </div>
          );
        })()}

        {/* Option 3: Freyssinet project photo */}
        <div>
          <p className="text-[10px] text-slate-500 mb-0.5">
            {n + 2}. Freyssinet project photo (best)
          </p>
          <a
            href="https://www.freyssinet.com.au/projects"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-brand-blue hover:underline"
          >
            Freyssinet project gallery ↗
          </a>
          <span className="text-[10px] text-slate-400"> · PT works, CFRP, inspection photos</span>
        </div>
      </div>

      {/* LinkedIn draft area */}
      <div className="flex flex-col flex-1 p-4">
        <div className="flex items-center justify-between mb-3">
          <span
            style={{
              color: '#E8731A',
              fontSize: '9px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            LinkedIn Draft
          </span>
          {!draft && (
            <button
              onClick={() => onGenerate(article)}
              disabled={generating}
              className="flex items-center gap-1.5 text-xs px-3 py-1 bg-brand-blue text-white rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {generating ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                  Writing…
                </>
              ) : (
                <>✨ Generate</>
              )}
            </button>
          )}
        </div>

        {draft ? (
          <div className="flex flex-col flex-1">
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap flex-1 min-h-[120px] max-h-72 overflow-y-auto mb-3">
              {draft}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className={`flex-1 text-xs py-2 rounded border transition-colors ${
                  copied
                    ? 'border-green-500 text-green-600 bg-green-50 dark:bg-green-900/20'
                    : 'border-brand-blue text-brand-blue hover:bg-blue-50 dark:hover:bg-blue-900/20'
                }`}
              >
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
              <a
                href="https://www.linkedin.com/post/new"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-xs py-2 bg-brand-blue text-white rounded text-center hover:opacity-90 transition-opacity"
              >
                Post to LinkedIn →
              </a>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            Click Generate to create a LinkedIn post from this article.
          </p>
        )}
      </div>
    </div>
  );
}

export function ContentPage(): React.ReactElement {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const loadArticles = useCallback((refresh = false) => {
    setLoading(true);
    fetch(`/api/content/linkedin-feed${refresh ? '?refresh=true' : ''}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { articles?: NewsArticle[]; generated_at?: string };
        setArticles(data.articles ?? []);
        setGeneratedAt(data.generated_at ?? null);
        if (refresh) setDrafts({});
      })
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  const generatePost = useCallback(async (article: NewsArticle) => {
    setGenerating(article.url);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      if (ANTHROPIC_KEY) headers['x-api-key'] = ANTHROPIC_KEY;

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `${SYSTEM_PROMPT}\nTitle: ${article.title}\nSnippet: ${article.snippet}`,
          }],
        }),
      });

      const data = (await resp.json()) as {
        content?: Array<{ type: string; text: string }>;
        error?: { message: string };
      };

      if (data.error) throw new Error(data.error.message);
      const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
      setDrafts((prev) => ({ ...prev, [article.url]: text || 'Empty response — try again.' }));
    } catch (e) {
      setDrafts((prev) => ({
        ...prev,
        [article.url]: `Could not generate: ${String(e).slice(0, 100)}\n\nEnsure VITE_ANTHROPIC_API_KEY is set.`,
      }));
    } finally {
      setGenerating(null);
    }
  }, []);

  const fmtUpdated = (iso: string | null) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  return (
    <div className="h-screen overflow-y-auto bg-slate-50 dark:bg-slate-950">
      {/* Page header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">BD Content Engine</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Daily LinkedIn drafts from current Australian infrastructure news
            </p>
          </div>
          <div className="flex items-center gap-3">
            {generatedAt && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Last updated: {fmtUpdated(generatedAt)}
              </span>
            )}
            <button
              onClick={() => loadArticles(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-brand-blue text-brand-blue text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <span className="w-3.5 h-3.5 border-2 border-brand-blue/40 border-t-brand-blue rounded-full animate-spin" aria-hidden="true" />
              ) : '↻'}
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 py-6 pb-20">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : articles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-lg font-medium text-slate-600 dark:text-slate-400 mb-4">
              No articles found.
            </p>
            <button
              onClick={() => loadArticles(true)}
              className="px-4 py-2 rounded bg-brand-blue text-white text-sm font-medium hover:opacity-90 mb-4"
            >
              ↻ Refresh feed
            </button>
            <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
              Check{' '}
              <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">GOOGLE_SEARCH_API_KEY</code>
              {' '}and{' '}
              <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">GOOGLE_SEARCH_CX</code>
              {' '}in Railway variables.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {articles.map((article) => (
              <ArticleCard
                key={article.url}
                article={article}
                draft={drafts[article.url]}
                generating={generating === article.url}
                onGenerate={generatePost}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
