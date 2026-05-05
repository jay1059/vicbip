#!/usr/bin/env python3
"""
Fetch planned and unplanned road disruptions from Transport Victoria Open Data.
Filters for bridge/structure-related disruptions and inserts into bridge_events.

Primary API: api.opendata.transport.vic.gov.au/opendata/roads/disruptions
Fallback: VicTraffic public RSS feed (no auth required)

Source: opendata.transport.vic.gov.au (CC BY 4.0)
"""

import os
import sys
import json
import math
import logging
import time
import re
import xml.etree.ElementTree as ET
from datetime import datetime
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

# Try the open data REST API first
DISRUPTIONS_API_URL = (
    'https://api.opendata.transport.vic.gov.au/opendata/roads/disruptions/planned/v1/'
)
# VicTraffic public RSS fallback (no auth required)
VICTRAFFIC_RSS_URL = 'https://www.victraffic.vic.gov.au/rss/alerts.rss'

BRIDGE_KEYWORDS = [
    'bridge', 'viaduct', 'overpass', 'underpass',
    'weight limit', 'weight restriction', 'load limit', 'load restriction',
    'structure inspection', 'structure assessment',
    'axle load', 'mass limit',
]

WEIGHT_RESTRICTION_KEYWORDS = [
    'weight', 'load', 'mass', 'axle', 'tonne', 'limit',
]

MAX_MATCH_DIST_M = 500


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
        cur.execute('SELECT id, name, road_name, latitude, longitude FROM bridges WHERE latitude IS NOT NULL')
        return [
            (str(r[0]), r[1], r[2], float(r[3]), float(r[4]))
            for r in cur.fetchall()
        ]


def is_bridge_related(text: str) -> bool:
    text_lower = text.lower()
    return any(kw in text_lower for kw in BRIDGE_KEYWORDS)


def classify_event(description: str) -> str:
    desc_lower = description.lower()
    if any(kw in desc_lower for kw in WEIGHT_RESTRICTION_KEYWORDS):
        return 'weight_restriction'
    return 'closure'


def find_matching_bridge(description: str, road: Optional[str], lat: Optional[float],
                         lon: Optional[float], bridges: list) -> Optional[str]:
    """Try spatial match first, then road name match."""
    if lat and lon:
        best_dist = MAX_MATCH_DIST_M
        best_id = None
        for bridge_id, b_name, b_road, b_lat, b_lon in bridges:
            d = haversine(lat, lon, b_lat, b_lon)
            if d < best_dist:
                best_dist = d
                best_id = bridge_id
        if best_id:
            return best_id

    # Road name matching
    if road:
        road_lower = road.lower()
        for bridge_id, b_name, b_road, b_lat, b_lon in bridges:
            if b_road and road_lower in b_road.lower():
                return bridge_id
            if b_name and road_lower in b_name.lower():
                return bridge_id

    return None


def parse_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%d/%m/%Y', '%d %b %Y'):
        try:
            return datetime.strptime(raw[:len(fmt)], fmt).strftime('%Y-%m-%d')
        except (ValueError, IndexError):
            continue
    return datetime.now().strftime('%Y-%m-%d')


def fetch_planned_disruptions_api() -> list:
    """Try the DTP REST API (may require auth)."""
    disruptions = []
    try:
        resp = requests.get(
            DISRUPTIONS_API_URL,
            headers={'Accept': 'application/json', 'User-Agent': 'VicBIP/1.0'},
            timeout=20,
        )
        if resp.status_code in (401, 403, 407):
            log.warning('Disruptions API requires authentication — falling back to RSS')
            return []
        resp.raise_for_status()
        data = resp.json()
        items = data if isinstance(data, list) else data.get('disruptions') or data.get('results') or []
        log.info(f'Disruptions API returned {len(items)} items')
        for item in items:
            disruptions.append({
                'title': item.get('title') or item.get('description') or '',
                'description': item.get('description') or item.get('notes') or '',
                'road': item.get('road_name') or item.get('road') or None,
                'source_url': item.get('url') or DISRUPTIONS_API_URL,
                'event_date': parse_date(item.get('start_date') or item.get('date')),
                'lat': item.get('latitude') or item.get('lat'),
                'lon': item.get('longitude') or item.get('lon'),
            })
    except Exception as e:
        log.warning(f'Disruptions API failed: {e} — falling back to RSS')
    return disruptions


def fetch_victraffic_rss() -> list:
    """Fetch VicTraffic RSS feed as fallback."""
    disruptions = []
    try:
        resp = requests.get(VICTRAFFIC_RSS_URL, timeout=20, headers={'User-Agent': 'VicBIP/1.0'})
        if not resp.ok:
            log.warning(f'VicTraffic RSS returned {resp.status_code}')
            return []

        root = ET.fromstring(resp.content)
        items = root.findall('.//item')
        log.info(f'VicTraffic RSS returned {len(items)} items')

        for item in items:
            title = (item.findtext('title') or '').strip()
            description = (item.findtext('description') or '').strip()
            link = (item.findtext('link') or VICTRAFFIC_RSS_URL).strip()
            pub_date = item.findtext('pubDate')

            # Extract lat/lon from description or geo tags
            lat = lon = None
            lat_el = item.find('{http://www.w3.org/2003/01/geo/wgs84_pos#}lat')
            lon_el = item.find('{http://www.w3.org/2003/01/geo/wgs84_pos#}long')
            if lat_el is not None and lon_el is not None:
                try:
                    lat = float(lat_el.text)
                    lon = float(lon_el.text)
                except (ValueError, TypeError):
                    pass

            # Try extracting road name from title (often "ROADNAME: description")
            road = None
            if ':' in title:
                road = title.split(':')[0].strip()

            disruptions.append({
                'title': title,
                'description': description,
                'road': road,
                'source_url': link,
                'event_date': parse_date(pub_date),
                'lat': lat,
                'lon': lon,
            })
    except Exception as e:
        log.warning(f'VicTraffic RSS failed: {e}')
    return disruptions


def insert_event(conn, bridge_id: str, event_type: str, event_date: Optional[str],
                 source_url: str, notes: str) -> bool:
    """Insert a bridge event. Skip duplicates (same bridge+type+date)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO bridge_events (bridge_id, event_type, event_date, severity, source_url, notes)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (bridge_id, event_type, event_date, 'Unknown', source_url, notes[:500]),
        )
        return cur.fetchone() is not None


def main() -> None:
    log.info('Starting disruptions ingestion')
    start = time.time()

    conn = connect_db()
    bridges = load_bridges(conn)
    log.info(f'Loaded {len(bridges)} bridges')

    # Try API first, fall back to RSS
    disruptions = fetch_planned_disruptions_api()
    if not disruptions:
        disruptions = fetch_victraffic_rss()

    log.info(f'Total disruptions fetched: {len(disruptions)}')

    inserted = 0
    skipped_not_bridge = 0
    skipped_no_match = 0
    errors = 0

    for d in disruptions:
        full_text = f"{d['title']} {d['description']}"
        if not is_bridge_related(full_text):
            skipped_not_bridge += 1
            continue

        lat = d.get('lat')
        lon = d.get('lon')
        try:
            lat = float(lat) if lat else None
            lon = float(lon) if lon else None
        except (ValueError, TypeError):
            lat = lon = None

        bridge_id = find_matching_bridge(full_text, d.get('road'), lat, lon, bridges)
        if not bridge_id:
            skipped_no_match += 1
            continue

        event_type = classify_event(full_text)
        try:
            with conn:
                ok = insert_event(
                    conn, bridge_id, event_type, d.get('event_date'),
                    d.get('source_url', DISRUPTIONS_API_URL),
                    f"{d['title']}: {d['description']}"[:500],
                )
                if ok:
                    inserted += 1
        except Exception as e:
            log.warning(f'DB error inserting event: {e}')
            errors += 1

    conn.close()
    elapsed = round(time.time() - start, 1)

    log.info(
        f'Disruptions complete in {elapsed}s — '
        f'total={len(disruptions)}, inserted={inserted}, '
        f'skipped_not_bridge={skipped_not_bridge}, skipped_no_match={skipped_no_match}, '
        f'errors={errors}'
    )
    print(json.dumps({
        'total_disruptions': len(disruptions),
        'inserted': inserted,
        'skipped_not_bridge': skipped_not_bridge,
        'skipped_no_match': skipped_no_match,
        'errors': errors,
        'duration_s': elapsed,
    }))


if __name__ == '__main__':
    main()
