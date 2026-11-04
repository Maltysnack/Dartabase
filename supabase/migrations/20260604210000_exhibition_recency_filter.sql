-- Add last_exhibition_year to artworks and a recency filter to browse_artwork_ids (#553).
--
-- last_exhibition_year stores the year of the most recent exhibition for each
-- artwork, derived from exhibitions.start_date via exhibition_artworks. NULL
-- means the artwork has no exhibition records. The column is maintained by a
-- trigger on exhibition_artworks so it stays in sync after ingest runs.
--
-- browse_artwork_ids gains p_last_exhibited_before int (default null). When
-- set, results are limited to artworks whose last_exhibition_year is NULL or
-- strictly less than the supplied year. Works with no exhibition records are
-- always included (they have never been recently exhibited).

-- 1. Column + backfill ---------------------------------------------------------

ALTER TABLE public.artworks
  ADD COLUMN IF NOT EXISTS last_exhibition_year int;

UPDATE public.artworks a
SET last_exhibition_year = sub.yr
FROM (
  SELECT ea.artwork_id, MAX(EXTRACT(YEAR FROM e.start_date)::int) AS yr
  FROM exhibition_artworks ea
  JOIN exhibitions e ON e.id = ea.exhibition_id
  WHERE e.start_date IS NOT NULL
  GROUP BY ea.artwork_id
) sub
WHERE a.id = sub.artwork_id;

CREATE INDEX IF NOT EXISTS idx_artworks_last_exhibition_year
  ON public.artworks (last_exhibition_year)
  WHERE last_exhibition_year IS NOT NULL;

-- 2. Maintenance trigger -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_artwork_last_exhibition_year()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artwork_id uuid;
BEGIN
  v_artwork_id := CASE TG_OP WHEN 'DELETE' THEN OLD.artwork_id ELSE NEW.artwork_id END;
  UPDATE public.artworks
  SET last_exhibition_year = (
    SELECT MAX(EXTRACT(YEAR FROM e.start_date)::int)
    FROM exhibition_artworks ea
    JOIN exhibitions e ON e.id = ea.exhibition_id
    WHERE ea.artwork_id = v_artwork_id AND e.start_date IS NOT NULL
  )
  WHERE id = v_artwork_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_artwork_last_exhibition_year ON public.exhibition_artworks;
CREATE TRIGGER trg_sync_artwork_last_exhibition_year
  AFTER INSERT OR DELETE ON public.exhibition_artworks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_artwork_last_exhibition_year();

-- 3. browse_artwork_ids: add p_last_exhibited_before ---------------------------

DROP FUNCTION IF EXISTS public.browse_artwork_ids(
  integer, integer, uuid, uuid[], boolean, text, text, text[], text, text, boolean, integer, integer, text[], text, uuid[]
);

CREATE OR REPLACE FUNCTION public.browse_artwork_ids(
  p_year_from              integer  DEFAULT NULL,
  p_year_to                integer  DEFAULT NULL,
  p_institution            uuid     DEFAULT NULL,
  p_institutions           uuid[]   DEFAULT NULL,
  p_has_image              boolean  DEFAULT NULL,
  p_medium_bucket          text     DEFAULT NULL,
  p_medium_sub_bucket      text     DEFAULT NULL,
  p_nationalities          text[]   DEFAULT NULL,
  p_movement               text     DEFAULT NULL,
  p_cultural_attribution   text     DEFAULT NULL,
  p_has_exhibition         boolean  DEFAULT NULL,
  p_offset                 integer  DEFAULT 0,
  p_limit                  integer  DEFAULT 24,
  p_materials              text[]   DEFAULT NULL,
  p_sort                   text     DEFAULT 'date_desc',
  p_artist_ids             uuid[]   DEFAULT NULL,
  p_last_exhibited_before  integer  DEFAULT NULL
)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT a.id
  FROM artworks a
  LEFT JOIN artists ar ON ar.id = a.artist_id
  WHERE (p_year_from IS NULL OR a.date_year >= p_year_from)
    AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
    AND (
      (p_institution IS NULL AND p_institutions IS NULL)
      OR (p_institution IS NOT NULL AND a.current_institution_id = p_institution)
      OR (p_institutions IS NOT NULL AND a.current_institution_id = ANY(p_institutions))
    )
    AND (p_has_image IS NULL
         OR (p_has_image     AND a.image_url IS NOT NULL)
         OR (NOT p_has_image AND a.image_url IS NULL))
    AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
    AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
    AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
    AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
    AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
    AND (
      p_medium_sub_bucket IS NULL OR (
        (p_medium_sub_bucket = 'Oil'        AND lower(a.medium) LIKE '%oil%') OR
        (p_medium_sub_bucket = 'Watercolor' AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
        (p_medium_sub_bucket = 'Gouache'    AND lower(a.medium) LIKE '%gouache%') OR
        (p_medium_sub_bucket = 'Tempera'    AND lower(a.medium) LIKE '%tempera%') OR
        (p_medium_sub_bucket = 'Acrylic'    AND lower(a.medium) LIKE '%acrylic%')
      )
    )
    AND (p_materials IS NULL OR a.materials && p_materials)
    AND (p_artist_ids IS NULL OR a.artist_id = ANY(p_artist_ids))
    AND (
      p_last_exhibited_before IS NULL
      OR a.last_exhibition_year IS NULL
      OR a.last_exhibition_year < p_last_exhibited_before
    )
  ORDER BY
    CASE WHEN p_sort = 'most_exhibited' AND a.has_exhibition THEN 0 ELSE 1 END ASC,
    CASE WHEN p_sort = 'date_asc' THEN a.date_year END ASC NULLS LAST,
    CASE WHEN p_sort != 'date_asc' THEN a.date_year END DESC NULLS LAST,
    a.id
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.browse_artwork_ids(
  integer, integer, uuid, uuid[], boolean, text, text, text[], text, text, boolean, integer, integer, text[], text, uuid[], integer
) TO anon, authenticated;
