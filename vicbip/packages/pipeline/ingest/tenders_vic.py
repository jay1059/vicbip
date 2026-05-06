#!/usr/bin/env python3
"""
Scrape tender notices from tenders.vic.gov.au for bridge-related contracts.
Uses requests + BeautifulSoup only (no headless browser required).
Fuzzy-matches tender titles against bridge names and upserts into bridge_tenders.
"""

import os
import sys
import logging
import re
import time
from datetime import datetime
from typing import Optional

import requests
from bs4 import BeautifulSoup
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

SEARCH_KEYWORDS = [
    'bridge', 'viaduct', 'strengthening',
    'post-tension', 'CFRP', 'rehabilitation', 'overpass',
]

BASE_URL = 'https://www.tenders.vic.gov.au'
FUZZY_THRESHOLD = 70
REQUEST_DELAY_S = 1.0
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; VicBIP/1.0; +https://vicbip-production.up.railway.app)',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-AU,en;q=0.9',
}


def connect_db():
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        log.error('DATABASE_URL not set')
        sys.exit(1)
    return psycopg2.connect(db_url)


def load_bridges(conn) -> list:
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


def parse_value_aud(text: str) -> Optional[int]:
    if not text:
        return None
    text = text.replace(',', '').replace('$', '').strip()
    m = re.search(r'[\d.]+', text)
    if not m:
        return None
    try:
        val = float(m.group())
        if 'million' in text.lower() or text.lower().endswith('m'):
            val *= 1_000_000
        elif 'thousand' in text.lower() or text.lower().endswith('k'):
            val *= 1_000
        return int(val)
    except Exception:
        return None


def parse_date(text: str) -> Optional[str]:
    if not text:
        return None
    text = text.strip()
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d %b %Y', '%d %B %Y', '%B %d, %Y'):
        try:
            return datetime.strptime(text, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


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
                'tenders.vic.gov.au',
                tender['url'],
                tender.get('summary'),
            ),
        )
        row = cur.fetchone()
    conn.commit()
    return 'inserted' if (row and row[0]) else 'updated'


def scrape_keyword(keyword: str) -> list:
    """
    Fetch tenders.vic.gov.au search results for a keyword using requests + BeautifulSoup.
    The site uses server-side rendering for the initial results page, making
    a headless browser unnecessary.
    """
    search_url = f'{BASE_URL}/tender/search'
    params = {'keyword': keyword, 'type': 'open'}
    log.info(f'Fetching: {search_url}?keyword={keyword}')

    try:
        resp = requests.get(search_url, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        log.warning(f'Request failed for keyword "{keyword}": {e}')
        return []

    soup = BeautifulSoup(resp.text, 'lxml')
    tenders = []

    # Try multiple result-list selectors to handle site structure changes
    result_containers = (
        soup.select('[data-testid="tender-list-item"]') or
        soup.select('.tender-result') or
        soup.select('article.search-result') or
        soup.select('.search-results li') or
        soup.select('ul.results li') or
        # Generic fallback: any link to /tender/ that has descriptive text
        []
    )

    if not result_containers:
        # Broad fallback: collect all links that look like individual tender pages
        for a in soup.find_all('a', href=True):
            href = a['href']
            if '/tender/' in href and len(a.get_text(strip=True)) > 15:
                full_url = href if href.startswith('http') else BASE_URL + href
                title = a.get_text(strip=True)
                tenders.append({
                    'title': title,
                    'url': full_url,
                    'agency': None,
                    'published_date': None,
                    'status': 'open',
                    'value_aud': None,
                    'summary': None,
                })
        log.info(f'Keyword "{keyword}": {len(tenders)} results via fallback link scan')
        return tenders

    log.info(f'Keyword "{keyword}": {len(result_containers)} result containers found')

    for container in result_containers:
        try:
            # Title + URL
            title_el = (
                container.select_one('h2 a, h3 a, .tender-title a') or
                container.select_one('a[href*="/tender/"]')
            )
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            href = title_el.get('href', '')
            url = href if href.startswith('http') else BASE_URL + href

            # Agency
            agency_el = container.select_one('.agency, .organisation, [class*="agency"]')
            agency = agency_el.get_text(strip=True) if agency_el else None

            # Published date
            date_el = container.select_one('.date, .published-date, time, [class*="date"]')
            raw_date = (
                date_el.get('datetime') or date_el.get_text(strip=True)
                if date_el else None
            )

            # Status
            status_el = container.select_one('.status, .tender-status, [class*="status"]')
            status = status_el.get_text(strip=True) if status_el else 'open'

            # Value
            value_el = container.select_one('.value, .estimated-value, [class*="value"]')
            raw_value = value_el.get_text(strip=True) if value_el else None

            # Summary
            summary_el = container.select_one('.summary, .description, p')
            summary = summary_el.get_text(strip=True)[:500] if summary_el else None

            tenders.append({
                'title': title,
                'url': url,
                'agency': agency,
                'published_date': parse_date(raw_date or ''),
                'status': status,
                'value_aud': parse_value_aud(raw_value or ''),
                'summary': summary,
            })
        except Exception as e:
            log.warning(f'Error parsing result container: {e}')
            continue

    return tenders


def main() -> None:
    log.info('Starting tenders.vic.gov.au scrape (requests + BeautifulSoup)')
    conn = connect_db()
    bridges = load_bridges(conn)
    log.info(f'Loaded {len(bridges)} bridges for fuzzy matching')

    inserted = 0
    updated = 0
    skipped = 0
    total = 0
    seen_urls: set = set()

    for keyword in SEARCH_KEYWORDS:
        tenders = scrape_keyword(keyword)
        log.info(f'Keyword "{keyword}": {len(tenders)} tenders found')

        for tender in tenders:
            url = tender.get('url', '')
            if not url or url in seen_urls:
                skipped += 1
                continue
            seen_urls.add(url)
            total += 1

            tender['bridge_id'] = fuzzy_match_bridge(tender['title'], bridges)
            if tender['bridge_id']:
                log.debug(f'Matched "{tender["title"]}" → bridge {tender["bridge_id"]}')

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
        f'tenders.vic.gov.au scrape complete — '
        f'inserted: {inserted}, updated: {updated}, skipped: {skipped}, total: {total}'
    )


if __name__ == '__main__':
    main()
