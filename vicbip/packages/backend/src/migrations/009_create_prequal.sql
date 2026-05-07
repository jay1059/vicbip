-- Prequalification intelligence tables
-- prequal_companies: DTP-registered companies with bridge/financial capacity levels
-- bridge_prequal_matches: pre-computed eligibility join for fast panel queries

CREATE TABLE IF NOT EXISTS prequal_companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    TEXT NOT NULL UNIQUE,
  bridge_level    TEXT,             -- B1, B2, B3, B4
  financial_level TEXT,             -- F5, F10, F25, F50, F75, F100, F150, UNLIMITED
  financial_value INT,              -- numeric millions (NULL = UNLIMITED)
  has_design      BOOLEAN DEFAULT false,
  company_type    TEXT              -- contractor, consultant, both
);

CREATE TABLE IF NOT EXISTS bridge_prequal_matches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id   UUID REFERENCES bridges(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES prequal_companies(id) ON DELETE CASCADE,
  match_type  TEXT DEFAULT 'eligible',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bridge_id, company_id)
);

CREATE INDEX IF NOT EXISTS bridge_prequal_bridge_idx ON bridge_prequal_matches (bridge_id);
CREATE INDEX IF NOT EXISTS bridge_prequal_company_idx ON bridge_prequal_matches (company_id);
