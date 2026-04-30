#!/usr/bin/env python3
"""
Ingest Victorian road bridges from the DTP Open Data portal.
Downloads the Road Bridges Register CSV, filters, scores, and upserts into PostgreSQL.
"""

import os
import sys
import logging
from datetime import datetime
from typing import Optional

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '..', '..', '.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

CSV_URL = (
    'https://opendata.transport.vic.gov.au/dataset/05efb8bc-677e-46f1-b1b1-fa5caff65067/'
    'resource/8d8b54fe-2515-4b1f-8601-a134b7a88d3c/download/road_bridges.csv'
)


def infer_owner_category(owner_name: Optional[str]) -> str:
    if not owner_name:
        return 'other'
    n = owner_name.lower()
    if any(k in n for k in ['department of transport', 'dtp', 'vicroads', 'vic roads']):
        return 'state_govt'
    if any(k in n for k in ['council', 'shire', 'city of', 'borough']):
        return 'local_govt'
    if any(k in n for k in ['metro trains', 'victrack', 'v/line', 'rail', 'railway']):
        return 'rail'
    if 'transurban' in n:
        return 'toll_road'
    if any(k in n for k in ['water', 'ausnet', 'apa', 'jemena']):
        return 'utility'
    if 'port' in n:
        return 'port'
    return 'other'


def infer_design_load_std(year: Optional[int]) -> str:
    if year is None:
        return 'Unknown'
    if year < 1960:
        return 'W7.5 / Pre-T44'
    if year < 1975:
        return 'T-44 (1965 Standard)'
    if year < 1992:
        return 'Modified T-44'
    if year < 2004:
        return 'AS 1170 Transitional'
    return 'AS 5100 SM1600'


def compute_sri_score(year: Optional[int]) -> float:
    if year is not None:
        age_pts = min(35, max(0, (2025 - year) / 80 * 35))
    else:
        age_pts = 20

    if year is not None and year < 1960:
        std_pts = 20
    elif year is not None and year < 1975:
        std_pts = 15
    elif year is not None and year < 1992:
        std_pts = 10
    elif year is not None and year < 2004:
        std_pts = 5
    elif year is not None:
        std_pts = 0
    else:
        std_pts = 10

    base_pts = 10
    return min(100.0, age_pts + std_pts + base_pts)


def compute_risk_tier(sri_score: float) -> str:
    if sri_score >= 80:
        return 'critical'
    if sri_score >= 60:
        return 'high'
    if sri_score >= 40:
        return 'moderate'
    return 'low'


def main() -> None:
    log.info('Starting VicRoads bridges ingestion')
    log.info(f'Downloading CSV from {CSV_URL}')

    try:
        df = pd.read_csv(CSV_URL, low_memory=False)
        log.info(f'Downloaded {len(df)} records')
    except Exception as e:
        log.error(f'Failed to download CSV: {e}')
        sys.exit(1)

    log.info(f'Columns: {list(df.columns)}')

    # Normalise column names — the actual column names may vary
    df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]
    log.info(f'Normalised columns: {list(df.columns)}')

    # Map to our schema — try multiple candidate column names
    col_map = {
        'bridge_id': ['bridge_id', 'structure_id', 'asset_id', 'bms_id'],
        'name': ['bridge_name', 'name', 'structure_name', 'asset_name'],
        'road_name': ['road_name', 'road', 'street_name'],
        'bridge_type': ['bridge_type', 'structure_type', 'type'],
        'construction_year': ['construction_year', 'year_built', 'year_constructed', 'built'],
        'span_m': ['span_m', 'span_(m)', 'span', 'total_span_m', 'total_span_(m)'],
        'feature_crossed': ['feature_crossed', 'feature', 'crossing'],
        'owner_name': ['owner_name', 'owner', 'responsible_authority', 'authority'],
        'latitude': ['latitude', 'lat', 'y', 'y_coord'],
        'longitude': ['longitude', 'lon', 'lng', 'x', 'x_coord'],
    }

    def find_col(candidates: list) -> Optional[str]:
        for c in candidates:
            if c in df.columns:
                return c
        return None

    mapped = {field: find_col(candidates) for field, candidates in col_map.items()}
    log.info(f'Column mapping: {mapped}')

    missing_critical = [f for f in ['name', 'latitude', 'longitude'] if mapped[f] is None]
    if missing_critical:
        log.error(f'Critical columns not found: {missing_critical}')
        log.error(f'Available columns: {list(df.columns)}')
        # Try to proceed with what we have
        if mapped['name'] is None and len(df.columns) > 0:
            mapped['name'] = df.columns[0]
            log.warning(f'Falling back to first column as name: {mapped["name"]}')

    # Rename to canonical names
    rename = {v: k for k, v in mapped.items() if v is not None}
    df = df.rename(columns=rename)

    # Filter: span_m >= 20 AND bridge_type NOT LIKE '%culvert%'
    initial_count = len(df)

    if 'span_m' in df.columns:
        df['span_m'] = pd.to_numeric(df['span_m'], errors='coerce')
        df = df[df['span_m'].notna() & (df['span_m'] >= 20)]

    if 'bridge_type' in df.columns:
        df = df[~df['bridge_type'].str.lower().str.contains('culvert', na=False)]

    log.info(f'After filtering: {len(df)} / {initial_count} records')

    if len(df) == 0:
        log.warning('No records after filtering — check column mapping')

    # Coerce types
    if 'construction_year' in df.columns:
        df['construction_year'] = pd.to_numeric(df['construction_year'], errors='coerce')
        df['construction_year'] = df['construction_year'].where(
            df['construction_year'].notna(), other=None
        )

    if 'latitude' not in df.columns or 'longitude' not in df.columns:
        log.error('Latitude/longitude columns not found — cannot insert geometries')
        sys.exit(1)

    df['latitude'] = pd.to_numeric(df['latitude'], errors='coerce')
    df['longitude'] = pd.to_numeric(df['longitude'], errors='coerce')
    df = df[df['latitude'].notna() & df['longitude'].notna()]

    # Compute derived fields
    df['owner_category'] = df.get('owner_name', pd.Series(dtype=str)).apply(infer_owner_category)
    df['design_load_std'] = df.get('construction_year', pd.Series(dtype=float)).apply(
        lambda y: infer_design_load_std(int(y) if pd.notna(y) else None)
    )
    df['sri_score'] = df.get('construction_year', pd.Series(dtype=float)).apply(
        lambda y: compute_sri_score(int(y) if pd.notna(y) else None)
    )
    df['risk_tier'] = df['sri_score'].apply(compute_risk_tier)

    # Connect to DB
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        log.error('DATABASE_URL not set')
        sys.exit(1)

    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
    except Exception as e:
        log.error(f'Failed to connect to database: {e}')
        sys.exit(1)

    inserted = 0
    updated = 0
    skipped = 0

    with conn:
        with conn.cursor() as cur:
            for _, row in df.iterrows():
                try:
                    bridge_id = str(row.get('bridge_id', '')) if pd.notna(row.get('bridge_id')) else None
                    name = str(row.get('name', 'Unknown Bridge'))
                    road_name = str(row.get('road_name', '')) if pd.notna(row.get('road_name')) else None
                    bridge_type = str(row.get('bridge_type', '')) if pd.notna(row.get('bridge_type')) else None
                    construction_year = int(row['construction_year']) if pd.notna(row.get('construction_year')) else None
                    span_m = float(row['span_m']) if pd.notna(row.get('span_m')) else None
                    feature_crossed = str(row.get('feature_crossed', '')) if pd.notna(row.get('feature_crossed')) else None
                    owner_name = str(row.get('owner_name', '')) if pd.notna(row.get('owner_name')) else None
                    owner_category = row['owner_category']
                    latitude = float(row['latitude'])
                    longitude = float(row['longitude'])
                    design_load_std = row['design_load_std']
                    sri_score = float(row['sri_score'])
                    risk_tier = row['risk_tier']

                    cur.execute(
                        """
                        INSERT INTO bridges (
                            bridge_id, name, road_name, bridge_type, construction_year,
                            span_m, feature_crossed, owner_name, owner_category,
                            latitude, longitude,
                            design_load_std, sri_score, risk_tier,
                            data_sources, last_ingested
                        ) VALUES (
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s,
                            %s, %s, %s,
                            ARRAY['vicroads_dtp'], NOW()
                        )
                        ON CONFLICT (bridge_id) DO UPDATE SET
                            name = EXCLUDED.name,
                            road_name = EXCLUDED.road_name,
                            bridge_type = EXCLUDED.bridge_type,
                            construction_year = EXCLUDED.construction_year,
                            span_m = EXCLUDED.span_m,
                            feature_crossed = EXCLUDED.feature_crossed,
                            owner_name = EXCLUDED.owner_name,
                            owner_category = EXCLUDED.owner_category,
                            latitude = EXCLUDED.latitude,
                            longitude = EXCLUDED.longitude,
                            design_load_std = EXCLUDED.design_load_std,
                            sri_score = EXCLUDED.sri_score,
                            risk_tier = EXCLUDED.risk_tier,
                            data_sources = EXCLUDED.data_sources,
                            last_ingested = NOW()
                        RETURNING (xmax = 0) AS is_insert
                        """,
                        (
                            bridge_id, name, road_name, bridge_type, construction_year,
                            span_m, feature_crossed, owner_name, owner_category,
                            latitude, longitude,
                            design_load_std, sri_score, risk_tier,
                        )
                    )

                    result = cur.fetchone()
                    if result and result[0]:
                        inserted += 1
                    else:
                        updated += 1

                except Exception as e:
                    log.warning(f'Skipped row (name={row.get("name", "?")}): {e}')
                    skipped += 1
                    conn.rollback()

    conn.close()

    log.info(
        f'Ingestion complete — processed: {len(df)}, '
        f'inserted: {inserted}, updated: {updated}, skipped: {skipped}'
    )


if __name__ == '__main__':
    main()
