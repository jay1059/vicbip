import React, { useState, useEffect, useCallback } from 'react';
import type { NewsArticle } from '@vicbip/shared';

const ANTHROPIC_KEY = import.meta.env['VITE_ANTHROPIC_API_KEY'] as string | undefined;

const SYSTEM_PROMPT =
  `You are the LinkedIn content writer for Freyssinet Australia, a specialist bridge ` +
  `strengthening and post-tensioning contractor. Write a LinkedIn post (max 200 words) ` +
  `based on this news that positions Freyssinet as a thought leader in bridge infrastructure. ` +
  `Connect the news to bridge strengthening, asset management, or structural engineering. ` +
  `End with 4-5 hashtags including #FreyssinetAustralia. ` +
  `No preamble — write only the post text.`;

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
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap flex-1 min-h-[120px] max-h-64 overflow-y-auto mb-3">
              {draft}
            </p>
            <div className="flex gap-2 mt-auto">
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
            content: `${SYSTEM_PROMPT}\n\nTitle: ${article.title}\nSnippet: ${article.snippet}`,
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
