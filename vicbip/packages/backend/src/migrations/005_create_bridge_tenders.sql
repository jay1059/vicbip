CREATE TABLE IF NOT EXISTS bridge_tenders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id     UUID REFERENCES bridges(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  published_date DATE,
  contractor    TEXT,
  value_aud     BIGINT,
  source        TEXT,
  url           TEXT,
  summary       TEXT
);
