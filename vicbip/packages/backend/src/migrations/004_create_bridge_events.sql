CREATE TABLE IF NOT EXISTS bridge_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id   UUID REFERENCES bridges(id) ON DELETE CASCADE,
  event_type  TEXT CHECK (event_type IN
    ('closure','weight_restriction','crash','overweight_incident')),
  event_date  DATE,
  severity    TEXT,
  source_url  TEXT,
  notes       TEXT
);
