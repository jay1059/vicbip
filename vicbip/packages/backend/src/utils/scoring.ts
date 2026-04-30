import type { RiskTier } from '@vicbip/shared';

export function computeAgePts(year: number | null): number {
  if (year === null) return 20;
  return Math.min(35, Math.max(0, ((2025 - year) / 80) * 35));
}

export function computeStdPts(year: number | null): number {
  if (year === null) return 10;
  if (year < 1960) return 20;
  if (year < 1975) return 15;
  if (year < 1992) return 10;
  if (year < 2004) return 5;
  return 0;
}

export function computeBasicSriScore(year: number | null): number {
  const agePts = computeAgePts(year);
  const stdPts = computeStdPts(year);
  const basePts = 10;
  return Math.min(100, agePts + stdPts + basePts);
}

export function inferDesignLoadStd(year: number | null): string {
  if (year === null) return 'Unknown';
  if (year < 1960) return 'W7.5 / Pre-T44';
  if (year < 1975) return 'T-44 (1965 Standard)';
  if (year < 1992) return 'Modified T-44';
  if (year < 2004) return 'AS 1170 Transitional';
  return 'AS 5100 SM1600';
}

export function computeRiskTier(sri_score: number): RiskTier {
  if (sri_score >= 80) return 'critical';
  if (sri_score >= 60) return 'high';
  if (sri_score >= 40) return 'moderate';
  return 'low';
}

/**
 * Infer owner category from a free-text owner name.
 * Used for OSM bridges, manual entries, and future CSV sources that include an owner field.
 */
export function inferOwnerCategory(ownerName: string | null): string {
  if (!ownerName) return 'other';
  const n = ownerName.toLowerCase();

  if (
    n.includes('vicroads') ||
    n.includes('vic roads') ||
    n.includes('department of transport') ||
    n.includes('transport') ||
    n.includes('dtp') ||
    n.includes('department')
  ) {
    return 'state_govt';
  }
  if (
    n.includes('council') ||
    n.includes('shire') ||
    n.includes('city of') ||
    n.includes('borough')
  ) {
    return 'local_govt';
  }
  if (
    n.includes('metro') ||
    n.includes('train') ||
    n.includes('metro trains') ||
    n.includes('victrack') ||
    n.includes('v/line') ||
    n.includes('rail') ||
    n.includes('railway')
  ) {
    return 'rail';
  }
  if (n.includes('transurban')) {
    return 'toll_road';
  }
  if (
    n.includes('water') ||
    n.includes('ausnet') ||
    n.includes('apa') ||
    n.includes('jemena')
  ) {
    return 'utility';
  }
  if (n.includes('port')) {
    return 'port';
  }

  return 'other';
}

/**
 * Infer owner category from DTP CSV fields.
 *
 * The DTP Road Bridges Register is the State Network (SN) register — every
 * record is a VicRoads / DTP asset. There is no owner name column.
 *
 * Mapping:
 *   CD_STATE_CLASS = 'RA'                    → rail  (rail-associated)
 *   bridge type contains 'RAIL OVER ROAD'
 *     or 'RAIL OVERPASS'                     → rail
 *   Everything else on the SN register       → state_govt
 */
export function inferOwnerCategoryFromDtp(
  cdStateClass: string | null,
  bridgeType: string | null,
): string {
  const cls = (cdStateClass ?? '').trim().toUpperCase();
  const bt = (bridgeType ?? '').toLowerCase();

  if (cls === 'RA' || bt.includes('rail over road') || bt.includes('rail overpass')) {
    return 'rail';
  }

  // All other SN records are VicRoads / DTP state government assets
  return 'state_govt';
}
