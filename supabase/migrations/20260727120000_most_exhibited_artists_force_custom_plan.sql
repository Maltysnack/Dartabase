-- most_exhibited_artists_at_institution has been throwing Postgres error 57014
-- (statement timeout) on /institutions/[id]: 6 occurrences over 2026-07-25/26,
-- affecting 4 distinct users, per Vercel runtime error logs. This is the same
-- failure mode fixed for browse_artwork_ids in
-- 20260608130000_browse_artwork_ids_force_custom_plan.sql: PostgREST calls RPCs
-- with bound parameters, so after repeated calls Postgres flips to a GENERIC
-- plan. A generic plan cannot specialize on p_institution_id, so the
-- artists -> artworks -> exhibition_artworks -> exhibitions join likely runs
-- broadly before the institution filter narrows it, instead of seeding a
-- narrow nested loop off idx_exhibitions_institution.
--
-- Fix: convert to plpgsql with `SET plan_cache_mode = force_custom_plan`, same
-- as browse_artwork_ids. plpgsql re-plans the embedded query per call with the
-- actual parameter values substituted as constants, letting the planner use
-- the institution filter from the start. The SELECT logic is unchanged, so
-- results are byte-for-byte identical to the previous version.
CREATE OR REPLACE FUNCTION public.most_exhibited_artists_at_institution(
  p_institution_id uuid, p_limit integer DEFAULT 10)
RETURNS TABLE(artist_id uuid, artist_name text, artist_slug text, exhibition_count bigint)
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  RETURN QUERY
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
END;
$function$;
