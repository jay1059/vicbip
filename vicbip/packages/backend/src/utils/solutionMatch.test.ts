import { describe, it, expect } from 'vitest';
import { computeSolutionMatch } from './solutionMatch';

describe('computeSolutionMatch', () => {
  const noTenders: [] = [];

  it('recommends External Post-Tensioning for old prestressed bridges', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Prestressed Concrete',
      construction_year: 1970,
      span_m: 40,
      tenders: noTenders,
    });
    expect(result).toContain('External Post-Tensioning');
  });

  it('does NOT recommend External Post-Tensioning for post-1980 prestressed', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Prestressed Concrete',
      construction_year: 1985,
      span_m: 40,
      tenders: noTenders,
    });
    expect(result).not.toContain('External Post-Tensioning');
  });

  it('recommends CFRP for bridges before 2004', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 1990,
      span_m: 30,
      tenders: noTenders,
    });
    expect(result).toContain('CFRP Structural Strengthening');
  });

  it('does NOT recommend CFRP for modern bridges', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 2010,
      span_m: 30,
      tenders: noTenders,
    });
    expect(result).not.toContain('CFRP Structural Strengthening');
  });

  it('recommends Concrete Rehabilitation for pre-1985 bridges', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 1975,
      span_m: 30,
      tenders: noTenders,
    });
    expect(result).toContain('Concrete Rehabilitation');
  });

  it('recommends Bearing Replacement for pre-1995 bridges', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Steel',
      construction_year: 1985,
      span_m: 30,
      tenders: noTenders,
    });
    expect(result).toContain('Bearing Replacement');
  });

  it('recommends Expansion Joint Repair for pre-2000 bridges', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 1995,
      span_m: 30,
      tenders: noTenders,
    });
    expect(result).toContain('Expansion Joint Repair');
  });

  it('recommends Seismic Retrofitting for old bridges with large span', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 1980,
      span_m: 80,
      tenders: noTenders,
    });
    expect(result).toContain('Seismic Retrofitting');
  });

  it('does NOT recommend Seismic Retrofitting for small span old bridge', () => {
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 1980,
      span_m: 30,
      tenders: noTenders,
    });
    expect(result).not.toContain('Seismic Retrofitting');
  });

  it('returns only Bearing Replacement for modern bridge with no maintenance evidence', () => {
    // Per spec: Bearing Replacement added if year < 1995 OR no maintenance events in 25y.
    // A 2015 bridge with no tenders triggers the "no maintenance" clause.
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 2015,
      span_m: 30,
      tenders: noTenders,
    });
    expect(result).toEqual(['Bearing Replacement']);
  });

  it('returns empty array for modern bridge with recent maintenance', () => {
    const recentTender = [
      {
        id: 'test-id',
        bridge_id: 'bridge-id',
        title: 'Bridge Maintenance Works',
        published_date: new Date().toISOString().split('T')[0]!,
        contractor: null,
        value_aud: null,
        source: null,
        url: null,
        summary: null,
      },
    ];
    const result = computeSolutionMatch({
      bridge_type: 'Concrete',
      construction_year: 2015,
      span_m: 30,
      tenders: recentTender,
    });
    expect(result).toEqual([]);
  });

  it('handles null values gracefully', () => {
    const result = computeSolutionMatch({
      bridge_type: null,
      construction_year: null,
      span_m: null,
      tenders: noTenders,
    });
    expect(Array.isArray(result)).toBe(true);
  });
});
