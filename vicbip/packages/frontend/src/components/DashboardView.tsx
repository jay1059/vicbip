import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { fetchBridgeStats } from '../api';
import { buildExportUrl } from '../api';
import { useFilterStore } from '../store/useFilterStore';
import { useAppStore } from '../store/useAppStore';
import type { BridgeStats } from '@vicbip/shared';

const RISK_COLORS = {
  critical: '#DC2626',
  high: '#EA580C',
  moderate: '#D97706',
  low: '#16A34A',
};

const OWNER_COLORS = [
  '#1B4F8C', '#0369A1', '#7C3AED',
  '#B45309', '#065F46', '#0F766E', '#6B7280',
];

function KpiCard({
  value,
  label,
  borderColor,
}: {
  value: number;
  label: string;
  borderColor: string;
}): React.ReactElement {
  return (
    <div
      className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 border-l-4"
      style={{ borderLeftColor: borderColor }}
    >
      <div className="text-3xl font-bold text-slate-800 dark:text-slate-200">
        {value.toLocaleString()}
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{label}</div>
    </div>
  );
}

type SortKey = 'sri_score' | 'construction_year';

export function DashboardView(): React.ReactElement {
  const { data: stats, isLoading, error } = useQuery<BridgeStats>({
    queryKey: ['bridge-stats'],
    queryFn: fetchBridgeStats,
    staleTime: 60_000,
  });

  const [sortKey, setSortKey] = useState<SortKey>('sri_score');
  const filters = useFilterStore();
  const { setSelectedBridgeId, setActiveTab } = useAppStore();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-brand-blue border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-600 dark:text-red-400">
        Failed to load dashboard data. Ensure the backend is running.
      </div>
    );
  }

  const eraData = [
    { era: 'Pre-1960', count: stats.by_era.pre_1960, color: '#1B4F8C' },
    { era: '1960–1980', count: stats.by_era.x1960_1980, color: '#1B4F8C' },
    { era: '1980–2000', count: stats.by_era.x1980_2000, color: '#1B4F8C' },
    { era: '2000–2010', count: stats.by_era.x2000_2010, color: '#1B4F8C' },
    { era: '2010+', count: stats.by_era.x2010_plus, color: '#1B4F8C' },
    { era: 'Year Not Recorded', count: stats.by_era.unknown, color: '#9CA3AF' },
  ].filter((d) => d.count > 0);

  const ownerData = Object.entries(stats.by_owner_category)
    .map(([name, count]) => ({
      name: name.replace('_', ' '),
      value: count,
    }))
    .filter((d) => d.value > 0);

  const sorted = [...stats.top20].sort((a, b) => {
    if (sortKey === 'sri_score') return b.sri_score - a.sri_score;
    return 0;
  });

  const exportUrl = buildExportUrl(filters);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950" role="main">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Key metrics">
          <KpiCard
            value={stats.total}
            label="Total Bridges"
            borderColor="#1B4F8C"
          />
          <KpiCard
            value={stats.by_tier.critical}
            label="Critical Risk"
            borderColor="#DC2626"
          />
          <KpiCard
            value={stats.by_tier.high}
            label="High Risk"
            borderColor="#EA580C"
          />
          <KpiCard
            value={stats.by_tier.moderate + stats.by_tier.low}
            label="Moderate / Low Risk"
            borderColor="#16A34A"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Era Chart */}
          <div
            className="bg-white dark:bg-slate-800 rounded-lg shadow p-4"
            role="region"
            aria-label="Bridges by construction era"
          >
            <h3 className="section-header">Bridges by Construction Era</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={eraData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                <XAxis
                  dataKey="era"
                  tick={{ fontSize: 11 }}
                  angle={-30}
                  textAnchor="end"
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Bridges" radius={[3, 3, 0, 0]}>
                  {eraData.map((entry, idx) => (
                    <Cell key={`era-cell-${idx}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Owner Pie Chart */}
          <div
            className="bg-white dark:bg-slate-800 rounded-lg shadow p-4"
            role="region"
            aria-label="Bridges by owner category"
          >
            <h3 className="section-header">Bridges by Owner</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={ownerData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, percent }: { name: string; percent: number }) =>
                    `${name} (${(percent * 100).toFixed(0)}%)`
                  }
                  labelLine={false}
                >
                  {ownerData.map((_, idx) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill={OWNER_COLORS[idx % OWNER_COLORS.length] ?? '#6B7280'}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top 20 Table */}
        <div
          className="bg-white dark:bg-slate-800 rounded-lg shadow"
          role="region"
          aria-label="Top 20 highest risk bridges"
        >
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-3">
            <h3 className="section-header mb-0">Top 20 Risk Bridges</h3>
            <div className="flex items-center gap-3">
              <label htmlFor="sort-select" className="text-sm text-slate-500 dark:text-slate-400">
                Sort by:
              </label>
              <select
                id="sort-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
              >
                <option value="sri_score">SRI Score</option>
                <option value="construction_year">Year Built</option>
              </select>
              <a
                href={exportUrl}
                download="vicbip-bridges.csv"
                className="px-3 py-1.5 bg-brand-blue text-white rounded text-sm font-medium hover:opacity-90 transition-opacity"
                aria-label="Export bridges as CSV"
              >
                Export CSV
              </a>
              <button
                className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-sm font-medium text-slate-500 dark:text-slate-400 cursor-not-allowed"
                disabled
                title="PDF export — Phase 2"
                aria-label="PDF export (coming in Phase 2)"
              >
                Export PDF
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Top 20 risk bridges table">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 w-12">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Bridge Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 hidden md:table-cell">
                    Owner
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                    SRI Score
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Risk Tier
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((bridge, idx) => {
                  const tierColor = bridge.risk_tier
                    ? RISK_COLORS[bridge.risk_tier] ?? '#6B7280'
                    : '#6B7280';
                  return (
                    <tr
                      key={bridge.id}
                      className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                      onClick={() => {
                        setSelectedBridgeId(bridge.id);
                        setActiveTab('map');
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`View bridge: ${bridge.name}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedBridgeId(bridge.id);
                          setActiveTab('map');
                        }
                      }}
                    >
                      <td className="px-4 py-3 text-slate-400 dark:text-slate-500 font-mono">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {bridge.name}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 hidden md:table-cell">
                        {bridge.owner_name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              backgroundColor: tierColor,
                              width: `${bridge.sri_score}%`,
                              maxWidth: '80px',
                            }}
                            aria-hidden="true"
                          />
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {bridge.sri_score.toFixed(1)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium text-white capitalize"
                          style={{ backgroundColor: tierColor }}
                        >
                          {bridge.risk_tier ?? 'unknown'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
