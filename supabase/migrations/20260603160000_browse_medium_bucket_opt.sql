-- Optimise browse RPCs: replace ilike-based medium filtering with indexed
-- medium_bucket column lookups. (#681)
--
-- The medium_bucket column was backfilled by 0033_new_medium_buckets and
-- contains the same classification as the former ilike any(array[...])
-- conditions. Using an equality check on an indexed column is orders of
-- magnitude faster than repeated ilike scans across 32k+ rows.
--
-- Also adds Video and Installation to the medium_counts facet (they were
-- omitted from the year_range migration that last rewrote browse_facets).

-- Index that makes medium_bucket equality checks fast.
create index if not exists artworks_medium_bucket_idx
  on artworks (medium_bucket);


-- browse_artwork_ids ----------------------------------------------------------

drop function if exists public.browse_artwork_ids(int, int, uuid, boolean, text, text[], text, text, boolean, int, int);

create or replace function public.browse_artwork_ids(
  p_year_from             int      default null,
  p_year_to               int      default null,
  p_institution           uuid     default null,
  p_has_image             boolean  default null,
  p_medium_bucket         text     default null,
  p_nationalities         text[]   default null,
  p_movement              text     default null,
  p_cultural_attribution  text     default null,
  p_has_exhibition        boolean  default null,
  p_offset                int      default 0,
  p_limit                 int      default 24
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id
  from artworks a
  left join artists ar on ar.id = a.artist_id
  where (p_year_from is null or a.date_year >= p_year_from)
    and (p_year_to   is null or a.date_year <= p_year_to)
    and (p_institution is null or a.current_institution_id = p_institution)
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null
         or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
         or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.browse_artwork_ids(int, int, uuid, boolean, text, text[], text, text, boolean, int, int)
  to anon, authenticated;


-- browse_artwork_count --------------------------------------------------------

drop function if exists public.browse_artwork_count(int, int, uuid, boolean, text, text[], text, text, boolean);

create or replace function public.browse_artwork_count(
  p_year_from             int      default null,
  p_year_to               int      default null,
  p_institution           uuid     default null,
  p_has_image             boolean  default null,
  p_medium_bucket         text     default null,
  p_nationalities         text[]   default null,
  p_movement              text     default null,
  p_cultural_attribution  text     default null,
  p_has_exhibition        boolean  default null
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
  from artworks a
  left join artists ar on ar.id = a.artist_id
  where (p_year_from is null or a.date_year >= p_year_from)
    and (p_year_to   is null or a.date_year <= p_year_to)
    and (p_institution is null or a.current_institution_id = p_institution)
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null
         or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
         or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)));
$$;

grant execute on function public.browse_artwork_count(int, int, uuid, boolean, text, text[], text, text, boolean)
  to anon, authenticated;


-- browse_facets ---------------------------------------------------------------

drop function if exists public.browse_facets(int, int, uuid, boolean, text, text[], text, text, boolean);

create or replace function public.browse_facets(
  p_year_from             int      default null,
  p_year_to               int      default null,
  p_institution           uuid     default null,
  p_has_image             boolean  default null,
  p_medium_bucket         text     default null,
  p_nationalities         text[]   default null,
  p_movement              text     default null,
  p_cultural_attribution  text     default null,
  p_has_exhibition        boolean  default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  decades as (
    select (a.date_year / 10) * 10 as decade, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
      and a.date_year is not null
    group by 1
    order by 1 desc
  ),
  institutions as (
    select a.current_institution_id as id, i.name, count(*)::int as n
    from artworks a
    join institutions i on i.id = a.current_institution_id
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
      and a.current_institution_id is not null
    group by a.current_institution_id, i.name
    order by n desc, i.name asc
    limit 25
  ),
  image_counts as (
    select
      count(*) filter (where a.image_url is not null)::int as with_image,
      count(*) filter (where a.image_url is null)::int     as without_image
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
  ),
  exhibition_counts as (
    select
      count(*) filter (
        where exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)
      )::int as with_exhibition
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
  ),
  -- medium_counts does NOT filter by p_medium_bucket so all buckets show counts
  -- under the current filter combination (year, institution, etc.).
  medium_counts as (
    select a.medium_bucket as bucket, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where a.medium_bucket is not null
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
    group by a.medium_bucket
  ),
  nationalities as (
    select ar.nationality, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    where ar.nationality is not null
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
    group by ar.nationality
    order by n desc, ar.nationality
    limit 30
  ),
  movements as (
    select m.movement, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    cross join unnest(ar.movements) as m(movement)
    where array_length(ar.movements, 1) > 0
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
    group by m.movement
    order by n desc, m.movement
    limit 30
  ),
  cultural_attributions as (
    select a.cultural_attribution as attribution, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where a.cultural_attribution is not null
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
    group by a.cultural_attribution
    order by n desc, a.cultural_attribution
  ),
  total as (
    select count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution is null or a.current_institution_id = p_institution)
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null
           or (p_has_exhibition     and exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id))
           or (not p_has_exhibition and not exists (select 1 from exhibition_artworks ea where ea.artwork_id = a.id)))
  )
  select jsonb_build_object(
    'decades',               coalesce((select jsonb_agg(jsonb_build_object('decade', decade, 'n', n)) from decades), '[]'::jsonb),
    'institutions',          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'n', n)) from institutions), '[]'::jsonb),
    'nationalities',         coalesce((select jsonb_agg(jsonb_build_object('nationality', nationality, 'n', n)) from nationalities), '[]'::jsonb),
    'movements',             coalesce((select jsonb_agg(jsonb_build_object('movement', movement, 'n', n)) from movements), '[]'::jsonb),
    'cultural_attributions', coalesce((select jsonb_agg(jsonb_build_object('attribution', attribution, 'n', n)) from cultural_attributions), '[]'::jsonb),
    'withImage',             (select with_image from image_counts),
    'withoutImage',          (select without_image from image_counts),
    'withExhibition',        (select with_exhibition from exhibition_counts),
    'total',                 (select n from total),
    'mediums',               coalesce(
                               (select jsonb_agg(jsonb_build_object('bucket', bucket, 'n', n) order by n desc)
                                from medium_counts),
                               '[]'::jsonb
                             )
  );
$$;

grant execute on function public.browse_facets(int, int, uuid, boolean, text, text[], text, text, boolean)
  to anon, authenticated;
