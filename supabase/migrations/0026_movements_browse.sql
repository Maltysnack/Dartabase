-- Movements browse page (#358).
--
-- Returns all art movements with artist and artwork counts, ordered by
-- artist count descending, for the /movements discovery page.

create or replace function public.list_movements()
returns table (
  movement      text,
  artist_count  int,
  artwork_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.movement,
    count(distinct ar.id)::int  as artist_count,
    count(distinct aw.id)       as artwork_count
  from artists ar
  cross join unnest(ar.movements) as m(movement)
  left join artworks aw on aw.artist_id = ar.id
  where array_length(ar.movements, 1) > 0
    and ar.merged_into is null
  group by m.movement
  order by artist_count desc, m.movement
$$;

grant execute on function public.list_movements()
  to anon, authenticated;
