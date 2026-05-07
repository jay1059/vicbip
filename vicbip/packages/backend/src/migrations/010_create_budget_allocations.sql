-- Budget allocation tracking: confirmed government infrastructure funding
-- that names specific bridges or corridors.

CREATE TABLE IF NOT EXISTS budget_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id       UUID REFERENCES bridges(id) ON DELETE SET NULL,
  program_name    TEXT NOT NULL,
  funding_tier    TEXT,
  funding_body    TEXT,
  amount_aud      BIGINT,
  financial_year  TEXT,
  structure_named TEXT,
  status          TEXT DEFAULT 'confirmed',
  source_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint enables ON CONFLICT DO NOTHING for idempotent seeding
CREATE UNIQUE INDEX IF NOT EXISTS budget_alloc_unique_idx
  ON budget_allocations (program_name, COALESCE(structure_named,''), COALESCE(financial_year,''));

-- Flag on the bridge row for fast GeoJSON / filter queries
ALTER TABLE bridges
  ADD COLUMN IF NOT EXISTS has_budget_allocation BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS bridges_budget_idx
  ON bridges (has_budget_allocation)
  WHERE has_budget_allocation = true;
