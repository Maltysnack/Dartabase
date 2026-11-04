-- Add external link columns to artists for website, Wikipedia, and gallery URLs.
-- Populated by enrich-wikidata.ts (P856 official website, enwiki sitelink, P276 gallery).
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS wikipedia_url TEXT,
  ADD COLUMN IF NOT EXISTS gallery_url TEXT;
