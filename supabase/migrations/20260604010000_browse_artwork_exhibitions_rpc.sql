-- browse_artwork_exhibitions: returns exhibitions grouped by how many matching
-- artworks they contain, given the same filter set as browse_artwork_ids.
-- Used by the exhibition-grouped view on the browse page (issue #597).
CREATE OR REPLACE FUNCTION public.browse_artwork_exhibitions(
  p_year_from integer DEFAULT NULL::integer,
  p_year_to integer DEFAULT NULL::integer,
  p_institutions uuid[] DEFAULT NULL::uuid[],
  p_has_image boolean DEFAULT NULL::boolean,
  p_medium_bucket text DEFAULT NULL::text,
  p_medium_sub_bucket text DEFAULT NULL::text,
  p_nationalities text[] DEFAULT NULL::text[],
  p_movement text DEFAULT NULL::text,
  p_cultural_attribution text DEFAULT NULL::text,
  p_materials text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  id uuid,
  title text,
  start_date date,
  end_date date,
  institution_id uuid,
  institution_name text,
  institution_slug text,
  matching_work_count bigint,
  total_work_count bigint
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH matching_artworks AS (
    SELECT a.id
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE a.has_exhibition = true
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to IS NULL OR a.date_year <= p_year_to)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL
           OR (p_has_image AND a.image_url IS NOT NULL)
           OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR a.medium ILIKE '%' || p_medium_sub_bucket || '%')
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_materials IS NULL OR a.materials && p_materials)
  ),
  exhibition_match_counts AS (
    SELECT ea.exhibition_id, COUNT(DISTINCT ea.artwork_id)::bigint AS matching_count
    FROM exhibition_artworks ea
    JOIN matching_artworks ma ON ma.id = ea.artwork_id
    GROUP BY ea.exhibition_id
  ),
  exhibition_total_counts AS (
    SELECT ea.exhibition_id, COUNT(DISTINCT ea.artwork_id)::bigint AS total_count
    FROM exhibition_artworks ea
    WHERE ea.exhibition_id IN (SELECT exhibition_id FROM exhibition_match_counts)
    GROUP BY ea.exhibition_id
  )
  SELECT
    e.id,
    e.title,
    e.start_date,
    e.end_date,
    i.id   AS institution_id,
    i.name AS institution_name,
    i.slug AS institution_slug,
    emc.matching_count  AS matching_work_count,
    etc.total_count     AS total_work_count
  FROM exhibitions e
  JOIN exhibition_match_counts emc ON emc.exhibition_id = e.id
  JOIN exhibition_total_counts etc ON etc.exhibition_id = e.id
  LEFT JOIN institutions i ON i.id = e.institution_id
  ORDER BY emc.matching_count DESC, e.start_date DESC NULLS LAST
  LIMIT 100;
$$;
