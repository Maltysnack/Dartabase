-- Switch search_artworks_ranked to websearch_to_tsquery.
--
-- plainto_tsquery treats all terms as AND, with no way to express OR or NOT.
-- websearch_to_tsquery understands:
--   word1 OR word2  -> OR
--   -word           -> NOT
--   "phrase"        -> phrase search
--   word1 word2     -> AND (default, same as before)
--
-- The function signature is unchanged so no client code needs updating.

DROP FUNCTION IF EXISTS public.search_artworks_ranked(text, int, int, int);

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
    ts_rank(aw.search_vector, websearch_to_tsquery('english', q)) AS rank
  FROM public.artworks aw
  WHERE aw.search_vector @@ websearch_to_tsquery('english', q)
    AND (p_min_year IS NULL OR aw.date_year >= p_min_year)
    AND (p_max_year IS NULL OR aw.date_year <= p_max_year)
  ORDER BY rank DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.search_artworks_ranked(text, int, int, int)
  TO anon, authenticated;
