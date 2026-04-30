#!/usr/bin/env python3
"""
Ingest Victorian bridges from OpenStreetMap via the Overpass API.
Adds bridges not already present in the local DB (fuzzy name match).
"""

import os
import sys
import logging
import time
from typing import Optional

import requests
import psycopg2
from rapidfuzz import fuzz
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '..', '..', '.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
FUZZY_THRESHOLD = 85


def query_overpass() -> list:
    query = """
    [out:json][timeout:60];
    area['name'='Victoria']['admin_level'='4']->.vic;
    (
      way['bridge'='yes']['name'](area.vic);
    );
    out center tags;
    """
    log.info('Querying Overpass API for Victorian bridges…')
    try:
        resp = requests.post(
            OVERPASS_URL,
            data={'data': query},
            timeout=90,
            headers={'User-Agent': 'VicBIP/1.0 (Freyssinet Australia internal tool)'},
        )
        resp.raise_for_status()
        data = resp.json()
        elements = data.get('elements', [])
        log.info(f'Overpass returned {len(elements)} elements')
        return elements
    except Exception as e:
        log.error(f'Overpass query failed: {e}')
        sys.exit(1)


def main() -> None:
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        log.error('DATABASE_URL not set')
        sys.exit(1)

    try:
        conn = psycopg2.connect(db_url)
    except Exception as e:
        log.error(f'Failed to connect to database: {e}')
        sys.exit(1)

    # Load existing bridge names for fuzzy matching
    with conn.cursor() as cur:
        cur.execute('SELECT id, name FROM bridges')
        existing_bridges = [(row[0], row[1]) for row in cur.fetchall()]

    log.info(f'Loaded {len(existing_bridges)} existing bridges for deduplication')

    elements = query_overpass()

    inserted = 0
    skipped_duplicate = 0
    skipped_no_location = 0

    for element in elements:
        tags = element.get('tags', {})
        name = tags.get('name')
        if not name:
            continue

        center = element.get('center')
        if not center:
            skipped_no_location += 1
            continue

        lat = center.get('lat')
        lon = center.get('lon')
        if lat is None or lon is None:
            skipped_no_location += 1
            continue

        # Check length tag
        length_str = tags.get('maxlength') or tags.get('length') or tags.get('est_width')
        try:
            length_m = float(length_str) if length_str else None
        except ValueError:
            length_m = None

        if length_m is not None and length_m < 20:
            continue  # Too short, skip

        # Fuzzy deduplication against existing names
        is_duplicate = False
        for _, existing_name in existing_bridges:
            score = fuzz.ratio(name.lower(), existing_name.lower())
            if score >= FUZZY_THRESHOLD:
                is_duplicate = True
                break

        if is_duplicate:
            skipped_duplicate += 1
            continue

        # Insert new bridge
        bridge_type = tags.get('bridge:structure') or tags.get('construction') or 'Unknown'
        osm_id = str(element.get('id', ''))
        bridge_id = f'osm_{osm_id}'

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO bridges (
                        bridge_id, name, latitude, longitude, owner_category,
                        data_sources, last_ingested, span_m, bridge_type
                    ) VALUES (
                        %s, %s, %s, %s,
                        'other',
                        ARRAY['osm'], NOW(),
                        %s, %s
                    )
                    ON CONFLICT (bridge_id) DO NOTHING
                    """,
                    (bridge_id, name, lat, lon, length_m, bridge_type),
                )
            conn.commit()

            existing_bridges.append((osm_id, name))
            inserted += 1

        except Exception as e:
            log.warning(f'Failed to insert OSM bridge "{name}": {e}')
            conn.rollback()

    conn.close()

    log.info(
        f'OSM ingestion complete — inserted: {inserted}, '
        f'skipped (duplicate): {skipped_duplicate}, '
        f'skipped (no location): {skipped_no_location}'
    )


if __name__ == '__main__':
    main()
