-- RPC: top_exhibition_movements(p_limit integer)
--
-- Returns the top movements by distinct exhibition count. A movement is counted
-- for an exhibition if any artwork in that exhibition is by an artist tagged with
-- that movement. Used to populate the movement filter chips on the exhibitions
-- browse page.

create or replace function public.top_exhibition_movements(p_limit integer default 20)
returns table(
  movement         text,
  exhibition_count bigint
)
language sql
stable
security definer
as $$
  select
    m.movement,
    count(distinct ea.exhibition_id) as exhibition_count
  from   exhibition_artworks ea
  join   artworks a  on a.id  = ea.artwork_id
  join   artists ar  on ar.id = a.artist_id
  cross join unnest(ar.movements) as m(movement)
  group  by m.movement
  order  by exhibition_count desc, m.movement asc
  limit  p_limit;
$$;

-- RPC: exhibition_ids_for_movement(p_movement text)
--
-- Returns the set of exhibition IDs that contain at least one artwork whose
-- artist is tagged with the given movement. Used by browseExhibitions when the
-- movement filter is active.

create or replace function public.exhibition_ids_for_movement(p_movement text)
returns table(exhibition_id uuid)
language sql
stable
security definer
as $$
  select distinct ea.exhibition_id
  from   exhibition_artworks ea
  join   artworks a  on a.id  = ea.artwork_id
  join   artists ar  on ar.id = a.artist_id
  where  p_movement = any(ar.movements);
$$;
