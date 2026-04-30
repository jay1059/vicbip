CREATE TABLE IF NOT EXISTS bridge_traffic (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id   UUID REFERENCES bridges(id) ON DELETE CASCADE,
  year        INT,
  aadt_total  INT,
  heavy_pct   FLOAT,
  station_id  TEXT,
  station_dist_m FLOAT
);
