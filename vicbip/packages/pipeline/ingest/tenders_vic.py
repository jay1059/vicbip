#!/usr/bin/env python3
"""
Scrape tender notices from tenders.vic.gov.au for bridge-related contracts.
Uses Playwright for JavaScript-rendered search results.
Fuzzy-matches tender titles against bridge names and upserts into bridge_tenders.
"""

import os
import sys
import logging
import re
from datetime import datetime
from typing import Optional

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


def parse_value_aud(text: str) -> Optional[int]:
    if not text:
        return None
    text = text.replace(',', '').replace('$', '').strip()
    m = re.search(r'[\d.]+', text)
    if not m:
        return None
    try:
        val = float(m.group())
        if 'million' in text.lower() or 'm' in text.lower():
            val *= 1_000_000
        elif 'thousand' in text.lower() or 'k' in text.lower():
            val *= 1_000
        return int(val)
    except Exception:
        return None


def parse_date(text: str) -> Optional[str]:
    if not text:
        return None
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d %b %Y', '%d %B %Y'):
        try:
            return datetime.strptime(text.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


def upsert_tender(conn, tender: dict) -> str:
    """Returns 'inserted', 'updated', or 'skipped'."""
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
    if row and row[0]:
        return 'inserted'
    return 'updated'


def scrape_with_playwright(keyword: str) -> list:
    """Scrape tenders.vic.gov.au for a given keyword. Returns list of tender dicts."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        log.error('playwright not installed — run: pip install playwright && playwright install chromium')
        return []

    tenders = []
    search_url = f'{BASE_URL}/tender/search?q={keyword.replace(" ", "+")}'
    log.info(f'Scraping: {search_url}')

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            page = browser.new_page()
            page.set_default_timeout(30_000)

            page.goto(search_url, wait_until='networkidle')

            # Tenders VIC uses server-side rendering — wait for result list
            try:
                page.wait_for_selector('[data-testid="tender-list-item"], .tender-result, .search-result', timeout=15_000)
            except PWTimeout:
                log.warning(f'No results selector found for keyword "{keyword}" — page may have changed structure')

            # Try multiple result card selectors
            cards = (
                page.query_selector_all('[data-testid="tender-list-item"]') or
                page.query_selector_all('.tender-result') or
                page.query_selector_all('article.search-result') or
                page.query_selector_all('.search-results li')
            )

            log.info(f'Found {len(cards)} result cards for keyword "{keyword}"')

            for card in cards:
                try:
                    title_el = card.query_selector('h2 a, h3 a, .tender-title a, a[href*="/tender/"]')
                    if not title_el:
                        continue
                    title = title_el.inner_text().strip()
                    href = title_el.get_attribute('href') or ''
                    url = href if href.startswith('http') else BASE_URL + href

                    agency_el = card.query_selector('.agency, .organisation, [data-label="Agency"]')
                    agency = agency_el.inner_text().strip() if agency_el else None

                    date_el = card.query_selector('.date, .published-date, [data-label="Published"]')
                    raw_date = date_el.inner_text().strip() if date_el else None

                    status_el = card.query_selector('.status, .tender-status, [data-label="Status"]')
                    status = status_el.inner_text().strip() if status_el else None

                    value_el = card.query_selector('.value, .estimated-value, [data-label="Value"]')
                    raw_value = value_el.inner_text().strip() if value_el else None

                    summary_el = card.query_selector('.summary, .description, p')
                    summary = summary_el.inner_text().strip()[:500] if summary_el else None

                    tenders.append({
                        'title': title,
                        'url': url,
                        'agency': agency,
                        'published_date': parse_date(raw_date),
                        'status': status,
                        'value_aud': parse_value_aud(raw_value or ''),
                        'summary': summary,
                    })
                except Exception as e:
                    log.warning(f'Error parsing card: {e}')
                    continue

            browser.close()

    except Exception as e:
        log.error(f'Playwright error for keyword "{keyword}": {e}')

    return tenders


def main() -> None:
    log.info('Starting tenders.vic.gov.au scrape')
    conn = connect_db()
    bridges = load_bridges(conn)
    log.info(f'Loaded {len(bridges)} bridges for fuzzy matching')

    inserted = 0
    updated = 0
    skipped = 0
    total = 0
    seen_urls: set = set()

    for keyword in SEARCH_KEYWORDS:
        tenders = scrape_with_playwright(keyword)
        log.info(f'Keyword "{keyword}": {len(tenders)} tenders found')

        for tender in tenders:
            url = tender.get('url', '')
            if not url or url in seen_urls:
                skipped += 1
                continue
            seen_urls.add(url)
            total += 1

            # Fuzzy match to bridge
            tender['bridge_id'] = fuzzy_match_bridge(tender['title'], bridges)
            if tender['bridge_id']:
                log.debug(f'Matched tender "{tender["title"]}" to bridge {tender["bridge_id"]}')

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

    conn.close()
    log.info(
        f'tenders.vic.gov.au scrape complete — '
        f'inserted: {inserted}, updated: {updated}, skipped: {skipped}, total: {total}'
    )


if __name__ == '__main__':
    main()
