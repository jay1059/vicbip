import { describe, it, expect } from 'vitest';
import {
  computeAgePts,
  computeStdPts,
  computeBasicSriScore,
  inferDesignLoadStd,
  computeRiskTier,
  inferOwnerCategory,
  inferOwnerCategoryFromDtp,
} from './scoring';

describe('computeAgePts', () => {
  it('returns 20 for null year', () => {
    expect(computeAgePts(null)).toBe(20);
  });

  it('returns capped max of 35 for very old bridge', () => {
    expect(computeAgePts(1880)).toBe(35);
  });

  it('returns 0 for future year', () => {
    expect(computeAgePts(2030)).toBe(0);
  });

  it('computes correctly for year 1950', () => {
    const expected = Math.min(35, Math.max(0, ((2025 - 1950) / 80) * 35));
    expect(computeAgePts(1950)).toBeCloseTo(expected, 5);
  });
});

describe('computeStdPts', () => {
  it('returns 10 for null year', () => {
    expect(computeStdPts(null)).toBe(10);
  });

  it('returns 20 for pre-1960 bridge', () => {
    expect(computeStdPts(1955)).toBe(20);
  });

  it('returns 15 for T-44 era bridge (1960–1974)', () => {
    expect(computeStdPts(1965)).toBe(15);
  });

  it('returns 10 for Modified T-44 era (1975–1991)', () => {
    expect(computeStdPts(1980)).toBe(10);
  });

  it('returns 5 for AS 1170 Transitional era (1992–2003)', () => {
    expect(computeStdPts(1998)).toBe(5);
  });

  it('returns 0 for modern bridge (2004+)', () => {
    expect(computeStdPts(2010)).toBe(0);
  });
});

describe('computeBasicSriScore', () => {
  it('caps at 100 for very old bridges', () => {
    expect(computeBasicSriScore(1890)).toBeLessThanOrEqual(100);
  });

  it('returns at least 10 (base) for modern bridge', () => {
    expect(computeBasicSriScore(2020)).toBeGreaterThanOrEqual(10);
  });

  it('returns correct score for 1960 bridge', () => {
    const age = computeAgePts(1960);
    const std = computeStdPts(1960);
    expect(computeBasicSriScore(1960)).toBeCloseTo(Math.min(100, age + std + 10), 5);
  });
});

describe('inferDesignLoadStd', () => {
  it('returns Unknown for null', () => {
    expect(inferDesignLoadStd(null)).toBe('Unknown');
  });

  it('returns Pre-T44 for pre-1960', () => {
    expect(inferDesignLoadStd(1950)).toBe('W7.5 / Pre-T44');
  });

  it('returns T-44 for 1960–1974', () => {
    expect(inferDesignLoadStd(1968)).toBe('T-44 (1965 Standard)');
  });

  it('returns Modified T-44 for 1975–1991', () => {
    expect(inferDesignLoadStd(1985)).toBe('Modified T-44');
  });

  it('returns AS 1170 Transitional for 1992–2003', () => {
    expect(inferDesignLoadStd(1999)).toBe('AS 1170 Transitional');
  });

  it('returns AS 5100 SM1600 for 2004+', () => {
    expect(inferDesignLoadStd(2010)).toBe('AS 5100 SM1600');
  });
});

describe('computeRiskTier', () => {
  it('returns critical for score >= 80', () => {
    expect(computeRiskTier(85)).toBe('critical');
    expect(computeRiskTier(80)).toBe('critical');
  });

  it('returns high for score 60–79', () => {
    expect(computeRiskTier(70)).toBe('high');
    expect(computeRiskTier(60)).toBe('high');
  });

  it('returns moderate for score 40–59', () => {
    expect(computeRiskTier(50)).toBe('moderate');
    expect(computeRiskTier(40)).toBe('moderate');
  });

  it('returns low for score < 40', () => {
    expect(computeRiskTier(39)).toBe('low');
    expect(computeRiskTier(0)).toBe('low');
  });
});

describe('inferOwnerCategory', () => {
  it('returns other for null', () => {
    expect(inferOwnerCategory(null)).toBe('other');
  });

  it('maps DTP / VicRoads to state_govt', () => {
    expect(inferOwnerCategory('VicRoads')).toBe('state_govt');
    expect(inferOwnerCategory('Department of Transport and Planning')).toBe('state_govt');
    expect(inferOwnerCategory('DTP Victoria')).toBe('state_govt');
    expect(inferOwnerCategory('Department of Transport')).toBe('state_govt');
    expect(inferOwnerCategory('Transport for Victoria')).toBe('state_govt');
  });

  it('maps councils to local_govt', () => {
    expect(inferOwnerCategory('City of Melbourne Council')).toBe('local_govt');
    expect(inferOwnerCategory('Yarra Ranges Shire')).toBe('local_govt');
  });

  it('maps rail operators to rail', () => {
    expect(inferOwnerCategory('Metro Trains Melbourne')).toBe('rail');
    expect(inferOwnerCategory('VicTrack')).toBe('rail');
    expect(inferOwnerCategory('V/Line')).toBe('rail');
    expect(inferOwnerCategory('Metro Rail Authority')).toBe('rail');
    expect(inferOwnerCategory('Train operator XYZ')).toBe('rail');
  });

  it('maps Transurban to toll_road', () => {
    expect(inferOwnerCategory('Transurban')).toBe('toll_road');
  });

  it('maps water/utility to utility', () => {
    expect(inferOwnerCategory('Melbourne Water')).toBe('utility');
    expect(inferOwnerCategory('AusNet Services')).toBe('utility');
    expect(inferOwnerCategory('APA Group')).toBe('utility');
  });

  it('maps port authorities to port', () => {
    expect(inferOwnerCategory('Port of Melbourne')).toBe('port');
  });

  it('returns other for unknown', () => {
    expect(inferOwnerCategory('Some Random Entity')).toBe('other');
  });
});

describe('inferOwnerCategoryFromDtp', () => {
  it('maps CD_STATE_CLASS=RA to rail', () => {
    expect(inferOwnerCategoryFromDtp('RA', null)).toBe('rail');
    expect(inferOwnerCategoryFromDtp('RA', 'ROAD OVER RAIL')).toBe('rail');
  });

  it('maps rail overpass bridge type to rail', () => {
    expect(inferOwnerCategoryFromDtp('HF', 'RAIL OVER ROAD(RAIL OVERPASS)')).toBe('rail');
    expect(inferOwnerCategoryFromDtp(null, 'rail overpass something')).toBe('rail');
  });

  it('maps HF (highway/freeway) to state_govt', () => {
    expect(inferOwnerCategoryFromDtp('HF', 'ROAD OVER PERENNIAL WATERCOURSE')).toBe('state_govt');
  });

  it('maps MR (municipal road, still SN) to state_govt', () => {
    expect(inferOwnerCategoryFromDtp('MR', 'ROAD OVER SEASONAL WATERCOURSE')).toBe('state_govt');
  });

  it('maps TR (tourist road) to state_govt', () => {
    expect(inferOwnerCategoryFromDtp('TR', null)).toBe('state_govt');
  });

  it('maps FR (forest road) to state_govt', () => {
    expect(inferOwnerCategoryFromDtp('FR', null)).toBe('state_govt');
  });

  it('maps NULL class to state_govt', () => {
    expect(inferOwnerCategoryFromDtp(null, null)).toBe('state_govt');
    expect(inferOwnerCategoryFromDtp('NULL', 'PEDESTRIAN BRIDGE')).toBe('state_govt');
  });
});
