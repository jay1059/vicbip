#!/usr/bin/env python3
"""
Recompute SRI (Structural Risk Index) scores for all bridges using all available data.
Incorporates: age, design standard, traffic loading, crash data, events, maintenance gap.
Updates sri_score and risk_tier for all bridges in the database.
"""

import os
import sys
import logging
from datetime import datetime

import psycopg2
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

CURRENT_YEAR = 2025


def compute_age_pts(year) -> float:
    if year is None:
        return 20.0
    return min(35.0, max(0.0, (CURRENT_YEAR - int(year)) / 80 * 35))


def compute_std_pts(year) -> float:
    """Design load standard points based on construction era."""
    if year is None:
        return 10.0
    y = int(year)
    if y < 1960:
        return 20.0
    if y < 1975:
        return 15.0
    if y < 1992:
        return 10.0
    if y < 2004:
        return 5.0
    return 0.0


def compute_traffic_pts(heavy_pct, year) -> float:
    """
    Traffic loading factor (25 pts max).
    Updated thresholds incorporating heavy vehicle % + bridge age.
    """
    if heavy_pct is None:
        return 10.0  # unknown default
    hp = float(heavy_pct)
    yr = int(year) if year is not None else 2000

    if hp > 20 and yr < 1992:
        return 25.0
    if hp > 15 and yr < 1992:
        return 22.0
    if hp > 10:
        return 16.0
    if hp > 5:
        return 10.0
    return 5.0  # low but known heavy vehicle presence


def compute_crash_pts(crash_risk_score) -> float:
    """
    Crash factor (10 pts max) from bridge_crash_summary.crash_risk_score.
    If no crash data: 3 pts default (small non-zero default).
    """
    if crash_risk_score is None:
        return 3.0
    return min(10.0, float(crash_risk_score))


def compute_events_pts(closures: int, weight_restrictions: int, on_bridge_crashes: int) -> float:
    """
    Events factor (20 pts max) — includes disruption data and on-bridge crashes.
    """
    pts = (weight_restrictions * 6) + (closures * 4) + (on_bridge_crashes * 3)
    return min(20.0, float(pts))


def compute_maintenance_pts(last_activity_year) -> float:
    if last_activity_year is None:
        return 10.0
    gap = CURRENT_YEAR - int(last_activity_year)
    if gap >= 15:
        return 10.0
    if gap >= 10:
        return 5.0
    return 0.0


def compute_risk_tier(sri_score: float) -> str:
    if sri_score >= 80:
        return 'critical'
    if sri_score >= 60:
        return 'high'
    if sri_score >= 40:
        return 'moderate'
    return 'low'


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

    log.info('Loading bridges for score computation…')
    with conn.cursor() as cur:
        cur.execute('SELECT id, construction_year, sri_score, risk_tier FROM bridges')
        bridges = cur.fetchall()

    log.info(f'Scoring {len(bridges)} bridges')

    updated = 0
    unchanged = 0
    errors = 0

    for idx, (bridge_id, construction_year, old_score, old_tier) in enumerate(bridges):
        if idx > 0 and idx % 1000 == 0:
            log.info(f'Progress: {idx}/{len(bridges)} bridges scored')

        try:
            with conn.cursor() as cur:
                # Latest traffic data
                cur.execute(
                    """
                    SELECT heavy_pct, high_hv_flag FROM bridge_traffic
                    WHERE bridge_id = %s
                    ORDER BY year DESC NULLS LAST LIMIT 1
                    """,
                    (bridge_id,),
                )
                traffic_row = cur.fetchone()
                heavy_pct = traffic_row[0] if traffic_row else None

                # Crash summary
                cur.execute(
                    'SELECT crash_risk_score, on_bridge_crashes FROM bridge_crash_summary WHERE bridge_id = %s',
                    (bridge_id,),
                )
                crash_row = cur.fetchone()
                crash_risk_score = crash_row[0] if crash_row else None
                on_bridge_crashes = int(crash_row[1]) if crash_row else 0

                # Events (including disruption-sourced events)
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE event_type = 'closure') AS closures,
                        COUNT(*) FILTER (WHERE event_type = 'weight_restriction') AS weight_restrictions
                    FROM bridge_events WHERE bridge_id = %s
                    """,
                    (bridge_id,),
                )
                events_row = cur.fetchone()
                closures = int(events_row[0]) if events_row else 0
                weight_restrictions = int(events_row[1]) if events_row else 0

                # Last maintenance activity
                cur.execute(
                    """
                    SELECT MAX(EXTRACT(YEAR FROM published_date)::int)
                    FROM bridge_tenders
                    WHERE bridge_id = %s AND published_date IS NOT NULL
                    UNION
                    SELECT MAX(EXTRACT(YEAR FROM collected_at)::int)
                    FROM bridge_intelligence
                    WHERE bridge_id = %s AND collected_at IS NOT NULL
                    """,
                    (bridge_id, bridge_id),
                )
                maint_rows = [r[0] for r in cur.fetchall() if r[0] is not None]
                last_activity_year = max(maint_rows) if maint_rows else None

            age_pts = compute_age_pts(construction_year)
            std_pts = compute_std_pts(construction_year)
            traffic_pts = compute_traffic_pts(heavy_pct, construction_year)
            crash_pts = compute_crash_pts(crash_risk_score)
            events_pts = compute_events_pts(closures, weight_restrictions, on_bridge_crashes)
            maintenance_pts = compute_maintenance_pts(last_activity_year)

            new_score = min(100.0, age_pts + std_pts + traffic_pts + crash_pts + events_pts + maintenance_pts)
            new_tier = compute_risk_tier(new_score)

            if abs(new_score - (old_score or 0)) > 0.01 or new_tier != old_tier:
                with conn.cursor() as cur:
                    cur.execute(
                        'UPDATE bridges SET sri_score = %s, risk_tier = %s WHERE id = %s',
                        (new_score, new_tier, bridge_id),
                    )
                conn.commit()
                updated += 1
            else:
                unchanged += 1

        except Exception as e:
            log.error(f'Error scoring bridge {bridge_id}: {e}')
            conn.rollback()
            errors += 1

    conn.close()
    log.info(f'Scoring complete — updated: {updated}, unchanged: {unchanged}, errors: {errors}')


if __name__ == '__main__':
    main()
