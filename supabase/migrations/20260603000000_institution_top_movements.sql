-- RPC: institution_top_movements(p_n integer)
--
-- Returns the top p_n movements per institution by artwork count. Movements
-- are derived from artists.movements (array) across all artworks held at each
-- institution. Used to surface collection-strength tags on the institutions
-- list and detail pages.

create or replace function public.institution_top_movements(p_n integer default 5)
returns table(
  institution_id uuid,
  movement       text,
  artwork_count  bigint
)
language sql
stable
security definer
as $$
  with ranked as (
    select
      a.current_institution_id       as institution_id,
      m.movement                     as movement,
      count(a.id)                    as artwork_count,
      row_number() over (
        partition by a.current_institution_id
        order by count(a.id) desc, m.movement asc
      )                              as rn
    from   artworks a
    join   artists ar on ar.id = a.artist_id
    cross join unnest(ar.movements) as m(movement)
    where  a.current_institution_id is not null
      and  array_length(ar.movements, 1) > 0
    group  by a.current_institution_id, m.movement
  )
  select institution_id, movement, artwork_count
  from   ranked
  where  rn <= p_n
  order  by institution_id, artwork_count desc, movement asc;
$$;
