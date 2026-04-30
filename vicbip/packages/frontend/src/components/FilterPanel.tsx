import React, { useEffect, useState, useCallback } from 'react';
import { useFilterStore } from '../store/useFilterStore';
import { useAppStore } from '../store/useAppStore';
import type { OwnerCategory, RiskTier } from '@vicbip/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchBridges } from '../api';

const RISK_TIERS: { value: RiskTier; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: '#DC2626' },
  { value: 'high', label: 'High', color: '#EA580C' },
  { value: 'moderate', label: 'Moderate', color: '#D97706' },
  { value: 'low', label: 'Low', color: '#16A34A' },
];

const OWNER_CATEGORIES: { value: OwnerCategory; label: string }[] = [
  { value: 'state_govt', label: 'State Govt' },
  { value: 'local_govt', label: 'Local Govt' },
  { value: 'rail', label: 'Rail' },
  { value: 'toll_road', label: 'Toll Road' },
  { value: 'utility', label: 'Utility' },
  { value: 'port', label: 'Port' },
  { value: 'other', label: 'Other' },
];

export function FilterPanel(): React.ReactElement {
  const filters = useFilterStore();
  const { isSidebarOpen } = useAppStore();
  const [localQuery, setLocalQuery] = useState(filters.q ?? '');

  const { data } = useQuery({
    queryKey: ['bridges', 'count', filters],
    queryFn: () => fetchBridges(filters),
    staleTime: 30_000,
  });

  const resultCount = data?.features.length ?? 0;

  // Debounce text search
  useEffect(() => {
    const timer = setTimeout(() => {
      filters.setQuery(localQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery]);

  const toggleRiskTier = useCallback(
    (tier: RiskTier) => {
      const current = filters.risk_tier ?? [];
      if (current.includes(tier)) {
        filters.setRiskTiers(current.filter((t) => t !== tier));
      } else {
        filters.setRiskTiers([...current, tier]);
      }
    },
    [filters],
  );

  const toggleOwnerCategory = useCallback(
    (cat: OwnerCategory) => {
      const current = filters.owner_category ?? [];
      if (current.includes(cat)) {
        filters.setOwnerCategories(current.filter((c) => c !== cat));
      } else {
        filters.setOwnerCategories([...current, cat]);
      }
    },
    [filters],
  );

  if (!isSidebarOpen) return <></>;

  return (
    <aside
      className="w-80 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 overflow-y-auto flex flex-col"
      aria-label="Bridge filters"
    >
      <div className="p-4 flex flex-col gap-5">
        {/* Results count */}
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 dark:text-slate-200">Filters</h2>
          <span className="text-xs bg-brand-blue text-white px-2 py-0.5 rounded-full font-medium">
            {resultCount} bridges
          </span>
        </div>

        {/* Search */}
        <div>
          <label
            htmlFor="bridge-search"
            className="section-header block"
          >
            Search
          </label>
          <input
            id="bridge-search"
            type="search"
            placeholder="Name, road or owner…"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
        </div>

        {/* Risk Tier */}
        <fieldset>
          <legend className="section-header w-full">Risk Tier</legend>
          <div className="space-y-2">
            {RISK_TIERS.map(({ value, label, color }) => {
              const checked = (filters.risk_tier ?? []).includes(value);
              return (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRiskTier(value)}
                    className="rounded border-slate-300"
                    aria-label={`Filter by ${label} risk`}
                  />
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Owner Category */}
        <fieldset>
          <legend className="section-header w-full">Owner Category</legend>
          <div className="space-y-2">
            {OWNER_CATEGORIES.map(({ value, label }) => {
              const checked = (filters.owner_category ?? []).includes(value);
              return (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOwnerCategory(value)}
                    className="rounded border-slate-300"
                    aria-label={`Filter by ${label}`}
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Construction Era */}
        <div>
          <label className="section-header block">
            Construction Era
          </label>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>From: {filters.min_year ?? 1880}</span>
                <span>To: {filters.max_year ?? 2025}</span>
              </div>
              <input
                type="range"
                min={1880}
                max={2025}
                value={filters.min_year ?? 1880}
                onChange={(e) =>
                  filters.setYearRange(Number(e.target.value), filters.max_year)
                }
                className="w-full accent-brand-blue"
                aria-label="Minimum construction year"
              />
              <input
                type="range"
                min={1880}
                max={2025}
                value={filters.max_year ?? 2025}
                onChange={(e) =>
                  filters.setYearRange(filters.min_year, Number(e.target.value))
                }
                className="w-full accent-brand-blue"
                aria-label="Maximum construction year"
              />
            </div>
          </div>
        </div>

        {/* Span */}
        <div>
          <label className="section-header block">
            Span Length
          </label>
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>{filters.min_span ?? 20}m</span>
            <span>{filters.max_span ?? 500}m</span>
          </div>
          <input
            type="range"
            min={20}
            max={500}
            value={filters.min_span ?? 20}
            onChange={(e) =>
              filters.setSpanRange(Number(e.target.value), filters.max_span)
            }
            className="w-full accent-brand-blue"
            aria-label="Minimum span"
          />
          <input
            type="range"
            min={20}
            max={500}
            value={filters.max_span ?? 500}
            onChange={(e) =>
              filters.setSpanRange(filters.min_span, Number(e.target.value))
            }
            className="w-full accent-brand-blue"
            aria-label="Maximum span"
          />
        </div>

        {/* Freyssinet toggles */}
        <fieldset>
          <legend className="section-header w-full">Freyssinet Works</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.freyssinet_only ?? false}
                onChange={(e) =>
                  filters.setFreyssinet(e.target.checked, false)
                }
                className="rounded border-slate-300"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Freyssinet works only
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.exclude_freyssinet ?? false}
                onChange={(e) =>
                  filters.setFreyssinet(false, e.target.checked)
                }
                className="rounded border-slate-300"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Exclude Freyssinet works
              </span>
            </label>
          </div>
        </fieldset>

        {/* Reset button */}
        <button
          onClick={() => {
            filters.resetFilters();
            setLocalQuery('');
          }}
          className="w-full py-2 px-4 rounded border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          aria-label="Reset all filters"
        >
          Reset Filters
        </button>
      </div>
    </aside>
  );
}
