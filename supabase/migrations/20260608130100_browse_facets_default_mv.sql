-- Materialized unfiltered facet results for the two canonical "no filter" browse
-- states: the default view (has_image = true) and the "all" view (has_image = null).
-- These are the heaviest, most crawler-hit facet calls; serving them from a matview
-- makes them O(1) and robust to Vercel Data Cache wipes (deploys / post-ingest purge).
-- Filtered facet calls still hit browse_facets() directly. Positional args target the
-- newest 13-arg overload unambiguously (named args are ambiguous across the stale
-- overloads). Refresh after ingestion via refresh_browse_facets_mv().
CREATE MATERIALIZED VIEW IF NOT EXISTS browse_facets_default_mv AS
  SELECT 'default'::text AS key,
         public.browse_facets(NULL::int, NULL::int, NULL::uuid, NULL::uuid[], true,
           NULL::text, NULL::text, NULL::text[], NULL::text, NULL::text,
           NULL::boolean, NULL::text[], NULL::uuid[]) AS facets
  UNION ALL
  SELECT 'all'::text AS key,
         public.browse_facets(NULL::int, NULL::int, NULL::uuid, NULL::uuid[], NULL::boolean,
           NULL::text, NULL::text, NULL::text[], NULL::text, NULL::text,
           NULL::boolean, NULL::text[], NULL::uuid[]) AS facets;

CREATE UNIQUE INDEX IF NOT EXISTS browse_facets_default_mv_key
  ON browse_facets_default_mv (key);

CREATE OR REPLACE FUNCTION public.refresh_browse_facets_mv()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY browse_facets_default_mv;
$$;

GRANT SELECT ON browse_facets_default_mv TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_browse_facets_mv() TO anon, authenticated;
