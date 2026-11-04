-- Founded year on institutions (issue #21 follow-up).
--
-- Drives the synthesized one-line institution bio rendered on the institution
-- page, e.g. "Public art museum in Hobart, Australia. Opened 2011." Null until
-- backfilled per institution; see scripts/backfill-institution-founded-year.ts
-- for the Wikidata-based backfill that runs against any institution with a
-- wikidata_id.

alter table institutions
  add column if not exists founded_year integer;
