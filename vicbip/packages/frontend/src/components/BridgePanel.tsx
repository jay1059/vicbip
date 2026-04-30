import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { fetchBridgeDetail } from '../api';
import { useAppStore } from '../store/useAppStore';
import type { BridgeDetail, RiskTier } from '@vicbip/shared';

const RISK_COLORS: Record<RiskTier, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  moderate: '#D97706',
  low: '#16A34A',
};

const OWNER_COLORS: Record<string, string> = {
  state_govt: '#1B4F8C',
  local_govt: '#0369A1',
  rail: '#7C3AED',
  toll_road: '#B45309',
  utility: '#065F46',
  port: '#0F766E',
  other: '#6B7280',
};

const DESIGN_LOAD_COLORS: Record<string, string> = {
  'AS 5100 SM1600': '#16A34A',
  'AS 1170 Transitional': '#D97706',
  'Modified T-44': '#EA580C',
  'T-44 (1965 Standard)': '#DC2626',
  'W7.5 / Pre-T44': '#DC2626',
  Unknown: '#9CA3AF',
};

const SERVICE_LINKS: Record<string, string> = {
  'External Post-Tensioning': 'https://www.freyssinet.com.au/external-post-tensioning/',
  'CFRP Structural Strengthening': 'https://www.freyssinet.com.au/frp-strengthening/',
  'Concrete Rehabilitation': 'https://www.freyssinet.com.au/concrete-repair/',
  'Bearing Replacement': 'https://www.freyssinet.com.au/structural-bearings/',
  'Expansion Joint Repair': 'https://www.freyssinet.com.au/expansion-joints/',
  'Seismic Retrofitting': 'https://www.freyssinet.com.au/seismic-protection/',
};

function Skeleton(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-3 p-4">
      <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
      <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded" />
      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded" />
      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6" />
    </div>
  );
}

function SriGauge({ score, tier }: { score: number; tier: RiskTier | null }): React.ReactElement {
  const color = tier ? RISK_COLORS[tier] : '#9CA3AF';
  const data = [{ value: score, fill: color }];

  return (
    <div className="flex flex-col items-center">
      <div className="w-32 h-32 relative" role="img" aria-label={`SRI score: ${score.toFixed(1)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="90%"
            startAngle={180}
            endAngle={0}
            data={data}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" background={{ fill: '#E2E8F0' }} cornerRadius={4} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
          <span className="text-2xl font-bold" style={{ color }}>
            {score.toFixed(0)}
          </span>
          <span className="text-xs text-slate-500 capitalize">{tier ?? 'unknown'}</span>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-1">SRI Score (0–100)</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-5">
      <h3 className="section-header">{title}</h3>
      {children}
    </div>
  );
}

function BridgePanelContent({ bridge }: { bridge: BridgeDetail }): React.ReactElement {
  const [scoreExpanded, setScoreExpanded] = useState(false);

  const coords = bridge.location?.coordinates;
  const lat = coords ? coords[1]?.toFixed(5) : 'N/A';
  const lng = coords ? coords[0]?.toFixed(5) : 'N/A';

  const ownerColor = bridge.owner_category
    ? OWNER_COLORS[bridge.owner_category] ?? '#6B7280'
    : '#6B7280';

  const designColor = bridge.design_load_std
    ? DESIGN_LOAD_COLORS[bridge.design_load_std] ?? '#9CA3AF'
    : '#9CA3AF';

  const mailtoSubject = encodeURIComponent(
    `VicBIP Assessment Request — ${bridge.name}`,
  );
  const mailtoBody = encodeURIComponent(
    `Bridge: ${bridge.name}\nOwner: ${bridge.owner_name ?? 'Unknown'}\nSRI: ${bridge.sri_score.toFixed(1)}\nServices: ${bridge.solution_match.join(', ')}`,
  );

  const copyText = `${bridge.name} | Owner: ${bridge.owner_name ?? 'Unknown'} | SRI: ${bridge.sri_score.toFixed(1)} | Tier: ${bridge.risk_tier ?? 'Unknown'} | Services: ${bridge.solution_match.join(', ')}`;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Section A — Identity */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <Section title="Identity">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {bridge.owner_category && (
                <span
                  className="inline-block text-white text-xs px-2 py-0.5 rounded mb-2 font-medium"
                  style={{ backgroundColor: ownerColor }}
                >
                  {bridge.owner_category.replace('_', ' ').toUpperCase()}
                </span>
              )}
              <dl className="space-y-1 text-sm">
                {bridge.span_m && (
                  <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Span:</dt>
                    <dd className="text-slate-800 dark:text-slate-200 font-medium">
                      {bridge.span_m.toFixed(0)}m
                    </dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-slate-500 shrink-0">Coords:</dt>
                  <dd className="text-slate-800 dark:text-slate-200 font-mono text-xs">
                    {lat}, {lng}
                  </dd>
                </div>
                {bridge.bridge_type && (
                  <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Type:</dt>
                    <dd className="text-slate-800 dark:text-slate-200">{bridge.bridge_type}</dd>
                  </div>
                )}
                {bridge.owner_name && (
                  <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Owner:</dt>
                    <dd className="text-slate-800 dark:text-slate-200">{bridge.owner_name}</dd>
                  </div>
                )}
              </dl>
            </div>
            <SriGauge score={bridge.sri_score} tier={bridge.risk_tier} />
          </div>

          {/* Score breakdown accordion */}
          <button
            onClick={() => setScoreExpanded(!scoreExpanded)}
            className="mt-3 text-xs text-brand-blue hover:underline flex items-center gap-1"
            aria-expanded={scoreExpanded}
          >
            Score breakdown
            <span aria-hidden="true">{scoreExpanded ? '▲' : '▼'}</span>
          </button>
          {scoreExpanded && (
            <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800 rounded text-xs space-y-1">
              <p className="text-slate-600 dark:text-slate-400">
                Age factor: up to 35 pts based on construction year
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Design load standard: up to 20 pts for older standards
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Traffic loading: up to 25 pts based on AADT and heavy vehicle %
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Events: up to 20 pts for closures and weight restrictions
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Maintenance gap: up to 10 pts for inactivity
              </p>
              <p className="mt-2 font-medium text-slate-700 dark:text-slate-300">
                Total: {bridge.sri_score.toFixed(1)} / 100
              </p>
            </div>
          )}
        </Section>
      </div>

      {/* Section B — Structural Profile */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <Section title="Structural Profile">
          <dl className="space-y-2 text-sm">
            {bridge.construction_year && (
              <div className="flex gap-2">
                <dt className="text-slate-500 shrink-0 w-28">Year Built:</dt>
                <dd className="text-slate-800 dark:text-slate-200 font-medium">
                  {bridge.construction_year}
                </dd>
              </div>
            )}
            {bridge.design_load_std && (
              <div className="flex gap-2">
                <dt className="text-slate-500 shrink-0 w-28">Design Load:</dt>
                <dd>
                  <span
                    className="inline-block text-xs px-2 py-0.5 rounded font-medium text-white"
                    style={{ backgroundColor: designColor }}
                  >
                    {bridge.design_load_std}
                  </span>
                </dd>
              </div>
            )}
            {bridge.feature_crossed && (
              <div className="flex gap-2">
                <dt className="text-slate-500 shrink-0 w-28">Crosses:</dt>
                <dd className="text-slate-800 dark:text-slate-200">{bridge.feature_crossed}</dd>
              </div>
            )}
          </dl>
        </Section>
      </div>

      {/* Section C — Traffic & Loading */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <Section title="Traffic & Loading">
          {bridge.traffic ? (
            <dl className="space-y-2 text-sm">
              {bridge.traffic.aadt_total && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 shrink-0 w-28">AADT ({bridge.traffic.year}):</dt>
                  <dd className="text-slate-800 dark:text-slate-200 font-medium">
                    {bridge.traffic.aadt_total.toLocaleString()}
                  </dd>
                </div>
              )}
              {bridge.traffic.heavy_pct !== null && bridge.traffic.heavy_pct !== undefined && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 shrink-0 w-28">Heavy Vehicle %:</dt>
                  <dd className="text-slate-800 dark:text-slate-200 font-medium">
                    {bridge.traffic.heavy_pct.toFixed(1)}%
                    {bridge.traffic.heavy_pct > 15 && (
                      <span className="ml-2 text-xs text-red-600 dark:text-red-400 font-medium">
                        HIGH
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {bridge.traffic.station_dist_m !== null &&
                bridge.traffic.station_dist_m !== undefined && (
                  <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0 w-28">Station dist:</dt>
                    <dd className="text-slate-800 dark:text-slate-200">
                      {bridge.traffic.station_dist_m.toFixed(0)}m
                    </dd>
                  </div>
                )}
              {/* Weight restriction events */}
              {(() => {
                const weightRestrictions = bridge.events.filter(
                  (e) => e.event_type === 'weight_restriction',
                ).length;
                return weightRestrictions > 0 ? (
                  <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">
                      ⚠ {weightRestrictions} weight restriction notice{weightRestrictions !== 1 ? 's' : ''}
                    </p>
                  </div>
                ) : null;
              })()}
            </dl>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">
              No traffic data available
            </p>
          )}
        </Section>
      </div>

      {/* Section D — Events */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <Section title="Events">
          {bridge.events.length > 0 ? (
            <div className="space-y-2">
              {bridge.events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 text-sm"
                >
                  <span
                    className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${
                      event.event_type === 'closure'
                        ? 'bg-red-500'
                        : event.event_type === 'weight_restriction'
                          ? 'bg-amber-500'
                          : event.event_type === 'crash'
                            ? 'bg-orange-500'
                            : 'bg-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-medium text-slate-700 dark:text-slate-300 capitalize">
                      {event.event_type.replace('_', ' ')}
                      {event.severity && (
                        <span className="ml-2 text-xs text-slate-500">({event.severity})</span>
                      )}
                    </p>
                    {event.event_date && (
                      <p className="text-xs text-slate-500">
                        {new Date(event.event_date).toLocaleDateString('en-AU')}
                      </p>
                    )}
                    {event.notes && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        {event.notes}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">
              No events in last 5 years
            </p>
          )}

          {(() => {
            const crashes = bridge.events.filter((e) => e.event_type === 'crash').length;
            return crashes > 0 ? (
              <div className="mt-2 inline-flex items-center gap-1 bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200 px-2 py-0.5 rounded text-xs font-medium">
                {crashes} crash{crashes !== 1 ? 'es' : ''} recorded
              </div>
            ) : null;
          })()}
        </Section>
      </div>

      {/* Section E — Intelligence */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <Section title="Intelligence">
          {bridge.freyssinet_works && (
            <div className="mb-3 inline-flex items-center gap-1.5 bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200 px-3 py-1 rounded-full text-xs font-medium">
              <span aria-hidden="true">✓</span> Freyssinet has worked on this bridge
            </div>
          )}

          {bridge.street_view_url && (
            <div className="mb-4">
              <img
                src={bridge.street_view_url}
                alt={`Street view of ${bridge.name}`}
                className="w-full rounded object-cover"
                style={{ height: 200 }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          {bridge.tenders.length > 0 ? (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                TENDERS ({bridge.tenders.length})
              </h4>
              <div className="space-y-3">
                {bridge.tenders.map((tender) => (
                  <div key={tender.id} className="text-sm">
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {tender.title}
                    </p>
                    <div className="text-xs text-slate-500 space-y-0.5 mt-0.5">
                      {tender.published_date && (
                        <p>{new Date(tender.published_date).toLocaleDateString('en-AU')}</p>
                      )}
                      {tender.contractor && <p>Contractor: {tender.contractor}</p>}
                      {tender.value_aud && (
                        <p>Value: ${tender.value_aud.toLocaleString()}</p>
                      )}
                    </div>
                    {tender.url && (
                      <a
                        href={tender.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-blue hover:underline"
                      >
                        View source ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {bridge.intelligence.length > 0 ? (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                INTELLIGENCE ({bridge.intelligence.length})
              </h4>
              {bridge.intelligence.map((intel) => (
                <div key={intel.id} className="text-sm border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                  {intel.headline && (
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {intel.headline}
                    </p>
                  )}
                  {intel.snippet && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      {intel.snippet}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    {intel.published_date && (
                      <span className="text-xs text-slate-500">
                        {new Date(intel.published_date).toLocaleDateString('en-AU')}
                      </span>
                    )}
                    {intel.url && (
                      <a
                        href={intel.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-blue hover:underline"
                      >
                        Read more ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            bridge.tenders.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                No intelligence records yet. Consider running a manual search.
              </p>
            )
          )}
        </Section>
      </div>

      {/* Section F — Solution Match */}
      <div className="p-4">
        <Section title="Solution Match">
          {bridge.solution_match.length > 0 ? (
            <div className="space-y-3">
              {bridge.solution_match.map((service) => {
                const link = SERVICE_LINKS[service] ?? 'https://www.freyssinet.com.au/';
                return (
                  <div
                    key={service}
                    className="p-3 border border-brand-blue/20 rounded bg-blue-50/50 dark:bg-blue-900/10"
                  >
                    <p className="font-semibold text-sm text-brand-blue dark:text-blue-300">
                      {service}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Recommended based on bridge age and structural profile.
                    </p>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-blue hover:underline mt-1 inline-block"
                    >
                      View Freyssinet service ↗
                    </a>
                  </div>
                );
              })}

              <div className="flex gap-2 mt-4 flex-wrap">
                <a
                  href={`mailto:info@freyssinet.com.au?subject=${mailtoSubject}&body=${mailtoBody}`}
                  className="flex-1 text-center py-2 px-3 bg-brand-orange text-white rounded text-sm font-medium hover:opacity-90 transition-opacity"
                  aria-label={`Request assessment for ${bridge.name}`}
                >
                  Request Assessment
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(copyText).catch(() => undefined);
                  }}
                  className="flex-1 py-2 px-3 border border-slate-300 dark:border-slate-600 rounded text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Copy bridge summary to clipboard"
                >
                  Copy Summary
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">
              No Freyssinet services matched for this bridge profile.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

export function BridgePanel(): React.ReactElement {
  const { selectedBridgeId, setSelectedBridgeId } = useAppStore();
  const isOpen = !!selectedBridgeId;

  const { data: bridge, isLoading, error } = useQuery({
    queryKey: ['bridge', selectedBridgeId],
    queryFn: () => fetchBridgeDetail(selectedBridgeId!),
    enabled: !!selectedBridgeId,
  });

  return (
    <aside
      className={`fixed top-14 right-0 bottom-8 w-[420px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 z-20 flex flex-col shadow-2xl transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-label="Bridge detail panel"
      aria-hidden={!isOpen}
    >
      {isOpen && (
        <>
          {/* Panel Header */}
          <div
            className="flex items-start justify-between p-4 border-b border-slate-200 dark:border-slate-700"
            style={{ backgroundColor: '#1B4F8C' }}
          >
            <div className="flex-1 min-w-0">
              {bridge ? (
                <>
                  <h2 className="text-white font-bold text-base leading-tight truncate">
                    {bridge.name}
                  </h2>
                  {bridge.road_name && (
                    <p className="text-white/70 text-sm mt-0.5">{bridge.road_name}</p>
                  )}
                </>
              ) : (
                <div className="h-5 w-48 bg-white/20 rounded animate-pulse" />
              )}
            </div>
            <button
              onClick={() => setSelectedBridgeId(null)}
              className="ml-3 text-white/80 hover:text-white p-1 rounded shrink-0"
              aria-label="Close bridge panel"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Panel Body */}
          <div className="flex-1 overflow-hidden">
            {isLoading && <Skeleton />}
            {error && (
              <div className="p-4 text-sm text-red-600 dark:text-red-400">
                Failed to load bridge details. Please try again.
              </div>
            )}
            {bridge && <BridgePanelContent bridge={bridge} />}
          </div>
        </>
      )}
    </aside>
  );
}
