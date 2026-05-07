import { useState, useEffect, useRef } from 'react';
import type { NewsArticle } from '@vicbip/shared';

const ANTHROPIC_KEY = import.meta.env['VITE_ANTHROPIC_API_KEY'] as string | undefined;

const SYSTEM_PROMPT =
  `You are the LinkedIn content writer for Freyssinet Australia, a specialist bridge ` +
  `strengthening and post-tensioning contractor. Write a LinkedIn post (max 200 words) ` +
  `based on this news that positions Freyssinet as a thought leader in bridge infrastructure. ` +
  `Connect the news to bridge strengthening, asset management, or structural engineering. ` +
  `End with 4-5 hashtags including #FreyssinetAustralia. ` +
  `No preamble — write only the post text.`;

export function ContentFeed(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const loadArticles = (refresh = false) => {
    setLoading(true);
    fetch(`/api/content/linkedin-feed${refresh ? '?refresh=true' : ''}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { articles?: NewsArticle[] };
        setArticles(data.articles ?? []);
      })
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadArticles();
  }, []);

  const generatePost = async (article: NewsArticle) => {
    setGenerating(article.url);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      if (ANTHROPIC_KEY) headers['x-api-key'] = ANTHROPIC_KEY;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 400,
          messages: [
            {
              role: 'user',
              content:
                `${SYSTEM_PROMPT}\n\nTitle: ${article.title}\nSnippet: ${article.snippet}`,
            },
          ],
        }),
      });
      const data = (await response.json()) as {
        content?: Array<{ type: string; text: string }>;
        error?: { message: string };
      };
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
      setDrafts((prev) => ({ ...prev, [article.url]: text || 'Empty response — try again.' }));
    } catch (e) {
      setDrafts((prev) => ({
        ...prev,
        [article.url]: `Could not generate post: ${String(e).slice(0, 80)}`,
      }));
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div
      className="fixed left-0 right-0 z-40"
      style={{ bottom: '32px' }}
    >
      {/* Tab handle — always visible above disclaimer */}
      <div className="flex justify-center">
        <button
          onClick={() => setIsOpen((o) => !o)}
          className="flex items-center gap-2 px-4 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-t-lg shadow-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          aria-expanded={isOpen}
          aria-label="Toggle BD Content Feed"
        >
          <span aria-hidden="true">📰</span>
          <span style={{ color: '#1B4F8C' }}>BD Content Feed</span>
          <span className="text-xs text-slate-400">
            {loading ? '…' : `${articles.length} articles`}
          </span>
          <span className="text-xs text-slate-400" aria-hidden="true">
            {isOpen ? '▼' : '▲'}
          </span>
        </button>
      </div>

      {/* Expanded panel */}
      {isOpen && (
        <div
          className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 shadow-2xl"
          style={{ height: '320px' }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Daily LinkedIn Drafts — Current Infrastructure News
            </span>
            <button
              onClick={() => {
                setArticles([]);
                setDrafts({});
                loadArticles(true);
              }}
              className="text-xs text-brand-blue hover:underline"
              aria-label="Refresh news feed"
            >
              ↻ Refresh
            </button>
          </div>

          {/* Horizontally scrolling cards */}
          <div className="flex gap-3 overflow-x-auto p-3" style={{ height: 'calc(100% - 37px)' }}>
            {articles.map((article) => (
              <div
                key={article.url}
                className="shrink-0 w-72 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col bg-white dark:bg-slate-800"
              >
                {/* Article header */}
                <div className="p-2.5 bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 line-clamp-2 leading-snug mb-1">
                    {article.title}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">{article.source}</span>
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-brand-blue hover:underline"
                    >
                      Read ↗
                    </a>
                  </div>
                </div>

                {/* LinkedIn draft area */}
                <div className="flex-1 flex flex-col p-2.5 overflow-hidden">
                  <div className="flex items-center justify-between mb-1">
                    <span
                      style={{
                        color: '#E8731A',
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      LinkedIn Draft
                    </span>
                    {!drafts[article.url] && (
                      <button
                        onClick={() => { void generatePost(article); }}
                        disabled={generating === article.url}
                        className="text-[10px] px-2 py-0.5 bg-brand-blue text-white rounded hover:opacity-90 disabled:opacity-50"
                      >
                        {generating === article.url ? 'Writing…' : '✨ Generate'}
                      </button>
                    )}
                  </div>

                  {drafts[article.url] ? (
                    <>
                      <p className="text-[10px] leading-relaxed text-slate-700 dark:text-slate-300 overflow-y-auto flex-1 whitespace-pre-wrap">
                        {drafts[article.url]}
                      </p>
                      <div className="flex gap-2 mt-2 shrink-0">
                        <button
                          onClick={() => {
                            navigator.clipboard
                              .writeText(drafts[article.url] ?? '')
                              .catch(() => undefined);
                          }}
                          className="flex-1 text-[10px] py-1 border border-brand-blue text-brand-blue rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        >
                          Copy
                        </button>
                        <a
                          href="https://www.linkedin.com/post/new"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-[10px] py-1 bg-brand-blue text-white rounded text-center hover:opacity-90 transition-opacity"
                        >
                          Post →
                        </a>
                      </div>
                    </>
                  ) : (
                    <p className="text-[10px] text-slate-400 italic mt-1">
                      Click Generate to create a LinkedIn post from this article.
                    </p>
                  )}
                </div>
              </div>
            ))}

            {articles.length === 0 && (
              <div className="flex items-center justify-center w-full">
                <p className="text-sm text-slate-400">
                  {loading ? 'Loading news feed…' : 'No articles available. Click ↻ Refresh to retry.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
