-- Add p_exhibition_year_from and p_exhibition_year_to to browse_artwork_ids (#545).
--
-- These filter artworks to those that appeared in at least one exhibition whose
-- start_date falls within [p_exhibition_year_from, p_exhibition_year_to].
-- NULL means no restriction on that bound. Setting either param implicitly
-- requires the artwork to have at least one dated exhibition record.
--
-- Uses an EXISTS subquery via idx_exhibition_artworks_artwork (artwork_id) and
-- idx_exhibitions_start_date so the lookup is index-backed.

DROP FUNCTION IF EXISTS public.browse_artwork_ids(
  integer, integer, uuid, uuid[], boolean, text, text, text[], text, text, boolean, integer, integer, text[], text, uuid[], integer
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
  p_last_exhibited_before  integer  DEFAULT NULL,
  p_exhibition_year_from   integer  DEFAULT NULL,
  p_exhibition_year_to     integer  DEFAULT NULL
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
    AND (
      (p_exhibition_year_from IS NULL AND p_exhibition_year_to IS NULL)
      OR EXISTS (
        SELECT 1
        FROM exhibition_artworks ea
        JOIN exhibitions ex ON ex.id = ea.exhibition_id
        WHERE ea.artwork_id = a.id
          AND ex.start_date IS NOT NULL
          AND (p_exhibition_year_from IS NULL OR EXTRACT(YEAR FROM ex.start_date)::int >= p_exhibition_year_from)
          AND (p_exhibition_year_to   IS NULL OR EXTRACT(YEAR FROM ex.start_date)::int <= p_exhibition_year_to)
      )
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
  integer, integer, uuid, uuid[], boolean, text, text, text[], text, text, boolean, integer, integer, text[], text, uuid[], integer, integer, integer
) TO anon, authenticated;
