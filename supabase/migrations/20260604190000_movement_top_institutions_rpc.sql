-- RPC: movement_top_institutions(p_movement text, p_limit integer)
--
-- Returns the top p_limit institutions by artwork count for the given movement.
-- Artworks are attributed to a movement via their artist's movements array.
-- Used to power the "Collections" section on movement detail pages.

create or replace function public.movement_top_institutions(
  p_movement text,
  p_limit    integer default 10
)
returns table(
  institution_id   uuid,
  institution_name text,
  institution_slug text,
  institution_city text,
  artwork_count    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id    as institution_id,
    i.name  as institution_name,
    i.slug  as institution_slug,
    i.city  as institution_city,
    count(distinct aw.id) as artwork_count
  from artists ar
  join artworks aw on aw.artist_id = ar.id
  join institutions i on i.id = aw.current_institution_id
  where ar.movements @> array[p_movement]::text[]
    and ar.merged_into is null
    and aw.current_institution_id is not null
  group by i.id, i.name, i.slug, i.city
  order by artwork_count desc, i.name asc
  limit p_limit;
$$;

grant execute on function public.movement_top_institutions(text, integer)
  to anon, authenticated;
