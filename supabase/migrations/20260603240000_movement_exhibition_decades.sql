-- RPC: movement_exhibition_decades(p_movement text)
--
-- Returns the number of distinct exhibitions per decade for artworks by
-- artists in the given movement. Used on movement detail pages to show when
-- the movement was most actively exhibited institutionally.
--
-- Exhibition data is currently drawn from AIC records, so results reflect
-- Art Institute of Chicago programming; the function works correctly as
-- exhibition coverage expands to other institutions.

create or replace function public.movement_exhibition_decades(p_movement text)
returns table(
  decade      int,
  exhibition_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (extract(year from e.start_date)::int / 10) * 10 as decade,
    count(distinct e.id)                              as exhibition_count
  from exhibitions e
  join exhibition_artworks ea on ea.exhibition_id = e.id
  join artworks            aw on aw.id = ea.artwork_id
  join artists             ar on ar.id = aw.artist_id
  where ar.movements @> array[p_movement]::text[]
    and ar.merged_into is null
    and e.start_date is not null
  group by decade
  order by decade;
$$;

grant execute on function public.movement_exhibition_decades(text)
  to anon, authenticated;
