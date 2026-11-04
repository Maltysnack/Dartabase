-- Improve artwork full-text search: weighted tsvector and ts_rank ordering.
--
-- Before: search_vector built from unweighted concat of title + medium + date_text.
-- After:  title=A, medium=C, date_text=D so ts_rank places title matches first.
--
-- Also adds search_artworks_ranked() RPC used by queries.ts to order
-- the full-page search results by relevance instead of arrival order.

-- 1. Update artworks trigger to use setweight()
CREATE OR REPLACE FUNCTION public.artworks_tsv() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.medium, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.date_text, '')), 'D');
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END; $$;

-- 2. Backfill all existing rows with the new weighted vectors
UPDATE public.artworks
SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(medium, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(date_text, '')), 'D');

-- 3. RPC: returns artwork IDs ranked by ts_rank descending.
--    Called by the full-page search() function in queries.ts.
--    The caller fetches the full card rows by those IDs (preserving rank order)
--    so no join is needed here; keeping this function narrow makes it fast.
CREATE OR REPLACE FUNCTION public.search_artworks_ranked(q text, lim int DEFAULT 60)
RETURNS TABLE (id uuid, rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    aw.id,
    ts_rank(aw.search_vector, plainto_tsquery('english', q)) AS rank
  FROM public.artworks aw
  WHERE aw.search_vector @@ plainto_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.search_artworks_ranked(text, int) TO anon, authenticated;
