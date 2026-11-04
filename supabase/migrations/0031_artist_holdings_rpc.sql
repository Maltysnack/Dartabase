-- RPC: artist_holdings(p_artist_id uuid)
--
-- Returns a count of artworks per institution for a given artist, computed
-- server-side with a single GROUP BY query. Used by the artist page to show
-- the "Held at N collections" breakdown without fetching all artwork rows.

create or replace function public.artist_holdings(p_artist_id uuid)
returns table(
  institution_id   uuid,
  institution_name text,
  institution_slug text,
  work_count       bigint
)
language sql
stable
security definer
as $$
  select
    i.id               as institution_id,
    i.name             as institution_name,
    i.slug             as institution_slug,
    count(a.id)        as work_count
  from   artworks a
  join   institutions i on i.id = a.current_institution_id
  where  a.artist_id = p_artist_id
    and  a.current_institution_id is not null
  group  by i.id, i.name, i.slug
  order  by work_count desc;
$$;
