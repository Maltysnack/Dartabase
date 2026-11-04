-- RPC: related_movements(p_movement text, p_limit int)
--
-- Returns up to p_limit movements that co-occur with p_movement on at least
-- one canonical artist, ordered by the number of shared artists descending.
-- Used on movement detail pages to show related-movement chips.

create or replace function public.related_movements(
  p_movement text,
  p_limit    int default 8
)
returns table(
  movement     text,
  artist_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rm           as movement,
    count(distinct ar.id) as artist_count
  from artists ar,
    unnest(ar.movements) as rm
  where ar.movements @> array[p_movement]::text[]
    and rm <> p_movement
    and ar.merged_into is null
  group by rm
  order by artist_count desc, rm
  limit p_limit;
$$;

grant execute on function public.related_movements(text, int)
  to anon, authenticated;
