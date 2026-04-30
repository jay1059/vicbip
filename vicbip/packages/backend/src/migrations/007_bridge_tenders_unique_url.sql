-- Add unique constraint on bridge_tenders.url to support ON CONFLICT upserts
-- Also add agency and status columns used by the tender scraper pipeline
ALTER TABLE bridge_tenders
  ADD COLUMN IF NOT EXISTS agency TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bridge_tenders_url_idx
  ON bridge_tenders (url)
  WHERE url IS NOT NULL;
