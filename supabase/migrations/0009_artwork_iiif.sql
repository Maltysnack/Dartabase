-- IIIF deep-zoom support (#37).
--
-- IIIF (International Image Interoperability Framework) is the de facto
-- standard for deep-zoom image delivery used by every major museum API. The
-- column stores the IIIF Image API base URL per artwork; OpenSeadragon (the
-- client-side viewer) accepts either the base URL or the full info.json URL
-- as a tile source.
--
-- v1 backfill covers AIC, the largest single source whose image_url already
-- encodes the IIIF image_id in a stable pattern
-- (https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg). Other
-- IIIF-publishing sources (Harvard, NGA, Cleveland, Smithsonian, Met,
-- Rijksmuseum when ingested) are deferred to follow-up backfills.

alter table artworks add column if not exists iiif_manifest_url text;

-- Partial index: we only ever query "give me the IIIF URL for this artwork",
-- and most rows are null. A partial index keeps the index small.
create index if not exists artworks_iiif_idx
  on artworks(id)
  where iiif_manifest_url is not null;

-- One-time backfill for AIC. The substring captures the {image_id} segment
-- between `/iiif/2/` and the next `/`; rows whose image_url is null or
-- doesn't match the pattern are left untouched.
update artworks
set iiif_manifest_url = 'https://www.artic.edu/iiif/2/' ||
  substring(image_url from 'iiif/2/([^/]+)/')
where source = 'aic'
  and image_url ~ '^https://www\.artic\.edu/iiif/2/[^/]+/'
  and iiif_manifest_url is null;
