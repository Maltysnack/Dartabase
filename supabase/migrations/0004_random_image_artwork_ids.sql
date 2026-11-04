-- Random sampling of image-bearing artworks for the homepage grid.
--
-- PostgREST has no ORDER BY random(); a SQL function is the canonical way to
-- expose random selection through supabase-js. The page calls this RPC for
-- IDs, then fetches the full card rows via a normal select so the artist
-- embed continues to work.
--
-- At ~8k image-bearing rows the full scan + sort is sub-50ms. The homepage
-- runs under ISR (revalidate = 300), so the random set rotates per
-- regeneration, ~every 5 minutes in production.

create or replace function public.random_image_artwork_ids(n int)
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id from artworks
  where image_url is not null
  order by random()
  limit n;
$$;

grant execute on function public.random_image_artwork_ids(int) to anon, authenticated;
