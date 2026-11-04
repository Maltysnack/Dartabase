-- Extend search_artworks_ranked to support optional year-range filtering.
-- Drops the old 2-param overload and replaces it with a 4-param version
-- (min/max year default to NULL = no filter). Existing callers that pass
-- only {q, lim} continue to work via PostgREST named-param routing.

DROP FUNCTION IF EXISTS public.search_artworks_ranked(text, int);

CREATE OR REPLACE FUNCTION public.search_artworks_ranked(
  q text,
  lim int DEFAULT 60,
  p_min_year int DEFAULT NULL,
  p_max_year int DEFAULT NULL
)
RETURNS TABLE (id uuid, rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    aw.id,
    ts_rank(aw.search_vector, plainto_tsquery('english', q)) AS rank
  FROM public.artworks aw
  WHERE aw.search_vector @@ plainto_tsquery('english', q)
    AND (p_min_year IS NULL OR aw.date_year >= p_min_year)
    AND (p_max_year IS NULL OR aw.date_year <= p_max_year)
  ORDER BY rank DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.search_artworks_ranked(text, int, int, int)
  TO anon, authenticated;
