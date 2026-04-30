# VicBIP — Victoria Bridge Intelligence Platform

VicBIP is an internal Freyssinet Australia tool for the Business Development team that displays Victorian bridges colour-coded by structural risk on an interactive map, with a rich intelligence panel showing traffic data, events, tenders, and matched Freyssinet services. Risk scores are indicative only and do not constitute a structural engineering assessment.

## Prerequisites

- [Node.js 20](https://nodejs.org/)
- [pnpm 8+](https://pnpm.io/installation)
- [Python 3.11+](https://www.python.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Quickstart

```bash
git clone <repo-url>
cd vicbip
cp .env.example .env   # fill in MAPBOX_TOKEN at minimum
docker-compose up -d postgres
pnpm install
cd packages/backend && pnpm run migrate
cd ../pipeline && pip install -r requirements.txt
python ingest/vicroads_bridges.py
python ingest/osm_bridges.py
python ingest/freyssinet_projects.py
python score.py
cd ../.. && pnpm run dev:all
# Open http://localhost:5173
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgres://vicbip:vicbip@localhost:5432/vicbip` |
| `MAPBOX_TOKEN` / `VITE_MAPBOX_TOKEN` | Yes | Mapbox GL JS access token — get from [account.mapbox.com](https://account.mapbox.com). Free tier is sufficient. |
| `GOOGLE_SEARCH_API_KEY` | Optional | Google Cloud Custom Search API key — for bridge intelligence search (Phase 2) |
| `GOOGLE_SEARCH_CX` | Optional | Custom Search Engine ID from [cse.google.com](https://cse.google.com) |
| `STREET_VIEW_API_KEY` | Optional | Google Street View Static API key — same GCP project as above |
| `VICROADS_API_TOKEN` | Optional | VicRoads API token — email traffic_requests@vicroads.vic.gov.au to request |
| `NEWS_API_KEY` | Optional | [newsapi.org](https://newsapi.org) key for Phase 2 news intelligence |
| `PORT` | No | Backend port (default: `3001`) |
| `NODE_ENV` | No | `development` or `production` |

> **Frontend note:** Vite only exposes env vars prefixed with `VITE_` to the browser. Set `VITE_MAPBOX_TOKEN` in your `.env` file for the map to load.

## Data Sources

- **Department of Transport and Planning (DTP) Victoria — Road Bridges Register** ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/))
  Downloaded from [DTP Open Data portal](https://opendata.transport.vic.gov.au/dataset/05efb8bc-677e-46f1-b1b1-fa5caff65067/)
- **OpenStreetMap** contributors — supplementary bridge data via Overpass API ([ODbL](https://opendatacommons.org/licenses/odbl/))
- **Freyssinet Australia** project references — [freyssinet.com.au](https://www.freyssinet.com.au/)

## API Reference

All endpoints served from `http://localhost:3001`.

### `GET /api/bridges`

Returns a GeoJSON FeatureCollection of bridges matching the provided filters.

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `owner_category` | `string` | Comma-separated: `state_govt,local_govt,rail,toll_road,utility,port,other` |
| `risk_tier` | `string` | Comma-separated: `critical,high,moderate,low` |
| `min_year` | `integer` | Minimum construction year |
| `max_year` | `integer` | Maximum construction year |
| `min_span` | `number` | Minimum span in metres |
| `max_span` | `number` | Maximum span in metres |
| `q` | `string` | Text search on name, road name, and owner name |
| `freyssinet_only` | `boolean` | Show only bridges with `freyssinet_works = true` |
| `exclude_freyssinet` | `boolean` | Exclude bridges where `freyssinet_works = true` |

---

### `GET /api/bridges/stats`

Returns aggregate statistics for the dashboard.

**Response:**
```json
{
  "total": 1234,
  "by_tier": { "critical": 45, "high": 120, "moderate": 300, "low": 769 },
  "by_owner_category": { "state_govt": 400, "local_govt": 600, ... },
  "by_era": { "pre_1960": 100, "x1960_1980": 300, ... },
  "top20": [{ "id": "...", "name": "...", "sri_score": 95.0, "risk_tier": "critical" }]
}
```

---

### `GET /api/bridges/export`

Returns filtered bridges as a CSV download.

**Query parameters:** Same as `GET /api/bridges`, plus `format=csv`.

**CSV columns:** `name, road_name, owner_name, owner_category, construction_year, span_m, sri_score, risk_tier, bridge_type, latitude, longitude, freyssinet_works`

---

### `GET /api/bridges/:id`

Returns full detail for a single bridge including related traffic, events, tenders, intelligence, and computed solution matches.

**Response includes:** all bridge fields + `traffic` (latest year) + `events` (last 5 years) + `tenders` (all) + `intelligence` (last 10) + `solution_match` (array of Freyssinet service recommendations)

---

### `GET /health`

Returns `{ "status": "ok", "timestamp": "..." }` — used for container health checks.

## Data Pipeline

```bash
cd packages/pipeline

# 1. Ingest DTP road bridges register (>500 bridges, filters span >= 20m)
python ingest/vicroads_bridges.py

# 2. Supplement with OpenStreetMap bridges (adds named Victorian bridges not in DTP register)
python ingest/osm_bridges.py

# 3. Match Freyssinet project references to bridges (sets freyssinet_works=true)
python ingest/freyssinet_projects.py

# 4. Recompute SRI scores using all available data (traffic, events, tenders)
python score.py
```

Unmatched Freyssinet projects are logged to `packages/pipeline/unmatched_projects.csv` for manual review.

## SRI Score Methodology

The Structural Risk Index (SRI) score is computed from up to five factors:

| Factor | Max Points | Description |
|---|---|---|
| Age | 35 | Based on years since construction |
| Design load standard | 20 | Older standards (Pre-T44, T-44) score higher |
| Traffic loading | 25 | Heavy vehicle % and volume |
| Events | 20 | Closures (4 pts each), weight restrictions (6 pts each) |
| Maintenance gap | 10 | Inactivity for 10–15+ years |

**Risk tiers:** Critical ≥ 80 · High ≥ 60 · Moderate ≥ 40 · Low < 40

## Development Scripts

```bash
pnpm run dev:all        # Start backend + frontend concurrently
pnpm run dev:backend    # Backend only (port 3001)
pnpm run dev:frontend   # Frontend only (port 5173)
pnpm run typecheck      # TypeScript check all packages
pnpm run test           # Run Vitest unit tests
```

## Docker (Production)

```bash
docker-compose up --build
# postgres: localhost:5432
# backend:  localhost:3001
# frontend: localhost:5173
```

## Disclaimer

VicBIP is an internal Freyssinet Australia tool. Risk scores are indicative only and do not constitute a structural engineering assessment.
