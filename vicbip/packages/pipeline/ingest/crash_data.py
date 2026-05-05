#!/usr/bin/env python3
"""
Ingest Victoria Road Crash Data and compute per-bridge crash summaries.
Downloads GeoJSON in streaming mode (file can be 100 MB+).
Matches crashes within 150m of bridges using haversine.

Source: opendata.transport.vic.gov.au — Victoria Road Crash Data (CC BY 4.0)
"""

import os
import sys
import math
import json
import tempfile
import logging
import time
from datetime import date
from typing import Optional

import requests
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

CRASH_GEOJSON_URL = (
    'https://opendata.transport.vic.gov.au/dataset/'
    'victoria-road-crash-data/resource/'
    '92b63aed-6d64-42a0-b708-66c2c23dae7d/download/'
    'victoria_road_crash_data.geojson'
)

ADJACENT_DIST_M = 150
ON_BRIDGE_DIST_M = 50
MIN_DATE = '2019-01-01'

FATAL_SEVERITIES = {'Fatal accident', 'Fatality', 'Fatal'}
SERIOUS_SEVERITIES = {'Serious injury accident', 'Serious injury', 'Other injury accident'}

HEAVY_KEYWORDS = ['heavy', 'truck', 'bus', 'semi', 'articulated', 'oversize', 'overweight', 'b-double']


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def connect_db():
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        log.error('DATABASE_URL not set')
        sys.exit(1)
    return psycopg2.connect(db_url)


def load_bridges(conn) -> list:
    with conn.cursor() as cur:
        cur.execute('SELECT id, latitude, longitude FROM bridges WHERE latitude IS NOT NULL')
        return [(str(r[0]), float(r[1]), float(r[2])) for r in cur.fetchall()]


def find_nearest_bridge(lat: float, lon: float, bridges: list, max_dist_m: float) -> Optional[tuple]:
    best_dist = max_dist_m
    best_id = None
    for bridge_id, b_lat, b_lon in bridges:
        d = haversine(lat, lon, b_lat, b_lon)
        if d < best_dist:
            best_dist = d
            best_id = bridge_id
    return (best_id, best_dist) if best_id else None


def is_heavy_vehicle(props: dict) -> bool:
    search = (
        str(props.get('VEHICLE_1_TYPE', '')) + ' ' +
        str(props.get('VEHICLE_2_TYPE', '')) + ' ' +
        str(props.get('ACCIDENT_TYPE', '')) + ' ' +
        str(props.get('LIGHT_CONDITION', ''))
    ).lower()
    return any(kw in search for kw in HEAVY_KEYWORDS)


def download_crash_data(tmp_path: str) -> None:
    """Stream download the crash GeoJSON to a temp file."""
    log.info(f'Streaming crash GeoJSON from {CRASH_GEOJSON_URL}')
    resp = requests.get(
        CRASH_GEOJSON_URL,
        stream=True,
        timeout=300,
        headers={'User-Agent': 'VicBIP/1.0'},
    )
    resp.raise_for_status()

    total_bytes = 0
    with open(tmp_path, 'wb') as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
            total_bytes += len(chunk)
            if total_bytes % (10 * 1024 * 1024) == 0:
                log.info(f'Downloaded {total_bytes // 1024 // 1024} MB')

    log.info(f'Download complete: {total_bytes // 1024 // 1024} MB at {tmp_path}')


def ensure_crash_summary_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bridge_crash_summary (
              bridge_id               UUID PRIMARY KEY REFERENCES bridges(id) ON DELETE CASCADE,
              total_crashes           INT DEFAULT 0,
              fatal_crashes           INT DEFAULT 0,
              serious_crashes         INT DEFAULT 0,
              heavy_vehicle_crashes   INT DEFAULT 0,
              bridge_adjacent_crashes INT DEFAULT 0,
              on_bridge_crashes       INT DEFAULT 0,
              date_range_start        DATE,
              date_range_end          DATE,
              crash_risk_score        FLOAT DEFAULT 0
            )
        """)
    conn.commit()


def upsert_crash_summary(conn, bridge_id: str, summary: dict) -> None:
    risk_score = min(10.0,
        summary['fatal'] * 3 +
        summary['serious'] * 1.5 +
        summary['heavy'] * 2 +
        summary['on_bridge'] * 2
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO bridge_crash_summary (
                bridge_id, total_crashes, fatal_crashes, serious_crashes,
                heavy_vehicle_crashes, bridge_adjacent_crashes, on_bridge_crashes,
                date_range_start, date_range_end, crash_risk_score
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (bridge_id) DO UPDATE SET
                total_crashes           = EXCLUDED.total_crashes,
                fatal_crashes           = EXCLUDED.fatal_crashes,
                serious_crashes         = EXCLUDED.serious_crashes,
                heavy_vehicle_crashes   = EXCLUDED.heavy_vehicle_crashes,
                bridge_adjacent_crashes = EXCLUDED.bridge_adjacent_crashes,
                on_bridge_crashes       = EXCLUDED.on_bridge_crashes,
                date_range_start        = EXCLUDED.date_range_start,
                date_range_end          = EXCLUDED.date_range_end,
                crash_risk_score        = EXCLUDED.crash_risk_score
            """,
            (
                bridge_id,
                summary['total'],
                summary['fatal'],
                summary['serious'],
                summary['heavy'],
                summary['adjacent'],
                summary['on_bridge'],
                summary['date_start'],
                summary['date_end'],
                round(risk_score, 2),
            ),
        )
    conn.commit()


def main() -> None:
    log.info('Starting crash data ingestion')
    start = time.time()

    conn = connect_db()
    ensure_crash_summary_table(conn)
    bridges = load_bridges(conn)
    log.info(f'Loaded {len(bridges)} bridges for spatial matching')

    with tempfile.NamedTemporaryFile(suffix='.geojson', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        download_crash_data(tmp_path)

        log.info('Parsing crash GeoJSON…')
        with open(tmp_path, 'r', encoding='utf-8', errors='replace') as f:
            crash_data = json.load(f)

        features = crash_data.get('features', [])
        log.info(f'Total crash features: {len(features)}')

        # Accumulate crash stats per bridge
        bridge_summaries: dict = {}

        processed = 0
        matched = 0
        filtered_severity = 0
        filtered_date = 0

        for feature in features:
            processed += 1
            if processed % 10000 == 0:
                log.info(f'Processing crash {processed}/{len(features)}, matched={matched}')

            props = feature.get('properties', {})
            geom = feature.get('geometry', {})

            # Date filter
            accident_date_raw = str(props.get('ACCIDENT_DATE') or props.get('accident_date') or '')
            if accident_date_raw:
                accident_date = accident_date_raw[:10]
                if accident_date < MIN_DATE:
                    filtered_date += 1
                    continue
            else:
                accident_date = None

            # Severity filter
            severity = str(props.get('SEVERITY') or props.get('severity') or '')
            is_fatal = severity in FATAL_SEVERITIES
            is_serious = severity in SERIOUS_SEVERITIES or 'injury' in severity.lower()

            if not (is_fatal or is_serious):
                filtered_severity += 1
                continue

            # Extract coordinates
            coords = geom.get('coordinates', [])
            if not coords:
                continue

            if isinstance(coords[0], list):
                lon, lat = coords[0][0], coords[0][1]
            else:
                lon, lat = coords[0], coords[1]

            try:
                lat, lon = float(lat), float(lon)
            except (ValueError, TypeError):
                continue

            if not (-40 < lat < -33 and 140 < lon < 150):  # Victorian bounds check
                continue

            # Find nearest bridge
            match = find_nearest_bridge(lat, lon, bridges, ADJACENT_DIST_M)
            if not match:
                continue

            bridge_id, dist_m = match
            matched += 1

            is_heavy = is_heavy_vehicle(props)
            is_on_bridge = dist_m <= ON_BRIDGE_DIST_M

            if bridge_id not in bridge_summaries:
                bridge_summaries[bridge_id] = {
                    'total': 0, 'fatal': 0, 'serious': 0,
                    'heavy': 0, 'adjacent': 0, 'on_bridge': 0,
                    'date_start': accident_date, 'date_end': accident_date,
                }

            s = bridge_summaries[bridge_id]
            s['total'] += 1
            s['adjacent'] += 1
            if is_fatal:
                s['fatal'] += 1
            if is_serious:
                s['serious'] += 1
            if is_heavy:
                s['heavy'] += 1
            if is_on_bridge:
                s['on_bridge'] += 1
            if accident_date:
                if s['date_start'] and accident_date < s['date_start']:
                    s['date_start'] = accident_date
                if s['date_end'] and accident_date > s['date_end']:
                    s['date_end'] = accident_date

        log.info(
            f'Crash processing complete: processed={processed}, matched={matched}, '
            f'filtered_date={filtered_date}, filtered_severity={filtered_severity}, '
            f'bridges_with_crashes={len(bridge_summaries)}'
        )

        # Upsert summaries
        upserted = 0
        for bridge_id, summary in bridge_summaries.items():
            try:
                upsert_crash_summary(conn, bridge_id, summary)
                upserted += 1
            except Exception as e:
                log.warning(f'DB error for bridge {bridge_id}: {e}')
                conn.rollback()

        log.info(f'Upserted {upserted} bridge crash summaries')

    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    conn.close()
    elapsed = round(time.time() - start, 1)
    log.info(f'Crash data ingestion complete in {elapsed}s')
    print(json.dumps({
        'total_crash_features': len(features),
        'crashes_matched': matched,
        'bridges_with_crashes': len(bridge_summaries),
        'summaries_upserted': upserted,
        'duration_s': elapsed,
    }))


if __name__ == '__main__':
    main()
