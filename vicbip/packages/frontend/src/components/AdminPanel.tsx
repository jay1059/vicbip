import React, { useState, useCallback, useRef } from 'react';

interface AdminAction {
  id: string;
  label: string;
  url: string;
  warning?: string;
  note?: string;
  color: 'blue' | 'orange' | 'red' | 'green' | 'purple';
}

const ACTIONS: AdminAction[] = [
  { id: 'seed-dtp',      label: 'Seed DTP Bridges (force)',        url: '/api/admin/seed-dtp?force=true',  color: 'blue' },
  { id: 'remap-owners',  label: 'Remap Owners',                    url: '/api/admin/remap-owners',         color: 'blue' },
  { id: 'traffic-aadt',  label: 'Run Traffic AADT',                url: '/api/admin/run-traffic-aadt',     color: 'green' },
  { id: 'traffic-tirtl', label: 'Run TIRTL Classification',        url: '/api/admin/run-traffic-tirtl',    color: 'green' },
  {
    id: 'crash-data',
    label: 'Run Crash Data',
    url: '/api/admin/run-crash-data',
    warning: 'Takes up to 10 minutes — large file',
    color: 'red',
  },
  { id: 'disruptions',   label: 'Run Disruptions',                 url: '/api/admin/run-disruptions',      color: 'orange' },
  { id: 'tender-scrape', label: 'Run Tender Scraper',              url: '/api/admin/run-tender-scrape',    color: 'purple' },
  {
    id: 'street-view',
    label: 'Run Street View (100 bridges)',
    url: '/api/admin/run-street-view',
    note: 'Checks metadata (free) then stores image URLs',
    color: 'blue',
  },
  {
    id: 'all-data',
    label: 'Run All Data',
    url: '/api/admin/run-all-data',
    warning: 'Runs all 4 data scripts sequentially — allow 15+ minutes',
    color: 'orange',
  },
];

const COLOR_CLASSES: Record<AdminAction['color'], string> = {
  blue:   'bg-brand-blue hover:bg-blue-800 text-white',
  orange: 'bg-brand-orange hover:bg-orange-600 text-white',
  red:    'bg-red-600 hover:bg-red-700 text-white',
  green:  'bg-green-600 hover:bg-green-700 text-white',
  purple: 'bg-purple-600 hover:bg-purple-700 text-white',
};

interface ActionState {
  loading: boolean;
  result: unknown | null;
  error: string | null;
  durationMs: number | null;
}

interface ActionCardProps {
  action: AdminAction;
  onResult: (id: string, state: ActionState) => void;
  externalRun?: (runFn: () => Promise<void>) => void;
}

function ActionCard({ action, onResult, externalRun }: ActionCardProps): React.ReactElement {
  const [state, setState] = useState<ActionState>({
    loading: false, result: null, error: null, durationMs: null,
  });

  const run = useCallback(async () => {
    const next: ActionState = { loading: true, result: null, error: null, durationMs: null };
    setState(next);
    onResult(action.id, next);
    const t0 = Date.now();
    try {
      const resp = await fetch(action.url);
      const data: unknown = await resp.json();
      const done: ActionState = { loading: false, result: data, error: null, durationMs: Date.now() - t0 };
      setState(done);
      onResult(action.id, done);
    } catch (err) {
      const done: ActionState = { loading: false, result: null, error: String(err), durationMs: Date.now() - t0 };
      setState(done);
      onResult(action.id, done);
    }
  }, [action.id, action.url, onResult]);

  const runRef = useRef(run);
  runRef.current = run;
  if (externalRun) externalRun(run);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 dark:text-slate-200">{action.label}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5 truncate">{action.url}</p>
          {action.warning && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">⚠ {action.warning}</p>
          )}
          {action.note && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{action.note}</p>
          )}
        </div>
        <button
          onClick={run}
          disabled={state.loading}
          className={`shrink-0 px-4 py-2 rounded font-medium text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 ${COLOR_CLASSES[action.color]}`}
          aria-label={`Run ${action.label}`}
        >
          {state.loading && (
            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
          )}
          {state.loading ? 'Running…' : 'Run'}
        </button>
      </div>

      {state.durationMs !== null && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Completed in {(state.durationMs / 1000).toFixed(1)}s
        </p>
      )}

      {state.error && (
        <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">Error</p>
          <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">{state.error}</pre>
        </div>
      )}

      {state.result !== null && (
        <div className="p-3 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Response</p>
          <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {JSON.stringify(state.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

interface TenderFormState {
  title: string;
  url: string;
  published_date: string;
  agency: string;
  value_aud: string;
  bridge_name: string;
  status: string;
  notes: string;
}

const EMPTY_TENDER: TenderFormState = {
  title: '', url: '', published_date: '', agency: '',
  value_aud: '', bridge_name: '', status: 'open', notes: '',
};

function parseValueAud(raw: string): number | null {
  if (!raw.trim()) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const m = cleaned.match(/[\d.]+/);
  if (!m) return null;
  let val = parseFloat(m[0] ?? '0');
  const lower = cleaned.toLowerCase();
  if (/million|m$/i.test(lower)) val *= 1_000_000;
  else if (/thousand|k$/i.test(lower)) val *= 1_000;
  return isNaN(val) || val <= 0 ? null : Math.round(val);
}

function ManualTenderForm(): React.ReactElement {
  const [fields, setFields] = useState<TenderFormState>(EMPTY_TENDER);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<unknown | null>(null);

  const set = (key: keyof TenderFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setFields((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fields.title.trim() || !fields.url.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const body = {
        title:          fields.title.trim(),
        url:            fields.url.trim(),
        published_date: fields.published_date || null,
        agency:         fields.agency.trim() || null,
        value_aud:      parseValueAud(fields.value_aud),
        bridge_name:    fields.bridge_name.trim() || null,
        status:         fields.status,
        notes:          fields.notes.trim() || null,
      };
      const resp = await fetch('/api/admin/add-tender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: unknown = await resp.json();
      setResult(data);
      const ok = (data as Record<string, unknown>)['success'];
      if (ok) setFields(EMPTY_TENDER);
    } catch (err) {
      setResult({ success: false, error: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/50';
  const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">
        Manual Tender Entry
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Add a tender record and optionally link it to a bridge by name.
      </p>

      <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Title — full width */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Tender Title *</label>
            <input
              type="text"
              required
              className={inputCls}
              placeholder="e.g. Princes Bridge Strengthening Works"
              value={fields.title}
              onChange={set('title')}
            />
          </div>

          {/* URL — full width */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Tender URL *</label>
            <input
              type="url"
              required
              className={inputCls}
              placeholder="https://..."
              value={fields.url}
              onChange={set('url')}
            />
          </div>

          {/* Date + Status */}
          <div>
            <label className={labelCls}>Published Date</label>
            <input type="date" className={inputCls} value={fields.published_date} onChange={set('published_date')} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={fields.status} onChange={set('status')}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="awarded">Awarded</option>
            </select>
          </div>

          {/* Agency + Value */}
          <div>
            <label className={labelCls}>Agency / Council</label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. City of Melbourne"
              value={fields.agency}
              onChange={set('agency')}
            />
          </div>
          <div>
            <label className={labelCls}>Estimated Value (AUD)</label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. 2500000 or $2.5M"
              value={fields.value_aud}
              onChange={set('value_aud')}
            />
          </div>

          {/* Bridge name match — full width */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Bridge Name Match <span className="font-normal">(partial match — leave blank to skip)</span></label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. Princes Bridge"
              value={fields.bridge_name}
              onChange={set('bridge_name')}
            />
          </div>

          {/* Notes — full width */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Notes</label>
            <textarea
              className={`${inputCls} resize-y min-h-[64px]`}
              placeholder="Optional description or context"
              value={fields.notes}
              onChange={set('notes')}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || !fields.title.trim() || !fields.url.trim()}
          className="mt-3 px-5 py-2 rounded font-medium text-sm bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {submitting && (
            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
          )}
          {submitting ? 'Submitting…' : 'Add Tender'}
        </button>
      </form>

      {result !== null && (
        <div className={`mt-3 p-3 rounded border text-xs font-mono whitespace-pre-wrap break-all ${
          (result as Record<string, unknown>)['success']
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
        }`}>
          {JSON.stringify(result, null, 2)}
        </div>
      )}
    </div>
  );
}

export function AdminPanel(): React.ReactElement {
  const resultsRef = useRef<Map<string, ActionState>>(new Map());
  const runFnsRef  = useRef<Map<string, () => Promise<void>>>(new Map());

  const [copyLabel,    setCopyLabel]    = useState('Copy All Results');
  const [runAllLabel,  setRunAllLabel]  = useState('Run All & Copy Results');
  const [runAllActive, setRunAllActive] = useState(false);

  const handleResult = useCallback((id: string, state: ActionState) => {
    resultsRef.current.set(id, state);
  }, []);

  const copyAll = useCallback(() => {
    const lines: string[] = ['=== VicBIP Admin Results ===', `Copied at ${new Date().toISOString()}`, ''];
    for (const action of ACTIONS) {
      const s = resultsRef.current.get(action.id);
      lines.push(`--- ${action.label} ---`);
      if (!s || (s.result === null && !s.error)) lines.push('(not run)');
      else if (s.error) lines.push(`Error: ${s.error}`);
      else lines.push(JSON.stringify(s.result, null, 2));
      lines.push('');
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined);
    setCopyLabel('Copied!');
    setTimeout(() => setCopyLabel('Copy All Results'), 2000);
  }, []);

  const runAllAndCopy = useCallback(async () => {
    setRunAllActive(true);
    setRunAllLabel('Running…');
    for (const action of ACTIONS) {
      const fn = runFnsRef.current.get(action.id);
      if (fn) {
        try { await fn(); } catch { /* error captured inside ActionCard */ }
      }
    }
    const lines: string[] = ['=== VicBIP Admin Results ===', `Completed at ${new Date().toISOString()}`, ''];
    for (const action of ACTIONS) {
      const s = resultsRef.current.get(action.id);
      lines.push(`--- ${action.label} ---`);
      if (!s || (s.result === null && !s.error)) lines.push('(not run)');
      else if (s.error) lines.push(`Error: ${s.error}`);
      else lines.push(JSON.stringify(s.result, null, 2));
      lines.push('');
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined);
    setRunAllLabel('Done — Copied!');
    setRunAllActive(false);
    setTimeout(() => setRunAllLabel('Run All & Copy Results'), 3000);
  }, []);

  return (
    <div className="h-screen overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-3xl mx-auto space-y-4 pb-20">

        {/* Header */}
        <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">VicBIP Admin</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Trigger data pipeline scripts. Internal use only.{' '}
              <a
                href="/admin-direct"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-blue dark:text-blue-400 hover:underline"
              >
                Open pipeline admin (admin-direct) ↗
              </a>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={copyAll}
              className="px-3 py-1.5 rounded text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white transition-colors"
              aria-label="Copy all results to clipboard"
            >
              {copyLabel}
            </button>
            <button
              onClick={() => { void runAllAndCopy(); }}
              disabled={runAllActive}
              className="px-3 py-1.5 rounded text-sm font-medium bg-brand-orange hover:bg-orange-600 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              aria-label="Run all endpoints and copy results"
            >
              {runAllActive && (
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
              )}
              {runAllLabel}
            </button>
            <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-1 rounded font-medium">
              No auth — internal only
            </span>
          </div>
        </div>

        {/* Manual Tender Entry — above pipeline buttons */}
        <ManualTenderForm />

        {/* Action cards */}
        {ACTIONS.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            onResult={handleResult}
            externalRun={(fn) => { runFnsRef.current.set(action.id, fn); }}
          />
        ))}
      </div>
    </div>
  );
}
