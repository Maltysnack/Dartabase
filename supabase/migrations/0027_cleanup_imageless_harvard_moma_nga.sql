-- Remove imageless records from Harvard, MoMA, and NGA so the next ingestion
-- run (with the image-first policy) starts from a clean slate. These records
-- have image_url IS NULL but a known source, meaning the institution either
-- does not permit display or the source CSV had no thumbnail for that row.
--
-- Cascades clean up exhibition_artworks links automatically via FK ON DELETE.
-- Run `pnpm ingest:harvard`, `pnpm ingest:moma`, and `pnpm ingest:nga` after
-- applying this migration to re-populate with imaged records only.

delete from artworks
where source in ('harvard', 'moma', 'nga')
  and image_url is null;
