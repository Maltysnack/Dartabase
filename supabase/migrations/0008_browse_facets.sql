-- Faceted browse (#35).
--
-- Two SQL functions back the /browse route: one returns the paginated artwork
-- IDs for a given filter combination; the other returns conditional facet
-- counts (each facet's counts are calculated with the OTHER selected filters
-- applied but its own filter ignored, so the user always sees what would
-- happen if they switched their selection within that facet).
--
-- Filters live in plain function parameters rather than a jsonb blob so the
-- query planner can use the existing single-column indexes; null means "no
-- filter on this dimension".
--
-- v1 facets: decade (10-year bucket on date_year), institution (uuid match),
-- and image presence (boolean). Movement, medium, and nationality wait on the
-- vocabulary work (#30) — free-text variants would produce noisy counts.

create or replace function public.browse_artwork_ids(
  p_decade int default null,
  p_institution uuid default null,
  p_has_image boolean default null,
  p_offset int default 0,
  p_limit int default 24
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id
  from artworks a
  where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
    and (p_institution is null or a.current_institution_id = p_institution)
    and (p_has_image is null
         or (p_has_image and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.browse_artwork_ids(int, uuid, boolean, int, int)
  to anon, authenticated;

create or replace function public.browse_facets(
  p_decade int default null,
  p_institution uuid default null,
  p_has_image boolean default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  -- Decade counts: institution + image filters applied, decade filter dropped.
  decades as (
    select (a.date_year / 10) * 10 as decade, count(*)::int as n
    from artworks a
    where (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and a.date_year is not null
    group by 1
    order by 1 desc
  ),
  -- Institution counts: decade + image filters applied, institution dropped.
  institutions as (
    select a.current_institution_id as id, i.name, count(*)::int as n
    from artworks a
    join institutions i on i.id = a.current_institution_id
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and a.current_institution_id is not null
    group by a.current_institution_id, i.name
    order by n desc, i.name asc
    limit 25
  ),
  -- Image-presence counts: decade + institution filters applied, image dropped.
  image_counts as (
    select
      count(*) filter (where a.image_url is not null)::int as with_image,
      count(*) filter (where a.image_url is null)::int as without_image
    from artworks a
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
  ),
  -- Total matching the full filter set (for the result header).
  total as (
    select count(*)::int as n
    from artworks a
    where (p_decade is null or (a.date_year >= p_decade and a.date_year < p_decade + 10))
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
  )
  select jsonb_build_object(
    'decades', coalesce((select jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) from decades), '[]'::jsonb),
    'institutions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'n', n)) from institutions), '[]'::jsonb),
    'withImage', (select with_image from image_counts),
    'withoutImage', (select without_image from image_counts),
    'total', (select n from total)
  );
$$;

grant execute on function public.browse_facets(int, uuid, boolean)
  to anon, authenticated;
