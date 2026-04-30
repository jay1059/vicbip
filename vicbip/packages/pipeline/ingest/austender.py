#!/usr/bin/env python3
"""
Fetch contract notices from AusTender (tenders.gov.au) API for bridge-related contracts
in Victoria. Fuzzy-matches titles to bridge names and upserts into bridge_tenders.

API endpoint: GET https://www.tenders.gov.au/api/contractnotice
  ?keyword=<term>&pageSize=100&agency_state=VIC
"""

import os
import sys
import logging
import re
import time
from datetime import datetime
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

# Keywords searched with "+victoria" appended to limit to Victorian contracts
SEARCH_KEYWORDS = [
    'bridge victoria',
    'viaduct victoria',
    'strengthening victoria',
]

AUSTENDER_URL = 'https://www.tenders.gov.au/api/contractnotice'
PAGE_SIZE = 100
FUZZY_THRESHOLD = 70
REQUEST_DELAY_S = 1.0


def connect_db():
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        log.error('DATABASE_URL not set')
        sys.exit(1)
    return psycopg2.connect(db_url)


def load_bridges(conn):
    with conn.cursor() as cur:
        cur.execute('SELECT id, name FROM bridges')
        return [(str(row[0]), row[1]) for row in cur.fetchall()]


def fuzzy_match_bridge(title: str, bridges: list) -> Optional[str]:
    best_score = 0
    best_id = None
    title_lower = title.lower()
    for bridge_id, bridge_name in bridges:
        score = fuzz.partial_ratio(title_lower, bridge_name.lower())
        if score > best_score:
            best_score = score
            best_id = bridge_id
    if best_score >= FUZZY_THRESHOLD:
        return best_id
    return None


def parse_value_aud(raw) -> Optional[int]:
    if raw is None:
        return None
    try:
        return int(float(str(raw).replace(',', '')))
    except Exception:
        return None


def parse_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    # AusTender dates: "2024-03-15T00:00:00" or "15/03/2024"
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(raw[:10], fmt[:len(fmt)]).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return raw[:10] if len(raw) >= 10 else None


def fetch_contracts(keyword: str) -> list:
    """Fetch contract notices for a keyword. Returns list of raw contract dicts."""
    contracts = []
    page = 1

    while True:
        params = {
            'keyword': keyword,
            'pageSize': PAGE_SIZE,
            'page': page,
            'agency_state': 'VIC',
        }
        try:
            resp = requests.get(
                AUSTENDER_URL,
                params=params,
                timeout=30,
                headers={'Accept': 'application/json', 'User-Agent': 'VicBIP/1.0'},
            )
            if resp.status_code == 404 or resp.status_code == 400:
                log.warning(f'AusTender returned {resp.status_code} for keyword="{keyword}" — endpoint may have changed')
                break
            resp.raise_for_status()
        except requests.RequestException as e:
            log.error(f'AusTender request failed (keyword="{keyword}", page={page}): {e}')
            break

        try:
            data = resp.json()
        except Exception:
            log.warning(f'AusTender non-JSON response for keyword="{keyword}"')
            break

        # Handle multiple possible response shapes
        items = (
            data.get('results') or
            data.get('data') or
            data.get('contractNotices') or
            (data if isinstance(data, list) else [])
        )

        if not items:
            log.info(f'AusTender: no more results for keyword="{keyword}" at page {page}')
            break

        log.info(f'AusTender keyword="{keyword}" page={page}: {len(items)} contracts')
        contracts.extend(items)

        # Pagination
        total_pages = data.get('totalPages') or data.get('pages') or 1
        if page >= total_pages or len(items) < PAGE_SIZE:
            break
        page += 1
        time.sleep(REQUEST_DELAY_S)

    return contracts


def extract_tender(contract: dict) -> Optional[dict]:
    """Normalise a raw AusTender contract dict into our schema."""
    # Try multiple field name variants across API versions
    title = (
        contract.get('description') or
        contract.get('title') or
        contract.get('contractDescription') or
        ''
    ).strip()

    if not title:
        return None

    url = (
        contract.get('url') or
        contract.get('link') or
        contract.get('contractUrl') or
        contract.get('atm_id') or
        ''
    )
    if not url:
        # Construct URL from contract ID if available
        cn_id = contract.get('cn_id') or contract.get('id') or contract.get('contractNoticeId')
        if cn_id:
            url = f'https://www.tenders.gov.au/cn/show/{cn_id}'
        else:
            return None  # no URL = can't deduplicate

    if not url.startswith('http'):
        url = f'https://www.tenders.gov.au{url}'

    agency = (
        contract.get('agency') or
        contract.get('agencyName') or
        contract.get('publishingAgency') or
        None
    )
    if isinstance(agency, dict):
        agency = agency.get('name') or agency.get('agencyName')

    raw_date = (
        contract.get('publishDate') or
        contract.get('published_date') or
        contract.get('contractStart') or
        contract.get('datePublished') or
        None
    )
    published_date = parse_date(str(raw_date) if raw_date else None)

    raw_value = (
        contract.get('value') or
        contract.get('contractValue') or
        contract.get('estimatedValue') or
        None
    )
    value_aud = parse_value_aud(raw_value)

    status = (
        contract.get('status') or
        contract.get('contractStatus') or
        'awarded'  # AusTender contract notices are awarded contracts
    )

    summary = (contract.get('summary') or contract.get('description') or '')[:500]

    return {
        'title': title,
        'url': url,
        'agency': str(agency) if agency else None,
        'published_date': published_date,
        'status': str(status) if status else None,
        'value_aud': value_aud,
        'summary': summary,
    }


def upsert_tender(conn, tender: dict) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO bridge_tenders (
                bridge_id, title, published_date, agency, status,
                value_aud, source, url, summary
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (url) DO UPDATE SET
                title          = EXCLUDED.title,
                bridge_id      = COALESCE(EXCLUDED.bridge_id, bridge_tenders.bridge_id),
                published_date = EXCLUDED.published_date,
                agency         = EXCLUDED.agency,
                status         = EXCLUDED.status,
                value_aud      = EXCLUDED.value_aud,
                summary        = EXCLUDED.summary
            RETURNING (xmax = 0) AS is_insert
            """,
            (
                tender.get('bridge_id'),
                tender['title'],
                tender.get('published_date'),
                tender.get('agency'),
                tender.get('status'),
                tender.get('value_aud'),
                'tenders.gov.au',
                tender['url'],
                tender.get('summary'),
            ),
        )
        row = cur.fetchone()
    conn.commit()
    return 'inserted' if (row and row[0]) else 'updated'


def main() -> None:
    log.info('Starting AusTender scrape')
    conn = connect_db()
    bridges = load_bridges(conn)
    log.info(f'Loaded {len(bridges)} bridges for fuzzy matching')

    inserted = 0
    updated = 0
    skipped = 0
    total = 0
    seen_urls: set = set()

    for keyword in SEARCH_KEYWORDS:
        contracts = fetch_contracts(keyword)
        log.info(f'Keyword "{keyword}": {len(contracts)} contracts fetched')

        for contract in contracts:
            tender = extract_tender(contract)
            if not tender:
                skipped += 1
                continue

            url = tender['url']
            if url in seen_urls:
                skipped += 1
                continue
            seen_urls.add(url)
            total += 1

            tender['bridge_id'] = fuzzy_match_bridge(tender['title'], bridges)
            if tender['bridge_id']:
                log.debug(f'Matched "{tender["title"]}" to bridge {tender["bridge_id"]}')

            try:
                result = upsert_tender(conn, tender)
                if result == 'inserted':
                    inserted += 1
                else:
                    updated += 1
            except Exception as e:
                log.warning(f'DB error for tender "{tender["title"]}": {e}')
                conn.rollback()
                skipped += 1

        time.sleep(REQUEST_DELAY_S)

    conn.close()
    log.info(
        f'AusTender scrape complete — '
        f'inserted: {inserted}, updated: {updated}, skipped: {skipped}, total: {total}'
    )


if __name__ == '__main__':
    main()
