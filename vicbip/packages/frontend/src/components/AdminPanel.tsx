import React, { useState, useCallback } from 'react';

interface AdminAction {
  id: string;
  label: string;
  url: string;
  warning?: string;
  color: 'blue' | 'orange' | 'red' | 'green' | 'purple';
}

const ACTIONS: AdminAction[] = [
  {
    id: 'seed-dtp',
    label: 'Seed DTP Bridges (force)',
    url: '/api/admin/seed-dtp?force=true',
    color: 'blue',
  },
  {
    id: 'remap-owners',
    label: 'Remap Owners',
    url: '/api/admin/remap-owners',
    color: 'blue',
  },
  {
    id: 'traffic-aadt',
    label: 'Run Traffic AADT',
    url: '/api/admin/run-traffic-aadt',
    color: 'green',
  },
  {
    id: 'traffic-tirtl',
    label: 'Run TIRTL Classification',
    url: '/api/admin/run-traffic-tirtl',
    color: 'green',
  },
  {
    id: 'crash-data',
    label: 'Run Crash Data',
    url: '/api/admin/run-crash-data',
    warning: 'Takes up to 10 minutes — large file (~100 MB)',
    color: 'red',
  },
  {
    id: 'disruptions',
    label: 'Run Disruptions',
    url: '/api/admin/run-disruptions',
    color: 'orange',
  },
  {
    id: 'tender-scrape',
    label: 'Run Tender Scraper',
    url: '/api/admin/run-tender-scrape',
    color: 'purple',
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
  blue: 'bg-brand-blue hover:bg-blue-800 text-white',
  orange: 'bg-brand-orange hover:bg-orange-600 text-white',
  red: 'bg-red-600 hover:bg-red-700 text-white',
  green: 'bg-green-600 hover:bg-green-700 text-white',
  purple: 'bg-purple-600 hover:bg-purple-700 text-white',
};

interface ActionState {
  loading: boolean;
  result: unknown | null;
  error: string | null;
  durationMs: number | null;
}

function ActionCard({ action }: { action: AdminAction }): React.ReactElement {
  const [state, setState] = useState<ActionState>({
    loading: false,
    result: null,
    error: null,
    durationMs: null,
  });

  const run = useCallback(async () => {
    setState({ loading: true, result: null, error: null, durationMs: null });
    const t0 = Date.now();
    try {
      const resp = await fetch(action.url);
      const data: unknown = await resp.json();
      setState({
        loading: false,
        result: data,
        error: null,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      setState({
        loading: false,
        result: null,
        error: String(err),
        durationMs: Date.now() - t0,
      });
    }
  }, [action.url]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 dark:text-slate-200">{action.label}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5 truncate">
            {action.url}
          </p>
          {action.warning && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
              ⚠ {action.warning}
            </p>
          )}
        </div>

        <button
          onClick={run}
          disabled={state.loading}
          className={`shrink-0 px-4 py-2 rounded font-medium text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 ${COLOR_CLASSES[action.color]}`}
          aria-label={`Run ${action.label}`}
        >
          {state.loading && (
            <span
              className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"
              aria-hidden="true"
            />
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
          <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">
            {state.error}
          </pre>
        </div>
      )}

      {state.result !== null && (
        <div className="p-3 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Response
          </p>
          <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {JSON.stringify(state.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AdminPanel(): React.ReactElement {
  return (
    <div className="h-screen overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-3xl mx-auto space-y-4 pb-20">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              VicBIP Admin
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Trigger data pipeline scripts. Internal use only.
            </p>
          </div>
          <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-1 rounded font-medium">
            No auth — internal only
          </span>
        </div>

        {ACTIONS.map((action) => (
          <ActionCard key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}
