-- Add p_institutions uuid[] and p_medium_sub_bucket text to browse_artwork_ids
-- and browse_facets. These parameters were used by the frontend (issues #547
-- and #692) but the DB functions had not been updated to match.
--
-- p_institution uuid is kept for backward compatibility: the v1 API and the
-- export route still pass a single UUID. The filter is applied as AND so
-- callers never set both institution params at once.
--
-- p_medium_sub_bucket performs ILIKE matching on the medium text column within
-- artworks that have medium_bucket = 'Painting'. Valid values come from the
-- PAINTING_SUB_BUCKETS constant in browse.ts (Oil, Watercolor, Gouache,
-- Tempera, Acrylic); the frontend validates before sending.
--
-- browse_artwork_count is not changed; the v1 API (its only caller) does not
-- need either new parameter.

-- 1. Drop old signatures -----------------------------------------------------

drop function if exists public.browse_artwork_ids(int, int, uuid, boolean, text, text[], text, text, boolean, int, int);
drop function if exists public.browse_facets(int, int, uuid, boolean, text, text[], text, text, boolean);


-- 2. browse_artwork_ids ------------------------------------------------------

create or replace function public.browse_artwork_ids(
  p_year_from             int       default null,
  p_year_to               int       default null,
  p_institution           uuid      default null,
  p_has_image             boolean   default null,
  p_medium_bucket         text      default null,
  p_nationalities         text[]    default null,
  p_movement              text      default null,
  p_cultural_attribution  text      default null,
  p_has_exhibition        boolean   default null,
  p_offset                int       default 0,
  p_limit                 int       default 24,
  p_institutions          uuid[]    default null,
  p_medium_sub_bucket     text      default null
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
    and (p_institution  is null or a.current_institution_id = p_institution)
    and (p_institutions is null or a.current_institution_id = any(p_institutions))
    and (p_has_image is null
         or (p_has_image     and a.image_url is not null)
         or (not p_has_image and a.image_url is null))
    and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
    and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
    and (p_nationalities is null or ar.nationality = any(p_nationalities))
    and (p_movement is null or p_movement = any(ar.movements))
    and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
    and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  order by a.date_year desc nulls last, a.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.browse_artwork_ids(int, int, uuid, boolean, text, text[], text, text, boolean, int, int, uuid[], text)
  to anon, authenticated;


-- 3. browse_facets -----------------------------------------------------------

create or replace function public.browse_facets(
  p_year_from             int       default null,
  p_year_to               int       default null,
  p_institution           uuid      default null,
  p_has_image             boolean   default null,
  p_medium_bucket         text      default null,
  p_nationalities         text[]    default null,
  p_movement              text      default null,
  p_cultural_attribution  text      default null,
  p_has_exhibition        boolean   default null,
  p_institutions          uuid[]    default null,
  p_medium_sub_bucket     text      default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  -- The `institutions` CTE intentionally omits the institution filter so all
  -- institutions remain listed even when one or more are selected.
  decades as (
    select (a.date_year / 10) * 10 as decade, count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
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
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
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
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  ),
  exhibition_counts as (
    select count(*) filter (where a.has_exhibition)::int as with_exhibition
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
  ),
  medium_counts as (
    select
      count(*) filter (where a.medium_bucket = 'Painting')::int     as painting,
      count(*) filter (where a.medium_bucket = 'Print')::int        as print_n,
      count(*) filter (where a.medium_bucket = 'Drawing')::int      as drawing,
      count(*) filter (where a.medium_bucket = 'Photography')::int  as photography,
      count(*) filter (where a.medium_bucket = 'Sculpture')::int    as sculpture,
      count(*) filter (where a.medium_bucket = 'Ceramics')::int     as ceramics,
      count(*) filter (where a.medium_bucket = 'Textile')::int      as textile,
      count(*) filter (where a.medium_bucket = 'Video')::int        as video_n,
      count(*) filter (where a.medium_bucket = 'Installation')::int as installation_n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  ),
  nationalities as (
    select ar.nationality, count(*)::int as n
    from artworks a
    join artists ar on ar.id = a.artist_id
    where ar.nationality is not null
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
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
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
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
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
    group by a.cultural_attribution
    order by n desc, a.cultural_attribution
  ),
  total as (
    select count(*)::int as n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_medium_bucket is null or a.medium_bucket = p_medium_bucket)
      and (p_medium_sub_bucket is null or a.medium ilike '%' || p_medium_sub_bucket || '%')
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
  ),
  -- Painting sub-bucket counts: only computed when Painting is the active
  -- medium bucket. Excluded from filtering by p_medium_sub_bucket so all
  -- sub-buckets show counts within the current Painting result set.
  painting_sub_buckets as (
    select
      count(*) filter (where a.medium ilike '%oil%')::int        as oil_n,
      count(*) filter (where a.medium ilike '%watercolor%'
                          or a.medium ilike '%water color%'
                          or a.medium ilike '%watercolour%')::int as watercolor_n,
      count(*) filter (where a.medium ilike '%gouache%')::int    as gouache_n,
      count(*) filter (where a.medium ilike '%tempera%')::int    as tempera_n,
      count(*) filter (where a.medium ilike '%acrylic%')::int    as acrylic_n
    from artworks a
    left join artists ar on ar.id = a.artist_id
    where a.medium_bucket = 'Painting'
      and (p_year_from is null or a.date_year >= p_year_from)
      and (p_year_to   is null or a.date_year <= p_year_to)
      and (p_institution  is null or a.current_institution_id = p_institution)
      and (p_institutions is null or a.current_institution_id = any(p_institutions))
      and (p_has_image is null
           or (p_has_image and a.image_url is not null)
           or (not p_has_image and a.image_url is null))
      and (p_nationalities is null or ar.nationality = any(p_nationalities))
      and (p_movement is null or p_movement = any(ar.movements))
      and (p_cultural_attribution is null or a.cultural_attribution = p_cultural_attribution)
      and (p_has_exhibition is null or a.has_exhibition = p_has_exhibition)
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
    'mediums', (
      select jsonb_build_array(
        jsonb_build_object('bucket', 'Painting',      'n', painting),
        jsonb_build_object('bucket', 'Print',         'n', print_n),
        jsonb_build_object('bucket', 'Drawing',       'n', drawing),
        jsonb_build_object('bucket', 'Photography',   'n', photography),
        jsonb_build_object('bucket', 'Sculpture',     'n', sculpture),
        jsonb_build_object('bucket', 'Ceramics',      'n', ceramics),
        jsonb_build_object('bucket', 'Textile',       'n', textile),
        jsonb_build_object('bucket', 'Video',         'n', video_n),
        jsonb_build_object('bucket', 'Installation',  'n', installation_n)
      )
      from medium_counts
    ),
    'paintingSubBuckets',
      case
        when p_medium_bucket = 'Painting' then (
          select jsonb_build_array(
            jsonb_build_object('subBucket', 'Oil',        'n', oil_n),
            jsonb_build_object('subBucket', 'Watercolor', 'n', watercolor_n),
            jsonb_build_object('subBucket', 'Gouache',    'n', gouache_n),
            jsonb_build_object('subBucket', 'Tempera',    'n', tempera_n),
            jsonb_build_object('subBucket', 'Acrylic',    'n', acrylic_n)
          )
          from painting_sub_buckets
        )
        else '[]'::jsonb
      end
  );
$$;

grant execute on function public.browse_facets(int, int, uuid, boolean, text, text[], text, text, boolean, uuid[], text)
  to anon, authenticated;
