-- Switch browse RPCs to security definer so they run as the function owner,
-- bypassing per-row RLS evaluation overhead. The artworks, artists, and
-- exhibition_artworks tables all have qual=true public-read policies, so
-- this is safe. (#681)
--
-- Also sets statement_timeout = 0 within each function so the anon role's
-- session-level timeout does not cancel legitimate browse queries.
-- Superseded for browse_facets by 20260603162000_browse_facets_single_scan,
-- which also rewrites the function body. Kept here for browse_artwork_ids
-- and browse_artwork_count which retain the same body.

alter function public.browse_artwork_ids(int, int, uuid, boolean, text, text[], text, text, boolean, int, int)
  security definer
  set statement_timeout = 0;

alter function public.browse_artwork_count(int, int, uuid, boolean, text, text[], text, text, boolean)
  security definer
  set statement_timeout = 0;

-- Increase anon role statement_timeout from 3s to 8s.
-- The browse page runs complex queries that need more headroom.
alter role anon set statement_timeout = '8s';
