-- Backfill iiif_manifest_url for Smithsonian artworks.
-- All 800 records use https://ids.si.edu/ids/deliveryService?id={item_id};
-- the IIIF image service is at https://ids.si.edu/ids/iiif/{item_id}.
-- Applied 2026-05-25 via execute_sql; this file records the change.

UPDATE artworks
SET iiif_manifest_url = 'https://ids.si.edu/ids/iiif/' || split_part(image_url, 'id=', 2)
WHERE source = 'smithsonian'
  AND image_url LIKE '%deliveryService?id=%'
  AND iiif_manifest_url IS NULL;
