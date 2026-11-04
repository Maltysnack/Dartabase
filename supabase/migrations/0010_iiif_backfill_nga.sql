-- IIIF backfill for NGA Washington (#37 expansion).
--
-- NGA's existing image_url already encodes the IIIF Image API path
--   https://api.nga.gov/iiif/{uuid}/full/!800,800/0/default.jpg
-- so the IIIF base for OpenSeadragon is simply
--   https://api.nga.gov/iiif/{uuid}
-- derivable with a single regex substring, same shape as the AIC backfill
-- in migration 0009.
--
-- Other IIIF-publishing sources (Harvard, Met, Cleveland, Smithsonian) are
-- not backfillable from existing image_url:
--   Harvard ships nrs.harvard.edu/urn-... NRS-resolver URLs that don't
--     expose the IIIF id;
--   Met ships images.metmuseum.org/CRDImages plain-jpg URLs;
--   Cleveland ships openaccess-cdn.clevelandart.org plain-jpg URLs;
--   Smithsonian ships ids.si.edu/ids/deliveryService URLs (old delivery
--     service, not IIIF).
-- Each of those will need a separate per-record API call to fetch the
-- manifest URL; tracked as a follow-up issue rather than this migration.

update artworks
set iiif_manifest_url = 'https://api.nga.gov/iiif/' ||
  substring(image_url from 'iiif/([^/]+)/')
where source = 'nga'
  and image_url ~ '^https://api\.nga\.gov/iiif/[^/]+/'
  and iiif_manifest_url is null;
