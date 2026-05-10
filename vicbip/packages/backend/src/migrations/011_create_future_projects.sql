-- Future infrastructure project corridors and bridge conflict detection
-- Supports proximity analysis for Victorian mega-projects.

CREATE TABLE IF NOT EXISTS future_projects (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name            TEXT NOT NULL UNIQUE,
  project_code            TEXT,
  category                TEXT,  -- 'rail','tram','road','airport'
  status                  TEXT,  -- 'under_construction','planned','approved','proposed'
  description             TEXT,
  freyssinet_opportunity  TEXT,
  budget_aud              BIGINT,
  completion_year         INT,
  source_url              TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS future_project_corridors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES future_projects(id) ON DELETE CASCADE,
  segment_name TEXT,
  -- [[lat,lng], [lat,lng], ...] — WGS84 decimal degrees
  waypoints    JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS future_project_bridge_conflicts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES future_projects(id) ON DELETE CASCADE,
  bridge_id     UUID REFERENCES bridges(id) ON DELETE CASCADE,
  corridor_id   UUID REFERENCES future_project_corridors(id) ON DELETE CASCADE,
  distance_m    NUMERIC,
  conflict_type TEXT,  -- 'crossing','adjacent','within_500m'
  opportunity   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, bridge_id)
);

CREATE INDEX IF NOT EXISTS fpbc_bridge_idx   ON future_project_bridge_conflicts (bridge_id);
CREATE INDEX IF NOT EXISTS fpbc_project_idx  ON future_project_bridge_conflicts (project_id);
CREATE INDEX IF NOT EXISTS fpc_project_idx   ON future_project_corridors (project_id);

ALTER TABLE bridges
  ADD COLUMN IF NOT EXISTS future_project_conflict BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS bridges_future_idx
  ON bridges (future_project_conflict)
  WHERE future_project_conflict = true;
