import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useQuery } from '@tanstack/react-query';
import { fetchBridges } from '../api';
import { useFilterStore } from '../store/useFilterStore';
import { useAppStore } from '../store/useAppStore';
import type { BridgeFilters } from '@vicbip/shared';

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined;

const RISK_COLOR_MATCH: mapboxgl.Expression = [
  'match',
  ['get', 'risk_tier'],
  'critical', '#DC2626',
  'high', '#EA580C',
  'moderate', '#D97706',
  '#16A34A',
];

export function MapView(): React.ReactElement {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const tooltipRef = useRef<mapboxgl.Popup | null>(null);
  const rafRef = useRef<number | null>(null);
  const pulseRadiusRef = useRef<number>(8);
  const pulseDirectionRef = useRef<number>(1);

  const { setSelectedBridgeId, isDarkMode, isHeatmapEnabled, toggleHeatmap } = useAppStore();

  const filterState = useFilterStore();
  const filters: BridgeFilters = {
    risk_tier: filterState.risk_tier,
    owner_category: filterState.owner_category,
    min_year: filterState.min_year,
    max_year: filterState.max_year,
    min_span: filterState.min_span,
    max_span: filterState.max_span,
    q: filterState.q,
    freyssinet_only: filterState.freyssinet_only,
    exclude_freyssinet: filterState.exclude_freyssinet,
    sn_only: filterState.sn_only,
    has_tenders: filterState.has_tenders,
  };

  const { data: geojson, error } = useQuery({
    queryKey: ['bridges', filters],
    queryFn: () => fetchBridges(filters),
    staleTime: 30_000,
  });

  const mapStyle = isDarkMode
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/light-v11';

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!MAPBOX_TOKEN) {
      console.warn('VITE_MAPBOX_TOKEN not set — map will not load');
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: mapStyle,
      center: [144.5, -37.0],
      zoom: 6.5,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.ScaleControl(), 'bottom-right');

    tooltipRef.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'bridge-tooltip',
    });

    map.on('load', () => {
      map.addSource('bridges', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Heatmap layer (hidden by default)
      map.addLayer({
        id: 'bridge-heatmap',
        type: 'heatmap',
        source: 'bridges',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'sri_score'], 0, 0, 100, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(33,102,172,0)',
            0.2, 'rgb(103,169,207)',
            0.4, 'rgb(209,229,240)',
            0.6, 'rgb(253,219,199)',
            0.8, 'rgb(239,138,98)',
            1, 'rgb(178,24,43)',
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 20],
          'heatmap-opacity': 0.8,
        },
      });

      // Non-tender bridge points
      map.addLayer({
        id: 'bridge-points',
        type: 'circle',
        source: 'bridges',
        filter: ['!=', ['get', 'has_tenders'], true],
        paint: {
          'circle-color': RISK_COLOR_MATCH,
          'circle-radius': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'span_m'], 30],
            20, 5, 100, 9, 500, 14,
          ],
          // SN bridges: thicker white stroke
          'circle-stroke-width': [
            'case', ['get', 'is_sn'], 2.5, 1.5,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.85,
        },
      });

      // Tender bridge points — separate layer so we can animate radius
      map.addLayer({
        id: 'bridge-points-tender',
        type: 'circle',
        source: 'bridges',
        filter: ['==', ['get', 'has_tenders'], true],
        paint: {
          'circle-color': RISK_COLOR_MATCH,
          'circle-radius': 10,
          'circle-stroke-width': [
            'case', ['get', 'is_sn'], 2.5, 1.5,
          ],
          'circle-stroke-color': '#E8731A',
          'circle-opacity': 0.9,
        },
      });

      mapRef.current = map;

      // Start pulse animation for tender bridges
      const pulse = () => {
        if (!map.getLayer('bridge-points-tender')) return;
        pulseRadiusRef.current += pulseDirectionRef.current * 0.15;
        if (pulseRadiusRef.current >= 14) pulseDirectionRef.current = -1;
        if (pulseRadiusRef.current <= 8) pulseDirectionRef.current = 1;
        map.setPaintProperty(
          'bridge-points-tender',
          'circle-radius',
          pulseRadiusRef.current,
        );
        rafRef.current = requestAnimationFrame(pulse);
      };
      rafRef.current = requestAnimationFrame(pulse);
    });

    // Shared hover/click handlers for both point layers
    const handleMouseMove = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      map.getCanvas().style.cursor = 'pointer';

      const feature = e.features[0];
      if (!feature) return;
      const props = feature.properties as {
        name: string;
        sri_score: number;
        risk_tier: string;
        is_sn: boolean;
        has_tenders: boolean;
      };

      tooltipRef.current
        ?.setLngLat(e.lngLat)
        .setHTML(
          `<div class="p-2 text-sm">
            <div class="font-semibold">${props.name}${props.is_sn ? ' <span class="text-blue-600 text-xs">SN</span>' : ''}</div>
            <div class="text-slate-500">SRI: <span class="font-medium">${props.sri_score?.toFixed(1)}</span></div>
            <div class="text-slate-500 capitalize">${props.risk_tier ?? 'Unknown'} risk</div>
            ${props.has_tenders ? '<div class="text-orange-500 text-xs font-medium mt-0.5">● Tender activity</div>' : ''}
          </div>`,
        )
        .addTo(map);
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      tooltipRef.current?.remove();
    };

    const handleClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      if (!feature) return;
      const props = feature.properties as { id: string };
      setSelectedBridgeId(props.id);
    };

    for (const layerId of ['bridge-points', 'bridge-points-tender']) {
      map.on('mousemove', layerId, handleMouseMove);
      map.on('mouseleave', layerId, handleMouseLeave);
      map.on('click', layerId, handleClick);
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      tooltipRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyle]);

  // Update GeoJSON data when filters/data change
  useEffect(() => {
    if (!mapRef.current || !geojson) return;
    const source = mapRef.current.getSource('bridges') as mapboxgl.GeoJSONSource | undefined;
    source?.setData(geojson);
  }, [geojson]);

  // Toggle heatmap visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getLayer('bridge-heatmap')) return;

    const showHeat = isHeatmapEnabled ? 'visible' : 'none';
    const showPoints = isHeatmapEnabled ? 'none' : 'visible';
    map.setLayoutProperty('bridge-heatmap', 'visibility', showHeat);
    map.setLayoutProperty('bridge-points', 'visibility', showPoints);
    map.setLayoutProperty('bridge-points-tender', 'visibility', showPoints);

    // Pause/resume pulse RAF
    if (isHeatmapEnabled) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    }
  }, [isHeatmapEnabled]);

  return (
    <div className="relative flex-1 h-full" role="region" aria-label="Bridge map">
      {!MAPBOX_TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 z-10">
          <div className="text-center p-6">
            <p className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Mapbox token not configured
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Add{' '}
              <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">
                VITE_MAPBOX_TOKEN
              </code>{' '}
              to your .env file
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded shadow z-10 text-sm">
          Failed to load bridge data
        </div>
      )}

      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Map controls */}
      <div className="absolute bottom-8 left-4 flex flex-col gap-2 z-10">
        <button
          onClick={toggleHeatmap}
          className={`px-3 py-1.5 rounded text-sm font-medium shadow transition-colors ${
            isHeatmapEnabled
              ? 'bg-brand-blue text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
          aria-label={isHeatmapEnabled ? 'Disable heatmap' : 'Enable heatmap'}
          aria-pressed={isHeatmapEnabled}
        >
          Heatmap
        </button>
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-8 right-16 bg-white dark:bg-slate-800 rounded shadow p-3 z-10"
        aria-label="Risk tier colour legend"
      >
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
          RISK TIER
        </p>
        {[
          { label: 'Critical', color: '#DC2626' },
          { label: 'High', color: '#EA580C' },
          { label: 'Moderate', color: '#D97706' },
          { label: 'Low', color: '#16A34A' },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            <span className="text-xs text-slate-700 dark:text-slate-300">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <span className="w-3 h-3 rounded-full border-2 border-[#E8731A] bg-slate-400" aria-hidden="true" />
          <span className="text-xs text-slate-500 dark:text-slate-400">Tender active</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-3 h-3 rounded-full border-2 border-white bg-slate-400 ring-1 ring-slate-400" aria-hidden="true" />
          <span className="text-xs text-slate-500 dark:text-slate-400">SN bridge</span>
        </div>
      </div>
    </div>
  );
}
