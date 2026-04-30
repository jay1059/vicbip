import { create } from 'zustand';
import type { BridgeFilters, OwnerCategory, RiskTier } from '@vicbip/shared';

interface FilterState extends BridgeFilters {
  setRiskTiers: (tiers: RiskTier[]) => void;
  setOwnerCategories: (cats: OwnerCategory[]) => void;
  setYearRange: (min: number | undefined, max: number | undefined) => void;
  setSpanRange: (min: number | undefined, max: number | undefined) => void;
  setQuery: (q: string) => void;
  setFreyssinet: (freyssinetOnly: boolean, excludeFreyssinet: boolean) => void;
  setBridgeType: (types: string[]) => void;
  setSnOnly: (v: boolean) => void;
  setHasTenders: (v: boolean) => void;
  resetFilters: () => void;
  bridgeTypeFilter: string[];
}

const defaultFilters: BridgeFilters = {
  risk_tier: [],
  owner_category: [],
  min_year: undefined,
  max_year: undefined,
  min_span: undefined,
  max_span: undefined,
  q: undefined,
  freyssinet_only: false,
  exclude_freyssinet: false,
  sn_only: false,
  has_tenders: false,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...defaultFilters,
  bridgeTypeFilter: [],

  setRiskTiers: (tiers) => set({ risk_tier: tiers }),
  setOwnerCategories: (cats) => set({ owner_category: cats }),
  setYearRange: (min, max) => set({ min_year: min, max_year: max }),
  setSpanRange: (min, max) => set({ min_span: min, max_span: max }),
  setQuery: (q) => set({ q: q || undefined }),
  setFreyssinet: (freyssinetOnly, excludeFreyssinet) =>
    set({ freyssinet_only: freyssinetOnly, exclude_freyssinet: excludeFreyssinet }),
  setBridgeType: (types) => set({ bridgeTypeFilter: types }),
  setSnOnly: (v) => set({ sn_only: v }),
  setHasTenders: (v) => set({ has_tenders: v }),
  resetFilters: () => set({ ...defaultFilters, bridgeTypeFilter: [] }),
}));
