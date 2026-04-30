CREATE TABLE IF NOT EXISTS bridges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id        TEXT UNIQUE,
  name             TEXT NOT NULL,
  road_name        TEXT,
  bridge_type      TEXT,
  construction_year INT,
  span_m           FLOAT,
  feature_crossed  TEXT,
  owner_name       TEXT,
  owner_category   TEXT CHECK (owner_category IN
    ('state_govt','local_govt','rail','toll_road','utility','port','other')),
  latitude         FLOAT NOT NULL,
  longitude        FLOAT NOT NULL,
  design_load_std  TEXT,
  sri_score        FLOAT DEFAULT 30,
  risk_tier        TEXT CHECK (risk_tier IN ('critical','high','moderate','low')),
  freyssinet_works BOOLEAN DEFAULT false,
  street_view_url  TEXT,
  data_sources     TEXT[],
  notes            TEXT,
  last_ingested    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bridges_latlng_idx ON bridges (latitude, longitude);
CREATE INDEX IF NOT EXISTS bridges_risk_idx ON bridges (risk_tier, sri_score DESC);
CREATE INDEX IF NOT EXISTS bridges_owner_idx ON bridges (owner_category);
