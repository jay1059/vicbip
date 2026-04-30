import type { BridgeDetail } from '@vicbip/shared';

interface SolutionMatchInput {
  bridge_type: string | null;
  construction_year: number | null;
  span_m: number | null;
  tenders: BridgeDetail['tenders'];
}

export function computeSolutionMatch(input: SolutionMatchInput): string[] {
  const { bridge_type, construction_year, span_m, tenders } = input;
  const solutions: string[] = [];

  const year = construction_year;
  const type = (bridge_type ?? '').toLowerCase();

  if (type.includes('prestressed') && year !== null && year < 1980) {
    solutions.push('External Post-Tensioning');
  }

  if (year !== null && year < 2004) {
    solutions.push('CFRP Structural Strengthening');
  }

  if (year !== null && year < 1985) {
    solutions.push('Concrete Rehabilitation');
  }

  const now = new Date();
  const cutoff25y = now.getFullYear() - 25;

  const hasRecentMaintenance = tenders.some((t) => {
    if (!t.published_date) return false;
    return new Date(t.published_date).getFullYear() >= cutoff25y;
  });

  if (year !== null && (year < 1995 || !hasRecentMaintenance)) {
    solutions.push('Bearing Replacement');
  }

  if (year !== null && year < 2000) {
    solutions.push('Expansion Joint Repair');
  }

  if (year !== null && year < 1995 && span_m !== null && span_m > 50) {
    solutions.push('Seismic Retrofitting');
  }

  return solutions;
}
