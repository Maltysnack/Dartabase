-- RPC: artist_exhibition_venues(p_artist_id uuid, p_limit int)
--
-- Returns institutions where a given artist's works have been exhibited,
-- ranked by number of distinct exhibitions. Used by the artist compare page
-- to show exhibition venue history side by side with overlap highlighted.

create or replace function public.artist_exhibition_venues(
  p_artist_id uuid,
  p_limit     int default 10
)
returns table(
  institution_id    uuid,
  institution_name  text,
  institution_slug  text,
  institution_city  text,
  exhibition_count  bigint
)
language sql
stable
security definer
as $$
  select
    i.id                        as institution_id,
    i.name                      as institution_name,
    i.slug                      as institution_slug,
    i.city                      as institution_city,
    count(distinct e.id)        as exhibition_count
  from   artworks a
  join   exhibition_artworks ea on ea.artwork_id = a.id
  join   exhibitions e          on e.id = ea.exhibition_id
  join   institutions i         on i.id = e.institution_id
  where  a.artist_id = p_artist_id
    and  e.institution_id is not null
  group  by i.id, i.name, i.slug, i.city
  order  by exhibition_count desc, i.name asc
  limit  p_limit;
$$;
