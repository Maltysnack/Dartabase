-- RPC: shared_exhibitions(p_artwork_a uuid, p_artwork_b uuid)
--
-- Returns exhibitions that both artworks appeared in, ordered by most recent
-- first. Used on the /compare page to show "these works toured together."

create or replace function public.shared_exhibitions(
  p_artwork_a uuid,
  p_artwork_b uuid
)
returns table(
  id              uuid,
  title           text,
  start_date      date,
  end_date        date,
  institution_id  uuid,
  institution_name text,
  institution_city text,
  institution_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.title,
    e.start_date,
    e.end_date,
    e.institution_id,
    i.name    as institution_name,
    i.city    as institution_city,
    i.slug    as institution_slug
  from exhibitions e
  join exhibition_artworks ea1
    on ea1.exhibition_id = e.id and ea1.artwork_id = p_artwork_a
  join exhibition_artworks ea2
    on ea2.exhibition_id = e.id and ea2.artwork_id = p_artwork_b
  left join institutions i
    on i.id = e.institution_id
  order by coalesce(e.start_date, '1900-01-01') desc;
$$;

grant execute on function public.shared_exhibitions(uuid, uuid)
  to anon, authenticated;
