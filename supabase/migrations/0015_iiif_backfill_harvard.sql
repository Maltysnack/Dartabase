-- Backfill iiif_manifest_url for Harvard Art Museums artworks.
-- Harvard IIIF manifests are available at a deterministic URL from the object ID
-- (confirmed: https://iiif.harvardartmuseums.org/manifests/object/{source_id} returns
-- a valid sc:Manifest). Only set for records with an image, since imageless records
-- are unlikely to have a usable IIIF manifest.
UPDATE artworks
SET iiif_manifest_url = 'https://iiif.harvardartmuseums.org/manifests/object/' || source_id
WHERE source = 'harvard'
  AND image_url IS NOT NULL
  AND iiif_manifest_url IS NULL;
