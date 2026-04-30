#!/usr/bin/env python3
"""
Scrape Freyssinet Australia project references page and attempt to match
Victorian projects to bridges in the database. Sets freyssinet_works=true on matches.
"""

import os
import sys
import csv
import logging
from datetime import datetime

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

FREYSSINET_URL = 'https://www.freyssinet.com.au/project-references/'
FUZZY_THRESHOLD = 80
UNMATCHED_LOG = os.path.join(os.path.dirname(__file__), '..', 'unmatched_projects.csv')


def scrape_projects() -> list:
    log.info(f'Scraping Freyssinet projects from {FREYSSINET_URL}')
    try:
        resp = requests.get(
            FREYSSINET_URL,
            timeout=30,
            headers={'User-Agent': 'VicBIP/1.0 (Freyssinet Australia internal tool)'},
        )
        resp.raise_for_status()
    except Exception as e:
        log.error(f'Failed to scrape Freyssinet website: {e}')
        return []

    soup = BeautifulSoup(resp.text, 'lxml')
    projects = []

    # Try multiple selector patterns for project cards
    selectors = [
        'article.project',
        '.project-card',
        '.project-reference',
        '.elementor-post',
        'article',
    ]

    cards = []
    for selector in selectors:
        cards = soup.select(selector)
        if cards:
            log.info(f'Found {len(cards)} cards with selector "{selector}"')
            break

    if not cards:
        log.warning('No project cards found — site structure may have changed')
        # Fall back: look for any text blocks with Victoria references
        text = soup.get_text(separator=' ')
        vic_markers = ['victoria', 'melbourne', 'geelong', 'ballarat', 'bendigo']
        if any(m in text.lower() for m in vic_markers):
            log.info('Page mentions Victorian locations — site might be dynamic (JS-rendered)')
        return projects

    for card in cards:
        name_el = card.find(['h1', 'h2', 'h3', 'h4', 'a'])
        name = name_el.get_text(strip=True) if name_el else 'Unknown'

        full_text = card.get_text(separator=' ', strip=True)

        location_el = card.find(class_=lambda c: c and 'location' in c.lower() if c else False)
        location = location_el.get_text(strip=True) if location_el else ''

        year_el = card.find(class_=lambda c: c and 'year' in c.lower() if c else False)
        year_text = year_el.get_text(strip=True) if year_el else ''

        service_el = card.find(class_=lambda c: c and 'service' in c.lower() if c else False)
        service = service_el.get_text(strip=True) if service_el else ''

        projects.append({
            'name': name,
            'location': location,
            'year': year_text,
            'service': service,
            'full_text': full_text,
        })

    log.info(f'Scraped {len(projects)} project references')
    return projects


def is_victorian(project: dict) -> bool:
    text = (
        project.get('location', '') + ' ' + project.get('full_text', '')
    ).lower()
    vic_markers = [
        'victoria', 'melbourne', 'geelong', 'ballarat', 'bendigo',
        'vic,', ' vic ', 'vicroads', 'v/line', 'victrack',
    ]
    return any(m in text for m in vic_markers)


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

    with conn.cursor() as cur:
        cur.execute('SELECT id, name FROM bridges')
        existing_bridges = [(row[0], row[1]) for row in cur.fetchall()]

    log.info(f'Loaded {len(existing_bridges)} bridges for matching')

    projects = scrape_projects()
    vic_projects = [p for p in projects if is_victorian(p)]

    log.info(f'Found {len(vic_projects)} Victorian projects out of {len(projects)} total')

    matched = 0
    unmatched = []

    for project in vic_projects:
        project_name = project['name']
        best_score = 0
        best_match_id = None
        best_match_name = None

        for bridge_id, bridge_name in existing_bridges:
            score = fuzz.ratio(project_name.lower(), bridge_name.lower())
            if score > best_score:
                best_score = score
                best_match_id = bridge_id
                best_match_name = bridge_name

        if best_score >= FUZZY_THRESHOLD and best_match_id:
            log.info(
                f'Matched project "{project_name}" → bridge "{best_match_name}" '
                f'(score={best_score})'
            )
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        'UPDATE bridges SET freyssinet_works = true WHERE id = %s',
                        (best_match_id,),
                    )
                conn.commit()
                matched += 1
            except Exception as e:
                log.error(f'Failed to update bridge {best_match_id}: {e}')
                conn.rollback()
        else:
            log.info(
                f'No match for project "{project_name}" '
                f'(best score={best_score}, closest="{best_match_name}")'
            )
            unmatched.append({
                'project_name': project_name,
                'location': project.get('location', ''),
                'year': project.get('year', ''),
                'service': project.get('service', ''),
                'best_match': best_match_name or '',
                'best_score': best_score,
            })

    conn.close()

    if unmatched:
        with open(UNMATCHED_LOG, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(unmatched[0].keys()))
            writer.writeheader()
            writer.writerows(unmatched)
        log.info(f'Wrote {len(unmatched)} unmatched projects to {UNMATCHED_LOG}')

    log.info(
        f'Freyssinet matching complete — '
        f'Victorian projects: {len(vic_projects)}, matched: {matched}, unmatched: {len(unmatched)}'
    )


if __name__ == '__main__':
    main()
