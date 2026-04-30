export type RiskTier = 'critical' | 'high' | 'moderate' | 'low';

export type OwnerCategory =
  | 'state_govt'
  | 'local_govt'
  | 'rail'
  | 'toll_road'
  | 'utility'
  | 'port'
  | 'other';

export type EventType =
  | 'closure'
  | 'weight_restriction'
  | 'crash'
  | 'overweight_incident';

export interface Bridge {
  id: string;
  bridge_id: string | null;
  name: string;
  road_name: string | null;
  bridge_type: string | null;
  construction_year: number | null;
  span_m: number | null;
  feature_crossed: string | null;
  owner_name: string | null;
  owner_category: OwnerCategory | null;
  location: GeoJSONPoint;
  design_load_std: string | null;
  sri_score: number;
  risk_tier: RiskTier | null;
  freyssinet_works: boolean;
  street_view_url: string | null;
  data_sources: string[] | null;
  notes: string | null;
  last_ingested: string;
}

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface BridgeTraffic {
  id: string;
  bridge_id: string;
  year: number | null;
  aadt_total: number | null;
  heavy_pct: number | null;
  station_id: string | null;
  station_dist_m: number | null;
}

export interface BridgeEvent {
  id: string;
  bridge_id: string;
  event_type: EventType;
  event_date: string | null;
  severity: string | null;
  source_url: string | null;
  notes: string | null;
}

export interface BridgeTender {
  id: string;
  bridge_id: string;
  title: string;
  published_date: string | null;
  contractor: string | null;
  value_aud: number | null;
  source: string | null;
  url: string | null;
  summary: string | null;
}

export interface BridgeIntelligence {
  id: string;
  bridge_id: string;
  source_type: string | null;
  headline: string | null;
  snippet: string | null;
  url: string | null;
  published_date: string | null;
  collected_at: string;
}

export interface BridgeFeatureProperties {
  id: string;
  name: string;
  road_name: string | null;
  bridge_type: string | null;
  construction_year: number | null;
  span_m: number | null;
  owner_name: string | null;
  owner_category: OwnerCategory | null;
  sri_score: number;
  risk_tier: RiskTier | null;
  freyssinet_works: boolean;
}

export interface BridgeGeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONPoint;
  properties: BridgeFeatureProperties;
}

export interface BridgeGeoJSONCollection {
  type: 'FeatureCollection';
  features: BridgeGeoJSONFeature[];
}

export interface BridgeDetail extends Bridge {
  traffic: BridgeTraffic | null;
  events: BridgeEvent[];
  tenders: BridgeTender[];
  intelligence: BridgeIntelligence[];
  solution_match: string[];
}

export interface BridgeStats {
  total: number;
  by_tier: Record<RiskTier, number>;
  by_owner_category: Record<OwnerCategory | 'other', number>;
  by_era: {
    pre_1960: number;
    x1960_1980: number;
    x1980_2000: number;
    x2000_2010: number;
    x2010_plus: number;
    unknown: number;
  };
  top20: Array<{
    id: string;
    name: string;
    owner_name: string | null;
    sri_score: number;
    risk_tier: RiskTier | null;
  }>;
}

export interface BridgeFilters {
  owner_category?: OwnerCategory[];
  risk_tier?: RiskTier[];
  min_year?: number;
  max_year?: number;
  min_span?: number;
  max_span?: number;
  q?: string;
  freyssinet_only?: boolean;
  exclude_freyssinet?: boolean;
}
