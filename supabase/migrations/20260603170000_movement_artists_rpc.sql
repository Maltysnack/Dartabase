-- RPC: movement_artists(p_movement text)
--
-- Returns all canonical artists belonging to the given movement, with their
-- Dartabase artwork count, distinct exhibition count, and distinct institution
-- count. Used to power the movement detail pages (/movements/[slug]).
--
-- Exhibition count is the number of distinct exhibitions any of the artist's
-- works appeared in -- not constrained to works *in* this movement, since
-- artists rarely compartmentalise by movement in exhibition records.

create or replace function public.movement_artists(p_movement text)
returns table(
  id                uuid,
  name              text,
  slug              text,
  birth_year        int,
  death_year        int,
  nationality       text,
  artwork_count     bigint,
  exhibition_count  bigint,
  institution_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ar.id,
    ar.name,
    ar.slug,
    ar.birth_year,
    ar.death_year,
    ar.nationality,
    count(distinct aw.id)                    as artwork_count,
    count(distinct ea.exhibition_id)          as exhibition_count,
    count(distinct aw.current_institution_id) as institution_count
  from artists ar
  left join artworks aw on aw.artist_id = ar.id
  left join exhibition_artworks ea on ea.artwork_id = aw.id
  where ar.movements @> array[p_movement]::text[]
    and ar.merged_into is null
  group by ar.id, ar.name, ar.slug, ar.birth_year, ar.death_year, ar.nationality
  order by exhibition_count desc nulls last, artwork_count desc, ar.name;
$$;

grant execute on function public.movement_artists(text)
  to anon, authenticated;
