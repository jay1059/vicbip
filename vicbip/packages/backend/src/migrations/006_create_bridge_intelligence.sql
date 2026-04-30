CREATE TABLE IF NOT EXISTS bridge_intelligence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id     UUID REFERENCES bridges(id) ON DELETE CASCADE,
  source_type   TEXT,
  headline      TEXT,
  snippet       TEXT,
  url           TEXT UNIQUE,
  published_date DATE,
  collected_at  TIMESTAMPTZ DEFAULT NOW()
);
