-- Add unique constraint on bridge_traffic (bridge_id, year) for upserts
ALTER TABLE bridge_traffic
  ADD COLUMN IF NOT EXISTS high_hv_flag BOOLEAN DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bridge_traffic_bridge_id_year_key'
  ) THEN
    ALTER TABLE bridge_traffic
      ADD CONSTRAINT bridge_traffic_bridge_id_year_key UNIQUE (bridge_id, year);
  END IF;
END $$;

-- Bridge crash summary table
CREATE TABLE IF NOT EXISTS bridge_crash_summary (
  bridge_id               UUID PRIMARY KEY REFERENCES bridges(id) ON DELETE CASCADE,
  total_crashes           INT DEFAULT 0,
  fatal_crashes           INT DEFAULT 0,
  serious_crashes         INT DEFAULT 0,
  heavy_vehicle_crashes   INT DEFAULT 0,
  bridge_adjacent_crashes INT DEFAULT 0,
  on_bridge_crashes       INT DEFAULT 0,
  date_range_start        DATE,
  date_range_end          DATE,
  crash_risk_score        FLOAT DEFAULT 0
);
