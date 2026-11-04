-- RPC: get_co_exhibitionists(p_artist_id uuid, p_limit int)
--
-- Returns artists most frequently co-exhibited with the given artist,
-- ranked by the number of distinct shared exhibitions. Excludes the
-- target artist themselves and any merged duplicate records.

create or replace function public.get_co_exhibitionists(
  p_artist_id uuid,
  p_limit     int default 8
)
returns table(
  artist_id               uuid,
  artist_name             text,
  artist_slug             text,
  artist_nationality      text,
  artist_birth_year       int,
  artist_death_year       int,
  artist_image_url        text,
  shared_exhibition_count bigint
)
language sql
stable
security definer
as $$
  select
    a.id                               as artist_id,
    a.name                             as artist_name,
    a.slug                             as artist_slug,
    a.nationality                      as artist_nationality,
    a.birth_year                       as artist_birth_year,
    a.death_year                       as artist_death_year,
    a.image_url                        as artist_image_url,
    count(distinct ea2.exhibition_id)  as shared_exhibition_count
  from   exhibition_artworks ea1
  join   artworks aw1 on aw1.id = ea1.artwork_id
  join   exhibition_artworks ea2 on ea2.exhibition_id = ea1.exhibition_id
                                 and ea2.artwork_id  != ea1.artwork_id
  join   artworks aw2 on aw2.id = ea2.artwork_id
  join   artists a on a.id = aw2.artist_id
  where  aw1.artist_id  = p_artist_id
    and  a.id           != p_artist_id
    and  a.merged_into  is null
  group  by a.id, a.name, a.slug, a.nationality,
            a.birth_year, a.death_year, a.image_url
  order  by shared_exhibition_count desc, a.name asc
  limit  p_limit;
$$;
