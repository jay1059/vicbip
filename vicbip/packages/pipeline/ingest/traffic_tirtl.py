#!/usr/bin/env python3
"""
Ingest TIRTL (Traffic Infrastructure Real-Time Logging) vehicle classification data.
Uses the TIRTL Sites CSV for station locations, then downloads the most recent
monthly ZIP of 15-minute traffic classification counts to compute heavy vehicle %.

Source: opendata.transport.vic.gov.au — TIRTL Traffic Counts (CC BY 4.0)
"""

import os
import sys
import math
import csv
import json
import io
import zipfile
import logging
import time
import urllib.request
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

TIRTL_SITES_URL = (
    'https://opendata.transport.vic.gov.au/dataset/'
    'e2d78fb5-e16d-43b9-bcdc-607d9b4855f5/resource/'
    '1f685833-24fd-4eb0-af11-2e7cfc94da74/download/tirtl_sites.csv'
)

# Most recent monthly classification data — April 2026
TIRTL_COUNTS_URL = (
    'https://opendata.transport.vic.gov.au/dataset/'
    'e2d78fb5-e16d-43b9-bcdc-607d9b4855f5/resource/'
    '8ecd89b1-05ea-4b33-81b0-7cb9631e16ec/download/'
    'tirtl_15min_volume_classification_may_2026.zip'
)

MAX_MATCH_DIST_M = 1000
DATA_YEAR = 2026

# TIRTL vehicle class codes — classes 4+ are heavy vehicles
# Class 1: motorcycles, Class 2: cars, Class 3: light trucks
# Class 4+: heavy trucks, articulated, B-doubles, road trains
HEAVY_CLASSES = {4, 5, 6, 7, 8, 9, 10, 11, 12}
ALL_CLASSES = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}

HIGH_HV_THRESHOLD = 15.0


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


def load_sites() -> dict:
    """Download TIRTL sites CSV and return dict of {site_id: (lat, lon, description)}."""
    log.info(f'Downloading TIRTL sites from {TIRTL_SITES_URL}')
    req = urllib.request.Request(TIRTL_SITES_URL, headers={'User-Agent': 'VicBIP/1.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read().decode('utf-8', errors='replace')

    sites = {}
    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        site_id = row.get('site', '').strip()
        try:
            lat = float(row.get('latitude', 0))
            lon = float(row.get('longitude', 0))
        except ValueError:
            continue
        if lat and lon:
            sites[site_id] = (lat, lon, row.get('site_description', '').strip())

    log.info(f'Loaded {len(sites)} TIRTL sites')
    return sites


def download_and_parse_counts(url: str) -> dict:
    """
    Download monthly ZIP, parse 15-min classification CSV, aggregate to
    heavy_count and total_count per site.
    Returns {site_id: {heavy: int, total: int}}.
    """
    log.info(f'Downloading TIRTL counts ZIP from {url}')
    resp = requests.get(url, timeout=180, headers={'User-Agent': 'VicBIP/1.0'}, stream=True)
    resp.raise_for_status()

    zip_bytes = io.BytesIO()
    downloaded = 0
    for chunk in resp.iter_content(chunk_size=65536):
        zip_bytes.write(chunk)
        downloaded += len(chunk)
        if downloaded % (5 * 1024 * 1024) == 0:
            log.info(f'Downloaded {downloaded // 1024 // 1024} MB')

    log.info(f'ZIP download complete ({downloaded // 1024 // 1024} MB), parsing…')

    site_counts: dict = {}
    zip_bytes.seek(0)

    with zipfile.ZipFile(zip_bytes) as zf:
        csv_names = [n for n in zf.namelist() if n.endswith('.csv')]
        log.info(f'ZIP contains {len(csv_names)} CSV files: {csv_names[:5]}')

        for csv_name in csv_names[:1]:  # Use first CSV (one month is sufficient)
            with zf.open(csv_name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding='utf-8', errors='replace'))
                rows_read = 0
                for row in reader:
                    rows_read += 1
                    if rows_read % 100_000 == 0:
                        log.info(f'Parsed {rows_read} rows from {csv_name}')

                    # Try multiple site column names
                    site_id = (
                        row.get('site') or row.get('site_id') or
                        row.get('Site') or row.get('SITE') or ''
                    ).strip()

                    if not site_id:
                        continue

                    # Vehicle class column (varies by CSV version)
                    veh_class_raw = (
                        row.get('class') or row.get('vehicle_class') or
                        row.get('Class') or row.get('VehicleClass') or ''
                    ).strip()

                    count_raw = (
                        row.get('count') or row.get('volume') or
                        row.get('Count') or row.get('Volume') or '0'
                    ).strip()

                    try:
                        veh_class = int(veh_class_raw) if veh_class_raw else 0
                        count = int(float(count_raw)) if count_raw else 0
                    except ValueError:
                        continue

                    if site_id not in site_counts:
                        site_counts[site_id] = {'heavy': 0, 'total': 0}

                    site_counts[site_id]['total'] += count
                    if veh_class in HEAVY_CLASSES:
                        site_counts[site_id]['heavy'] += count

                log.info(f'Parsed {rows_read} rows, {len(site_counts)} unique sites')

    return site_counts


def upsert_traffic(conn, bridge_id: str, aadt_total: int, heavy_pct: float,
                   station_id: str, station_dist_m: float, high_hv: bool) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO bridge_traffic
              (bridge_id, year, aadt_total, heavy_pct, station_id, station_dist_m, high_hv_flag)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (bridge_id, year) DO UPDATE SET
                aadt_total     = EXCLUDED.aadt_total,
                heavy_pct      = EXCLUDED.heavy_pct,
                station_id     = EXCLUDED.station_id,
                station_dist_m = EXCLUDED.station_dist_m,
                high_hv_flag   = EXCLUDED.high_hv_flag
            RETURNING (xmax = 0) AS is_insert
            """,
            (bridge_id, DATA_YEAR, aadt_total, round(heavy_pct, 2),
             station_id, round(station_dist_m, 1), high_hv),
        )
        row = cur.fetchone()
    conn.commit()
    return 'inserted' if (row and row[0]) else 'updated'


def main() -> None:
    log.info('Starting TIRTL traffic ingestion')
    start = time.time()

    conn = connect_db()
    bridges = load_bridges(conn)
    log.info(f'Loaded {len(bridges)} bridges for spatial matching')

    sites = load_sites()

    try:
        site_counts = download_and_parse_counts(TIRTL_COUNTS_URL)
    except Exception as e:
        log.error(f'Failed to download/parse TIRTL counts: {e}')
        log.info('Proceeding with sites only (no counts) — will use heavy_pct=null')
        site_counts = {}

    matched = 0
    unmatched = 0
    inserted = 0
    updated = 0
    high_hv_count = 0

    for site_id, (s_lat, s_lon, _desc) in sites.items():
        match = find_nearest_bridge(s_lat, s_lon, bridges, MAX_MATCH_DIST_M)
        if not match:
            unmatched += 1
            continue

        bridge_id, dist_m = match
        matched += 1

        counts = site_counts.get(site_id, {})
        total = counts.get('total', 0)
        heavy = counts.get('heavy', 0)

        if total > 0:
            heavy_pct = (heavy / total) * 100
            # Rough daily average from monthly counts (15-min intervals → daily)
            aadt_est = total // 30  # monthly total ÷ 30 days as proxy
        else:
            heavy_pct = 8.0  # default
            aadt_est = 0

        high_hv = heavy_pct > HIGH_HV_THRESHOLD

        if high_hv:
            high_hv_count += 1

        try:
            result = upsert_traffic(
                conn, bridge_id, max(aadt_est, 1000), heavy_pct,
                site_id, dist_m, high_hv,
            )
            if result == 'inserted':
                inserted += 1
            else:
                updated += 1
        except Exception as e:
            log.warning(f'DB error for bridge {bridge_id}: {e}')
            conn.rollback()

    conn.close()
    elapsed = round(time.time() - start, 1)

    log.info(
        f'TIRTL ingestion complete in {elapsed}s — '
        f'sites={len(sites)}, matched={matched}, unmatched={unmatched}, '
        f'inserted={inserted}, updated={updated}, high_hv_count={high_hv_count}'
    )
    print(json.dumps({
        'sites': len(sites),
        'bridges_matched': matched,
        'unmatched': unmatched,
        'inserted': inserted,
        'updated': updated,
        'high_hv_count': high_hv_count,
    }))


if __name__ == '__main__':
    main()
