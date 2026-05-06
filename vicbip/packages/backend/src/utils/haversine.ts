/** Return distance in metres between two WGS84 coordinates. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlam = toRad(lon2 - lon1);
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface BridgeRow {
  id: string;
  latitude: number;
  longitude: number;
}

/** Return the nearest bridge within maxDistM, or null. */
export function nearestBridge(
  lat: number,
  lon: number,
  bridges: BridgeRow[],
  maxDistM: number,
): { id: string; distM: number } | null {
  let bestDist = maxDistM;
  let bestId: string | null = null;
  for (const b of bridges) {
    const d = haversine(lat, lon, b.latitude, b.longitude);
    if (d < bestDist) {
      bestDist = d;
      bestId = b.id;
    }
  }
  return bestId ? { id: bestId, distM: bestDist } : null;
}
