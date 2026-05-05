#!/usr/bin/env python3
"""
Ingest Annual Average Daily Traffic Volume (AADT) from Transport Victoria Open Data.
Data is GeoJSON LineString segments with traffic counts per road segment.

Source: opendata.transport.vic.gov.au — Historical AADT Volume (CC BY 4.0)
Downloads the 2019 dataset (most recent available).
Matches each segment centroid to the nearest bridge within 1500m using haversine.
Upserts into bridge_traffic table.
"""

import os
import sys
import math
import json
import logging
import time
import urllib.request
from typing import Optional

import psycopg2
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '..', '..', '.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

AADT_2019_URL = (
    'https://opendata.transport.vic.gov.au/dataset/'
    '26fafd1a-8d59-4da0-93cd-29f371147d8f/resource/'
    '425799c9-658c-41cf-b9b0-6c9a145856cf/download/yearly_aadt_volume_2019.geojson'
)

MAX_MATCH_DIST_M = 1500
DATA_YEAR = 2019
DEFAULT_HEAVY_PCT = 8.0  # fallback when heavy vehicle field is missing


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in metres between two WGS84 coordinates."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def linestring_centroid(coords: list) -> tuple:
    """Return (lat, lon) centroid of a LineString coordinate list."""
    mid = coords[len(coords) // 2]
    return mid[1], mid[0]  # GeoJSON is [lon, lat]


def connect_db():
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        log.error('DATABASE_URL not set')
        sys.exit(1)
    return psycopg2.connect(db_url)


def load_bridges(conn: psycopg2.extensions.connection) -> list:
    with conn.cursor() as cur:
        cur.execute('SELECT id, latitude, longitude FROM bridges WHERE latitude IS NOT NULL')
        return [(str(r[0]), float(r[1]), float(r[2])) for r in cur.fetchall()]


def find_nearest_bridge(
    station_lat: float,
    station_lon: float,
    bridges: list,
    max_dist_m: float,
) -> Optional[tuple]:
    """Return (bridge_id, distance_m) for the nearest bridge within max_dist_m, or None."""
    best_dist = max_dist_m
    best_id = None
    for bridge_id, b_lat, b_lon in bridges:
        d = haversine(station_lat, station_lon, b_lat, b_lon)
        if d < best_dist:
            best_dist = d
            best_id = bridge_id
    return (best_id, best_dist) if best_id else None


def download_geojson(url: str) -> dict:
    log.info(f'Downloading AADT GeoJSON from {url}')
    req = urllib.request.Request(url, headers={'User-Agent': 'VicBIP/1.0'})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    log.info(f'Downloaded {len(data.get("features", []))} features')
    return data


def upsert_traffic(conn, bridge_id: str, aadt_total: int, heavy_pct: float,
                   station_id: str, station_dist_m: float) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO bridge_traffic (bridge_id, year, aadt_total, heavy_pct, station_id, station_dist_m)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (bridge_id, year) DO UPDATE SET
                aadt_total     = EXCLUDED.aadt_total,
                heavy_pct      = EXCLUDED.heavy_pct,
                station_id     = EXCLUDED.station_id,
                station_dist_m = EXCLUDED.station_dist_m
            RETURNING (xmax = 0) AS is_insert
            """,
            (bridge_id, DATA_YEAR, aadt_total, heavy_pct, station_id, station_dist_m),
        )
        row = cur.fetchone()
    conn.commit()
    return 'inserted' if (row and row[0]) else 'updated'


def main() -> None:
    log.info('Starting AADT traffic ingestion')
    start = time.time()

    conn = connect_db()
    bridges = load_bridges(conn)
    log.info(f'Loaded {len(bridges)} bridges for spatial matching')

    geojson = download_geojson(AADT_2019_URL)
    features = geojson.get('features', [])

    stations_downloaded = len(features)
    bridges_matched = 0
    unmatched = 0
    inserted = 0
    updated = 0
    high_hv_count = 0
    total_dist = 0.0
    match_count = 0

    for i, feature in enumerate(features):
        if i > 0 and i % 1000 == 0:
            log.info(f'Progress: {i}/{stations_downloaded} features processed '
                     f'(matched={bridges_matched}, unmatched={unmatched})')

        geom = feature.get('geometry', {})
        props = feature.get('properties', {})

        geom_type = geom.get('type', '')
        coords = geom.get('coordinates', [])

        if geom_type == 'LineString' and coords:
            seg_lat, seg_lon = linestring_centroid(coords)
        elif geom_type == 'MultiLineString' and coords:
            first_line = coords[0]
            seg_lat, seg_lon = linestring_centroid(first_line)
        elif geom_type == 'Point' and coords:
            seg_lon, seg_lat = coords[0], coords[1]
        else:
            unmatched += 1
            continue

        aadt_val = props.get('Average Annual Daily Traffic Volume') or props.get('AADT') or 0
        try:
            aadt_total = int(float(aadt_val))
        except (ValueError, TypeError):
            unmatched += 1
            continue

        if aadt_total <= 0:
            unmatched += 1
            continue

        heavy_pct_raw = props.get('Percentage of Heavy Vehicles') or props.get('PC_MULTI_UNIT')
        if heavy_pct_raw is not None:
            try:
                heavy_pct = float(heavy_pct_raw) * 100 if float(heavy_pct_raw) <= 1.0 else float(heavy_pct_raw)
            except (ValueError, TypeError):
                heavy_pct = DEFAULT_HEAVY_PCT
        else:
            # Try deriving from heavy vehicle volume
            hv_vol = props.get('Average Annual Daily Heavy Vehicle Volume')
            if hv_vol and aadt_total > 0:
                try:
                    heavy_pct = (float(hv_vol) / aadt_total) * 100
                except (ValueError, TypeError):
                    heavy_pct = DEFAULT_HEAVY_PCT
            else:
                heavy_pct = DEFAULT_HEAVY_PCT

        station_id = str(props.get('Road Segment ID') or props.get('SITE_NO') or props.get('SITE_ID') or i)

        match = find_nearest_bridge(seg_lat, seg_lon, bridges, MAX_MATCH_DIST_M)
        if not match:
            unmatched += 1
            continue

        bridge_id, dist_m = match
        bridges_matched += 1
        total_dist += dist_m
        match_count += 1

        if heavy_pct > 10.0:
            high_hv_count += 1

        try:
            result = upsert_traffic(conn, bridge_id, aadt_total, round(heavy_pct, 2),
                                    station_id, round(dist_m, 1))
            if result == 'inserted':
                inserted += 1
            else:
                updated += 1
        except Exception as e:
            log.warning(f'DB error for bridge {bridge_id}: {e}')
            conn.rollback()

    conn.close()
    avg_dist = round(total_dist / match_count, 1) if match_count > 0 else 0.0
    elapsed = round(time.time() - start, 1)

    log.info(
        f'AADT ingestion complete in {elapsed}s — '
        f'stations_downloaded={stations_downloaded}, bridges_matched={bridges_matched}, '
        f'unmatched={unmatched}, inserted={inserted}, updated={updated}, '
        f'avg_distance_m={avg_dist}, bridges_with_high_hv={high_hv_count}'
    )
    print(json.dumps({
        'stations_downloaded': stations_downloaded,
        'bridges_matched': bridges_matched,
        'unmatched': unmatched,
        'inserted': inserted,
        'updated': updated,
        'avg_distance_m': avg_dist,
        'bridges_with_high_hv': high_hv_count,
    }))


if __name__ == '__main__':
    main()
