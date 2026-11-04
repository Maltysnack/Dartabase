-- Adds curatorial context fields sourced from museum APIs (e.g. AIC's
-- department_title / classification_title), surfaced on artwork pages (#668).
-- Nullable and backfilled by re-running ingestion; safe additive change.
alter table artworks
  add column if not exists department text,
  add column if not exists classification text;
