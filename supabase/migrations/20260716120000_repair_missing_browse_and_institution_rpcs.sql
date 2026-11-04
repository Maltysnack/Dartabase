-- Repairs migration drift: four RPCs were applied directly to the live
-- database between 2026-06-17 and 2026-06-24 (print/photography/textile
-- medium sub-buckets on browse_artwork_ids and browse_facets, plus
-- most_exhibited_artists_at_institution) but were never committed as repo
-- migration files. The repo's browse_facets/browse_artwork_ids migrations
-- previously only covered the Painting sub-buckets.
--
-- This file captures the CURRENT cumulative live definitions verbatim
-- (pulled 2026-07-16 via pg_get_functiondef) rather than replaying the
-- original incremental diffs, which are not recoverable from live state
-- alone. All statements are CREATE OR REPLACE, so applying this against
-- the already-current production database is a no-op.

CREATE OR REPLACE FUNCTION public.browse_artwork_ids(p_year_from integer DEFAULT NULL::integer, p_year_to integer DEFAULT NULL::integer, p_institution uuid DEFAULT NULL::uuid, p_institutions uuid[] DEFAULT NULL::uuid[], p_has_image boolean DEFAULT NULL::boolean, p_medium_bucket text DEFAULT NULL::text, p_medium_sub_bucket text DEFAULT NULL::text, p_nationalities text[] DEFAULT NULL::text[], p_movement text DEFAULT NULL::text, p_cultural_attribution text DEFAULT NULL::text, p_has_exhibition boolean DEFAULT NULL::boolean, p_offset integer DEFAULT 0, p_limit integer DEFAULT 24, p_materials text[] DEFAULT NULL::text[], p_sort text DEFAULT 'date_desc'::text, p_artist_ids uuid[] DEFAULT NULL::uuid[], p_last_exhibited_before integer DEFAULT NULL::integer, p_exhibition_year_from integer DEFAULT NULL::integer, p_exhibition_year_to integer DEFAULT NULL::integer)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  RETURN QUERY
  SELECT a.id FROM artworks a LEFT JOIN artists ar ON ar.id = a.artist_id
  WHERE (p_year_from IS NULL OR a.date_year >= p_year_from)
    AND (p_year_to IS NULL OR a.date_year <= p_year_to)
    AND ((p_institution IS NULL AND p_institutions IS NULL)
      OR (p_institution IS NOT NULL AND a.current_institution_id = p_institution)
      OR (p_institutions IS NOT NULL AND a.current_institution_id = ANY(p_institutions)))
    AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
    AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
    AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
    AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
    AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
    AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
    AND (p_medium_sub_bucket IS NULL OR (
        -- Painting sub-buckets
        (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
        (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
        (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
        (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
        (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
        -- Print sub-buckets
        (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
        (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
        (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
        (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
        (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
        -- Photography sub-buckets
        (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
        (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
        (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
        (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
        -- Textile sub-buckets
        (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
        (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
        (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
        (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
        (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
    ))
    AND (p_materials IS NULL OR a.materials && p_materials)
    AND (p_artist_ids IS NULL OR a.artist_id = ANY(p_artist_ids))
    AND (p_last_exhibited_before IS NULL OR a.last_exhibition_year IS NULL OR a.last_exhibition_year < p_last_exhibited_before)
    AND ((p_exhibition_year_from IS NULL AND p_exhibition_year_to IS NULL)
      OR EXISTS (
        SELECT 1 FROM exhibition_artworks ea
        JOIN exhibitions ex ON ex.id = ea.exhibition_id
        WHERE ea.artwork_id = a.id AND ex.start_date IS NOT NULL
          AND (p_exhibition_year_from IS NULL OR EXTRACT(YEAR FROM ex.start_date)::int >= p_exhibition_year_from)
          AND (p_exhibition_year_to IS NULL OR EXTRACT(YEAR FROM ex.start_date)::int <= p_exhibition_year_to)
      ))
  ORDER BY
    CASE WHEN p_sort = 'most_exhibited' AND a.has_exhibition THEN 0 ELSE 1 END ASC,
    CASE WHEN p_sort = 'date_asc' THEN a.date_year END ASC NULLS LAST,
    CASE WHEN p_sort != 'date_asc' THEN a.date_year END DESC NULLS LAST,
    a.id
  OFFSET p_offset LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.browse_facets(p_year_from integer DEFAULT NULL::integer, p_year_to integer DEFAULT NULL::integer, p_institution uuid DEFAULT NULL::uuid, p_institutions uuid[] DEFAULT NULL::uuid[], p_has_image boolean DEFAULT NULL::boolean, p_medium_bucket text DEFAULT NULL::text, p_medium_sub_bucket text DEFAULT NULL::text, p_nationalities text[] DEFAULT NULL::text[], p_movement text DEFAULT NULL::text, p_cultural_attribution text DEFAULT NULL::text, p_has_exhibition boolean DEFAULT NULL::boolean, p_materials text[] DEFAULT NULL::text[], p_artist_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  WITH sub_filter AS (
    SELECT
      p_medium_sub_bucket IS NULL OR (
        (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
        (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
        (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
        (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
        (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
        (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
        (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
        (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
        (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
        (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
        (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
        (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
        (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
        (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
        (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
        (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
        (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
        (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
        (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ) AS passes
    FROM artworks a
    WHERE FALSE
  ),
  decades AS (
    SELECT (a.date_year / 10) * 10 AS decade, count(*)::int AS n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
      AND a.date_year IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
  ),
  institutions AS (
    SELECT a.current_institution_id AS id, i.name, count(*)::int AS n
    FROM artworks a
    JOIN institutions i ON i.id = a.current_institution_id
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
      AND a.current_institution_id IS NOT NULL
    GROUP BY a.current_institution_id, i.name
    ORDER BY n DESC, i.name ASC
    LIMIT 25
  ),
  image_counts AS (
    SELECT
      count(*) FILTER (WHERE a.image_url IS NOT NULL)::int AS with_image,
      count(*) FILTER (WHERE a.image_url IS NULL)::int     AS without_image
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
  ),
  exhibition_counts AS (
    SELECT count(*) FILTER (WHERE a.has_exhibition)::int AS with_exhibition
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
  ),
  medium_counts AS (
    SELECT
      count(*) FILTER (WHERE a.medium_bucket = 'Painting')::int     AS painting,
      count(*) FILTER (WHERE a.medium_bucket = 'Print')::int        AS print_n,
      count(*) FILTER (WHERE a.medium_bucket = 'Drawing')::int      AS drawing,
      count(*) FILTER (WHERE a.medium_bucket = 'Photography')::int  AS photography,
      count(*) FILTER (WHERE a.medium_bucket = 'Sculpture')::int    AS sculpture,
      count(*) FILTER (WHERE a.medium_bucket = 'Ceramics')::int     AS ceramics,
      count(*) FILTER (WHERE a.medium_bucket = 'Textile')::int      AS textile,
      count(*) FILTER (WHERE a.medium_bucket = 'Video')::int        AS video_n,
      count(*) FILTER (WHERE a.medium_bucket = 'Installation')::int AS installation_n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
  ),
  nationalities AS (
    SELECT ar.nationality, count(*)::int AS n
    FROM artworks a
    JOIN artists ar ON ar.id = a.artist_id
    WHERE ar.nationality IS NOT NULL
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
    GROUP BY ar.nationality
    ORDER BY n DESC, ar.nationality
    LIMIT 30
  ),
  movements AS (
    SELECT m.movement, count(*)::int AS n
    FROM artworks a
    JOIN artists ar ON ar.id = a.artist_id
    CROSS JOIN unnest(ar.movements) AS m(movement)
    WHERE array_length(ar.movements, 1) > 0
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
    GROUP BY m.movement
    ORDER BY n DESC, m.movement
    LIMIT 30
  ),
  cultural_attributions AS (
    SELECT a.cultural_attribution AS attribution, count(*)::int AS n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE a.cultural_attribution IS NOT NULL
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
    GROUP BY a.cultural_attribution
    ORDER BY n DESC, a.cultural_attribution
  ),
  materials AS (
    SELECT m.material, count(*)::int AS n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    CROSS JOIN unnest(a.materials) AS m(material)
    WHERE array_length(a.materials, 1) > 0
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
    GROUP BY m.material
    ORDER BY n DESC, m.material
    LIMIT 30
  ),
  total AS (
    SELECT count(*)::int AS n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_medium_bucket IS NULL OR a.medium_bucket = p_medium_bucket)
      AND (p_medium_sub_bucket IS NULL OR (
          (p_medium_sub_bucket = 'Oil'           AND lower(a.medium) LIKE '%oil%') OR
          (p_medium_sub_bucket = 'Watercolor'    AND (lower(a.medium) LIKE '%watercolor%' OR lower(a.medium) LIKE '%watercolour%')) OR
          (p_medium_sub_bucket = 'Gouache'       AND lower(a.medium) LIKE '%gouache%') OR
          (p_medium_sub_bucket = 'Tempera'       AND lower(a.medium) LIKE '%tempera%') OR
          (p_medium_sub_bucket = 'Acrylic'       AND lower(a.medium) LIKE '%acrylic%') OR
          (p_medium_sub_bucket = 'Etching'       AND (lower(a.medium) LIKE '%etching%' OR lower(a.medium) LIKE '%radering%')) OR
          (p_medium_sub_bucket = 'Engraving'     AND (lower(a.medium) LIKE '%engrav%' OR lower(a.medium) LIKE '%kobberstik%')) OR
          (p_medium_sub_bucket = 'Lithograph'    AND (lower(a.medium) LIKE '%lithograph%' OR lower(a.medium) LIKE '%lithographie%')) OR
          (p_medium_sub_bucket = 'Screenprint'   AND (lower(a.medium) LIKE '%screenprint%' OR lower(a.medium) LIKE '%screen print%' OR lower(a.medium) LIKE '%silkscreen%' OR lower(a.medium) LIKE '%serigraph%')) OR
          (p_medium_sub_bucket = 'Woodcut'       AND (lower(a.medium) LIKE '%woodcut%' OR lower(a.medium) LIKE '%linocut%' OR lower(a.medium) LIKE '%træsnit%' OR lower(a.medium) LIKE '%wood engraving%' OR lower(a.medium) LIKE '%woodblock%')) OR
          (p_medium_sub_bucket = 'Albumen'       AND lower(a.medium) LIKE '%albumen%') OR
          (p_medium_sub_bucket = 'Gelatin Silver' AND (lower(a.medium) LIKE '%gelatin silver%' OR lower(a.medium) LIKE '%gelatine silver%')) OR
          (p_medium_sub_bucket = 'Chromogenic'   AND (lower(a.medium) LIKE '%chromogenic%' OR lower(a.medium) LIKE '%type c%' OR lower(a.medium) LIKE '%c-print%' OR lower(a.medium) LIKE '%cibachrome%' OR lower(a.medium) LIKE '%colour photograph%' OR lower(a.medium) LIKE '%color photograph%')) OR
          (p_medium_sub_bucket = 'Digital'       AND (lower(a.medium) LIKE '%digital%' OR lower(a.medium) LIKE '%inkjet%' OR lower(a.medium) LIKE '%pigment print%')) OR
          (p_medium_sub_bucket = 'Woven'         AND (lower(a.medium) LIKE '%weav%' OR lower(a.medium) LIKE '%woven%')) OR
          (p_medium_sub_bucket = 'Embroidery'    AND lower(a.medium) LIKE '%embroid%') OR
          (p_medium_sub_bucket = 'Tapestry'      AND (lower(a.medium) LIKE '%tapestry%' OR lower(a.medium) LIKE '%gobelin%')) OR
          (p_medium_sub_bucket = 'Lace'          AND lower(a.medium) LIKE '%lace%') OR
          (p_medium_sub_bucket = 'Batik'         AND (lower(a.medium) LIKE '%batik%' OR lower(a.medium) LIKE '%ikat%'))
      ))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
  ),
  painting_sub_buckets AS (
    SELECT
      count(*) FILTER (WHERE a.medium ILIKE '%oil%')::int                                     AS oil_n,
      count(*) FILTER (WHERE a.medium ILIKE '%watercolor%' OR a.medium ILIKE '%water color%'
                          OR a.medium ILIKE '%watercolour%')::int                             AS watercolor_n,
      count(*) FILTER (WHERE a.medium ILIKE '%gouache%')::int                                 AS gouache_n,
      count(*) FILTER (WHERE a.medium ILIKE '%tempera%')::int                                 AS tempera_n,
      count(*) FILTER (WHERE a.medium ILIKE '%acrylic%')::int                                 AS acrylic_n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE a.medium_bucket = 'Painting'
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
  ),
  print_sub_buckets AS (
    SELECT
      count(*) FILTER (WHERE a.medium ILIKE '%etching%' OR a.medium ILIKE '%radering%')::int AS etching_n,
      count(*) FILTER (WHERE a.medium ILIKE '%engrav%' OR a.medium ILIKE '%kobberstik%')::int AS engraving_n,
      count(*) FILTER (WHERE a.medium ILIKE '%lithograph%' OR a.medium ILIKE '%lithographie%')::int AS lithograph_n,
      count(*) FILTER (WHERE a.medium ILIKE '%screenprint%' OR a.medium ILIKE '%screen print%'
                          OR a.medium ILIKE '%silkscreen%' OR a.medium ILIKE '%serigraph%')::int AS screenprint_n,
      count(*) FILTER (WHERE a.medium ILIKE '%woodcut%' OR a.medium ILIKE '%linocut%'
                          OR a.medium ILIKE '%træsnit%' OR a.medium ILIKE '%wood engraving%'
                          OR a.medium ILIKE '%woodblock%')::int AS woodcut_n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE a.medium_bucket = 'Print'
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
  ),
  photography_sub_buckets AS (
    SELECT
      count(*) FILTER (WHERE a.medium ILIKE '%albumen%')::int AS albumen_n,
      count(*) FILTER (WHERE a.medium ILIKE '%gelatin silver%' OR a.medium ILIKE '%gelatine silver%')::int AS gelatin_silver_n,
      count(*) FILTER (WHERE a.medium ILIKE '%chromogenic%' OR a.medium ILIKE '%type c%' OR a.medium ILIKE '%c-print%' OR a.medium ILIKE '%cibachrome%' OR a.medium ILIKE '%colour photograph%' OR a.medium ILIKE '%color photograph%')::int AS chromogenic_n,
      count(*) FILTER (WHERE a.medium ILIKE '%digital%' OR a.medium ILIKE '%inkjet%' OR a.medium ILIKE '%pigment print%')::int AS digital_n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE a.medium_bucket = 'Photography'
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
  ),
  textile_sub_buckets AS (
    SELECT
      count(*) FILTER (WHERE a.medium ILIKE '%weav%' OR a.medium ILIKE '%woven%')::int AS woven_n,
      count(*) FILTER (WHERE a.medium ILIKE '%embroid%')::int AS embroidery_n,
      count(*) FILTER (WHERE a.medium ILIKE '%tapestry%' OR a.medium ILIKE '%gobelin%')::int AS tapestry_n,
      count(*) FILTER (WHERE a.medium ILIKE '%lace%')::int AS lace_n,
      count(*) FILTER (WHERE a.medium ILIKE '%batik%' OR a.medium ILIKE '%ikat%')::int AS batik_n
    FROM artworks a
    LEFT JOIN artists ar ON ar.id = a.artist_id
    WHERE a.medium_bucket = 'Textile'
      AND (p_year_from IS NULL OR a.date_year >= p_year_from)
      AND (p_year_to   IS NULL OR a.date_year <= p_year_to)
      AND (p_institution  IS NULL OR a.current_institution_id = p_institution)
      AND (p_institutions IS NULL OR a.current_institution_id = ANY(p_institutions))
      AND (p_has_image IS NULL OR (p_has_image AND a.image_url IS NOT NULL) OR (NOT p_has_image AND a.image_url IS NULL))
      AND (p_nationalities IS NULL OR ar.nationality = ANY(p_nationalities))
      AND (p_movement IS NULL OR p_movement = ANY(ar.movements))
      AND (p_cultural_attribution IS NULL OR a.cultural_attribution = p_cultural_attribution)
      AND (p_has_exhibition IS NULL OR a.has_exhibition = p_has_exhibition)
  )
  SELECT jsonb_build_object(
    'decades',               COALESCE((SELECT jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) FROM decades), '[]'::jsonb),
    'institutions',          COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'n', n)) FROM institutions), '[]'::jsonb),
    'nationalities',         COALESCE((SELECT jsonb_agg(jsonb_build_object('nationality', nationality, 'n', n)) FROM nationalities), '[]'::jsonb),
    'movements',             COALESCE((SELECT jsonb_agg(jsonb_build_object('movement', movement, 'n', n)) FROM movements), '[]'::jsonb),
    'cultural_attributions', COALESCE((SELECT jsonb_agg(jsonb_build_object('attribution', attribution, 'n', n)) FROM cultural_attributions), '[]'::jsonb),
    'materials',             COALESCE((SELECT jsonb_agg(jsonb_build_object('material', material, 'n', n)) FROM materials), '[]'::jsonb),
    'withImage',             (SELECT with_image FROM image_counts),
    'withoutImage',          (SELECT without_image FROM image_counts),
    'withExhibition',        (SELECT with_exhibition FROM exhibition_counts),
    'total',                 (SELECT n FROM total),
    'mediums', (
      SELECT jsonb_build_array(
        jsonb_build_object('bucket', 'Painting',      'n', painting),
        jsonb_build_object('bucket', 'Print',         'n', print_n),
        jsonb_build_object('bucket', 'Drawing',       'n', drawing),
        jsonb_build_object('bucket', 'Photography',   'n', photography),
        jsonb_build_object('bucket', 'Sculpture',     'n', sculpture),
        jsonb_build_object('bucket', 'Ceramics',      'n', ceramics),
        jsonb_build_object('bucket', 'Textile',       'n', textile),
        jsonb_build_object('bucket', 'Video',         'n', video_n),
        jsonb_build_object('bucket', 'Installation',  'n', installation_n)
      )
      FROM medium_counts
    ),
    'paintingSubBuckets',
      CASE WHEN p_medium_bucket = 'Painting' THEN (
        SELECT jsonb_build_array(
          jsonb_build_object('subBucket', 'Oil',        'n', oil_n),
          jsonb_build_object('subBucket', 'Watercolor', 'n', watercolor_n),
          jsonb_build_object('subBucket', 'Gouache',    'n', gouache_n),
          jsonb_build_object('subBucket', 'Tempera',    'n', tempera_n),
          jsonb_build_object('subBucket', 'Acrylic',    'n', acrylic_n)
        ) FROM painting_sub_buckets
      ) ELSE '[]'::jsonb END,
    'printSubBuckets',
      CASE WHEN p_medium_bucket = 'Print' THEN (
        SELECT jsonb_build_array(
          jsonb_build_object('subBucket', 'Etching',     'n', etching_n),
          jsonb_build_object('subBucket', 'Engraving',   'n', engraving_n),
          jsonb_build_object('subBucket', 'Lithograph',  'n', lithograph_n),
          jsonb_build_object('subBucket', 'Screenprint', 'n', screenprint_n),
          jsonb_build_object('subBucket', 'Woodcut',     'n', woodcut_n)
        ) FROM print_sub_buckets
      ) ELSE '[]'::jsonb END,
    'photographySubBuckets',
      CASE WHEN p_medium_bucket = 'Photography' THEN (
        SELECT jsonb_build_array(
          jsonb_build_object('subBucket', 'Albumen',        'n', albumen_n),
          jsonb_build_object('subBucket', 'Gelatin Silver', 'n', gelatin_silver_n),
          jsonb_build_object('subBucket', 'Chromogenic',    'n', chromogenic_n),
          jsonb_build_object('subBucket', 'Digital',        'n', digital_n)
        ) FROM photography_sub_buckets
      ) ELSE '[]'::jsonb END,
    'textileSubBuckets',
      CASE WHEN p_medium_bucket = 'Textile' THEN (
        SELECT jsonb_build_array(
          jsonb_build_object('subBucket', 'Woven',      'n', woven_n),
          jsonb_build_object('subBucket', 'Embroidery', 'n', embroidery_n),
          jsonb_build_object('subBucket', 'Tapestry',   'n', tapestry_n),
          jsonb_build_object('subBucket', 'Lace',       'n', lace_n),
          jsonb_build_object('subBucket', 'Batik',      'n', batik_n)
        ) FROM textile_sub_buckets
      ) ELSE '[]'::jsonb END
  );
$function$;

CREATE OR REPLACE FUNCTION public.most_exhibited_artists_at_institution(p_institution_id uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(artist_id uuid, artist_name text, artist_slug text, exhibition_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    ar.id         AS artist_id,
    ar.name       AS artist_name,
    ar.slug       AS artist_slug,
    COUNT(DISTINCT e.id) AS exhibition_count
  FROM artists ar
  JOIN artworks aw ON aw.artist_id = ar.id
  JOIN exhibition_artworks ea ON ea.artwork_id = aw.id
  JOIN exhibitions e ON e.id = ea.exhibition_id
  WHERE e.institution_id = p_institution_id
  GROUP BY ar.id, ar.name, ar.slug
  ORDER BY exhibition_count DESC, ar.name
  LIMIT p_limit;
$function$;
