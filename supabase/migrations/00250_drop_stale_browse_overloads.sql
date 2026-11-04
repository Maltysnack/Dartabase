-- Drop old browse function overloads that are no longer called by the app.
-- PostgREST (PGRST203) cannot resolve ambiguity when multiple overloads
-- share the same leading named params and differ only in optional trailing params.
-- The app calls only the latest signatures added in 0023 / 0024.

DROP FUNCTION IF EXISTS public.browse_artwork_ids(int, uuid, boolean, int, int);
DROP FUNCTION IF EXISTS public.browse_artwork_ids(int, uuid, boolean, text, int, int);

DROP FUNCTION IF EXISTS public.browse_facets(int, uuid, boolean);
DROP FUNCTION IF EXISTS public.browse_facets(int, uuid, boolean, text);

DROP FUNCTION IF EXISTS public.browse_artwork_count(int, uuid, boolean, text);
